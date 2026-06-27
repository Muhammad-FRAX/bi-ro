import { Router } from 'express'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import type { Pool } from 'pg'
import { requireAuth, requirePermission } from '../middleware/rbac.ts'
import { rewrapPayload } from '../crypto/envelope.ts'
import { getConfig } from '../config.ts'

function getKek(): Buffer {
  try {
    return getConfig().kek
  } catch {
    const raw = process.env['BIRO_MASTER_KEK']
    if (!raw) throw new Error('BIRO_MASTER_KEK is not set')
    return Buffer.from(raw, 'base64')
  }
}

function aesGcmEncryptBuffer(
  plaintext: Buffer,
  key: Buffer,
): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return { ciphertext, iv, authTag }
}

function aesGcmDecryptBuffer(
  ciphertext: Buffer,
  key: Buffer,
  iv: Buffer,
  authTag: Buffer,
): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function backupRouter(pool: Pool): Router {
  const router = Router()

  // POST /api/admin/backup — export encrypted backup
  router.post(
    '/admin/backup',
    requireAuth,
    requirePermission('users.manage'),
    async (req, res, next) => {
      try {
        const kek = getKek()

        // Fetch all tables
        const [users, roles, rolePerms, userRoles, servers, apps, tags, vaults, secrets] = await Promise.all([
          // No password_hash, no totp_secret
          pool.query(
            `SELECT id, auth_mode, external_id, email, display_name, status,
                    force_password_change, created_at, last_login_at, deleted_at
             FROM users`,
          ),
          pool.query(`SELECT id, name, description, is_builtin FROM roles`),
          pool.query(`SELECT role_id, permission FROM role_permissions`),
          pool.query(`SELECT user_id, role_id FROM user_roles`),
          pool.query(`SELECT * FROM servers`),
          pool.query(`SELECT * FROM apps`),
          pool.query(`SELECT * FROM tags`),
          pool.query(`SELECT * FROM vaults`),
          pool.query(
            `SELECT id, vault_id, type, title, username, host_url, logo_url, notes,
                    ciphertext, iv, auth_tag, wrapped_dek, key_version, key_version_int,
                    rotation_period_days, expires_at, last_changed_at,
                    server_id, app_id, created_by, created_at, updated_at
             FROM secrets
             WHERE deleted_at IS NULL`,
          ),
        ])

        const payload = {
          version: 1,
          exported_at: new Date().toISOString(),
          users: users.rows,
          roles: roles.rows,
          rolePerms: rolePerms.rows,
          userRoles: userRoles.rows,
          servers: servers.rows,
          apps: apps.rows,
          tags: tags.rows,
          vaults: vaults.rows,
          secrets: secrets.rows.map((s) => ({
            id: s.id,
            vault_id: s.vault_id,
            type: s.type,
            title: s.title,
            username: s.username,
            host_url: s.host_url,
            logo_url: s.logo_url,
            notes: s.notes,
            ciphertext_hex: (s.ciphertext as Buffer).toString('hex'),
            iv_hex: (s.iv as Buffer).toString('hex'),
            auth_tag_hex: (s.auth_tag as Buffer).toString('hex'),
            wrapped_dek_hex: (s.wrapped_dek as Buffer).toString('hex'),
            key_version: s.key_version,
            key_version_int: s.key_version_int,
            rotation_period_days: s.rotation_period_days,
            expires_at: s.expires_at,
            last_changed_at: s.last_changed_at,
            server_id: s.server_id,
            app_id: s.app_id,
            created_by: s.created_by,
            created_at: s.created_at,
            updated_at: s.updated_at,
          })),
        }

        const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
        const { ciphertext, iv, authTag } = aesGcmEncryptBuffer(plaintext, kek)

        // Pack: iv(12) || authTag(16) || ciphertext
        const packed = Buffer.concat([iv, authTag, ciphertext])
        res.json({ backup: packed.toString('base64') })
      } catch (err) {
        next(err)
      }
    },
  )

  // POST /api/admin/restore — import encrypted backup
  router.post(
    '/admin/restore',
    requireAuth,
    requirePermission('users.manage'),
    async (req, res, next) => {
      try {
        const { backup } = req.body as { backup?: string }
        if (!backup) return void res.status(400).json({ error: 'backup is required' })

        const kek = getKek()
        const packed = Buffer.from(backup, 'base64')
        if (packed.length < 28) {
          return void res.status(400).json({ error: 'Invalid backup: too short' })
        }

        const iv = packed.subarray(0, 12)
        const authTag = packed.subarray(12, 28)
        const ciphertext = packed.subarray(28)

        let payload: {
          version: number
          users: Record<string, unknown>[]
          roles: Record<string, unknown>[]
          rolePerms: Record<string, unknown>[]
          userRoles: Record<string, unknown>[]
          servers: Record<string, unknown>[]
          apps: Record<string, unknown>[]
          tags: Record<string, unknown>[]
          vaults: Record<string, unknown>[]
          secrets: Record<string, unknown>[]
        }
        try {
          const plaintext = aesGcmDecryptBuffer(ciphertext, kek, iv, authTag)
          payload = JSON.parse(plaintext.toString('utf8')) as typeof payload
        } catch {
          return void res.status(400).json({ error: 'Invalid backup: decryption failed' })
        }

        const counts = {
          roles: 0,
          users: 0,
          servers: 0,
          apps: 0,
          tags: 0,
          vaults: 0,
          secrets: 0,
        }

        // Upsert roles
        for (const row of payload.roles ?? []) {
          await pool.query(
            `INSERT INTO roles (id, name, description, is_builtin)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               description = EXCLUDED.description`,
            [row['id'], row['name'], row['description'] ?? '', row['is_builtin'] ?? false],
          )
          counts.roles++
        }

        // Upsert role_permissions
        for (const row of payload.rolePerms ?? []) {
          await pool.query(
            `INSERT INTO role_permissions (role_id, permission)
             VALUES ($1, $2)
             ON CONFLICT (role_id, permission) DO NOTHING`,
            [row['role_id'], row['permission']],
          )
        }

        // Upsert users (no password_hash, no totp_secret)
        for (const row of payload.users ?? []) {
          await pool.query(
            `INSERT INTO users (id, auth_mode, external_id, email, display_name, status,
                                force_password_change, created_at, last_login_at, deleted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (id) DO UPDATE SET
               email = EXCLUDED.email,
               display_name = EXCLUDED.display_name,
               status = EXCLUDED.status`,
            [
              row['id'],
              row['auth_mode'] ?? 'self',
              row['external_id'] ?? null,
              row['email'],
              row['display_name'],
              row['status'] ?? 'active',
              row['force_password_change'] ?? false,
              row['created_at'],
              row['last_login_at'] ?? null,
              row['deleted_at'] ?? null,
            ],
          )
          counts.users++
        }

        // Upsert user_roles
        for (const row of payload.userRoles ?? []) {
          await pool.query(
            `INSERT INTO user_roles (user_id, role_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, role_id) DO NOTHING`,
            [row['user_id'], row['role_id']],
          )
        }

        // Upsert servers
        for (const row of payload.servers ?? []) {
          await pool.query(
            `INSERT INTO servers (id, hostname, aliases, ips, environment, os, location,
                                  cpu_ram_disk, owner_id, status, notes, created_at, updated_at, deleted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             ON CONFLICT (id) DO UPDATE SET
               hostname = EXCLUDED.hostname,
               os = EXCLUDED.os,
               status = EXCLUDED.status,
               updated_at = EXCLUDED.updated_at`,
            [
              row['id'],
              row['hostname'],
              JSON.stringify(row['aliases'] ?? []),
              JSON.stringify(row['ips'] ?? []),
              row['environment'] ?? 'other',
              row['os'] ?? null,
              row['location'] ?? null,
              row['cpu_ram_disk'] ?? null,
              row['owner_id'] ?? null,
              row['status'] ?? 'active',
              row['notes'] ?? null,
              row['created_at'],
              row['updated_at'],
              row['deleted_at'] ?? null,
            ],
          )
          counts.servers++
        }

        // Upsert apps
        for (const row of payload.apps ?? []) {
          await pool.query(
            `INSERT INTO apps (id, name, category, vendor, version, eol_date, logo_url, docs_url, notes, created_at, updated_at, deleted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               category = EXCLUDED.category,
               vendor = EXCLUDED.vendor,
               updated_at = EXCLUDED.updated_at`,
            [
              row['id'],
              row['name'],
              row['category'] ?? null,
              row['vendor'] ?? null,
              row['version'] ?? null,
              row['eol_date'] ?? null,
              row['logo_url'] ?? null,
              row['docs_url'] ?? null,
              row['notes'] ?? null,
              row['created_at'],
              row['updated_at'],
              row['deleted_at'] ?? null,
            ],
          )
          counts.apps++
        }

        // Upsert tags
        for (const row of payload.tags ?? []) {
          await pool.query(
            `INSERT INTO tags (id, name, color)
             VALUES ($1, $2, $3)
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               color = EXCLUDED.color`,
            [row['id'], row['name'], row['color'] ?? '#a78bfa'],
          )
          counts.tags++
        }

        // Upsert vaults
        for (const row of payload.vaults ?? []) {
          await pool.query(
            `INSERT INTO vaults (id, name, type, owner_id, created_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               type = EXCLUDED.type,
               owner_id = EXCLUDED.owner_id`,
            [
              row['id'],
              row['name'],
              row['type'] ?? 'team',
              row['owner_id'] ?? null,
              row['created_at'],
            ],
          )
          counts.vaults++
        }

        // Upsert secrets (re-pack hex back to buffers)
        for (const row of payload.secrets ?? []) {
          const ciphertextBuf = Buffer.from(row['ciphertext_hex'] as string, 'hex')
          const ivBuf = Buffer.from(row['iv_hex'] as string, 'hex')
          const authTagBuf = Buffer.from(row['auth_tag_hex'] as string, 'hex')
          const wrappedDekBuf = Buffer.from(row['wrapped_dek_hex'] as string, 'hex')

          await pool.query(
            `INSERT INTO secrets
               (id, vault_id, type, title, username, host_url, logo_url, notes,
                ciphertext, iv, auth_tag, wrapped_dek, key_version, key_version_int,
                rotation_period_days, expires_at, last_changed_at,
                server_id, app_id, created_by, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
             ON CONFLICT (id) DO UPDATE SET
               vault_id = EXCLUDED.vault_id,
               type = EXCLUDED.type,
               title = EXCLUDED.title,
               username = EXCLUDED.username,
               host_url = EXCLUDED.host_url,
               logo_url = EXCLUDED.logo_url,
               notes = EXCLUDED.notes,
               ciphertext = EXCLUDED.ciphertext,
               iv = EXCLUDED.iv,
               auth_tag = EXCLUDED.auth_tag,
               wrapped_dek = EXCLUDED.wrapped_dek,
               key_version = EXCLUDED.key_version,
               key_version_int = EXCLUDED.key_version_int,
               rotation_period_days = EXCLUDED.rotation_period_days,
               expires_at = EXCLUDED.expires_at,
               updated_at = EXCLUDED.updated_at`,
            [
              row['id'],
              row['vault_id'],
              row['type'],
              row['title'],
              row['username'] ?? null,
              row['host_url'] ?? null,
              row['logo_url'] ?? null,
              row['notes'] ?? null,
              ciphertextBuf,
              ivBuf,
              authTagBuf,
              wrappedDekBuf,
              row['key_version'],
              row['key_version_int'] ?? 1,
              row['rotation_period_days'] ?? null,
              row['expires_at'] ?? null,
              row['last_changed_at'] ?? null,
              row['server_id'] ?? null,
              row['app_id'] ?? null,
              row['created_by'] ?? null,
              row['created_at'],
              row['updated_at'],
            ],
          )
          counts.secrets++
        }

        res.json({ ok: true, counts })
      } catch (err) {
        next(err)
      }
    },
  )

  // POST /api/admin/kek-rotation — re-wrap all DEKs under a new KEK
  router.post(
    '/admin/kek-rotation',
    requireAuth,
    requirePermission('users.manage'),
    async (req, res, next) => {
      try {
        const { newKek: newKekB64 } = req.body as { newKek?: string }
        if (!newKekB64) return void res.status(400).json({ error: 'newKek is required' })

        const newKekBuf = Buffer.from(newKekB64, 'base64')
        if (newKekBuf.length !== 32) {
          return void res.status(400).json({
            error: 'newKek must be a base64-encoded 32-byte key',
          })
        }

        const oldKek = getKek()

        const { rows } = await pool.query(
          `SELECT id, ciphertext, iv, auth_tag, wrapped_dek, key_version
           FROM secrets
           WHERE deleted_at IS NULL`,
        )

        let rotated = 0
        for (const row of rows) {
          const payload = {
            ciphertext: row.ciphertext as Buffer,
            iv: row.iv as Buffer,
            authTag: row.auth_tag as Buffer,
            wrappedDek: row.wrapped_dek as Buffer,
            keyVersion: row.key_version as string,
          }

          const rewrapped = rewrapPayload(payload, oldKek, newKekBuf, payload.keyVersion)

          await pool.query(
            `UPDATE secrets
             SET wrapped_dek = $1, key_version_int = key_version_int + 1
             WHERE id = $2`,
            [rewrapped.wrappedDek, row.id],
          )
          rotated++
        }

        res.json({ ok: true, rotated })
      } catch (err) {
        next(err)
      }
    },
  )

  return router
}
