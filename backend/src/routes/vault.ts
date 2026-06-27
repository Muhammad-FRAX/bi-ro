import { Router } from 'express'
import type { Pool } from 'pg'
import { requireAuth, requirePermission } from '../middleware/rbac.ts'
import { encryptSecret } from '../crypto/envelope.ts'
import { getConfig } from '../config.ts'

// Columns safe to return from secrets (never include ciphertext, iv, auth_tag, wrapped_dek)
const SECRET_META_COLS = `
  s.id, s.vault_id, s.type, s.title, s.username, s.host_url, s.logo_url, s.notes,
  s.key_version, s.rotation_period_days, s.expires_at, s.last_changed_at,
  s.server_id, s.app_id, s.created_by, s.created_at, s.updated_at,
  CASE
    WHEN s.expires_at IS NOT NULL THEN
      EXTRACT(EPOCH FROM (s.expires_at - now())) / 86400.0
    WHEN s.rotation_period_days IS NOT NULL THEN
      s.rotation_period_days - EXTRACT(EPOCH FROM (now() - s.last_changed_at)) / 86400.0
    ELSE NULL
  END AS days_remaining
`


export function vaultRouter(pool: Pool): Router {
  const router = Router()

  // ── Vaults ──────────────────────────────────────────────────────────────

  // List accessible vaults (member of, or admin)
  router.get(
    '/vaults',
    requireAuth,
    requirePermission('secrets.view'),
    async (req, res, next) => {
      try {
        const userId = req.session.userId!
        const isAdmin = (req.session.permissions ?? []).includes('users.manage')
        const { rows } = await pool.query(
          isAdmin
            ? `SELECT v.*, COUNT(vm.user_id) AS member_count
               FROM vaults v
               LEFT JOIN vault_members vm ON vm.vault_id = v.id
               GROUP BY v.id
               ORDER BY v.name`
            : `SELECT v.*, COUNT(vm2.user_id) AS member_count
               FROM vaults v
               JOIN vault_members vm ON vm.vault_id = v.id AND vm.user_id = $1
               LEFT JOIN vault_members vm2 ON vm2.vault_id = v.id
               GROUP BY v.id
               ORDER BY v.name`,
          isAdmin ? [] : [userId],
        )
        res.json(rows)
      } catch (err) {
        next(err)
      }
    },
  )

  // Create a vault (admin or vault.manage_access)
  router.post(
    '/vaults',
    requireAuth,
    requirePermission('vault.manage_access'),
    async (req, res, next) => {
      try {
        const { name, type = 'team' } = req.body as { name?: string; type?: string }
        if (!name) return void res.status(400).json({ error: 'name is required' })
        if (!['team', 'personal'].includes(type))
          return void res.status(400).json({ error: 'type must be team or personal' })
        const userId = req.session.userId!
        const { rows } = await pool.query(
          `INSERT INTO vaults (name, type, owner_id) VALUES ($1, $2, $3) RETURNING *`,
          [name, type, userId],
        )
        // Auto-add creator as manage member
        await pool.query(
          `INSERT INTO vault_members (vault_id, user_id, access) VALUES ($1, $2, 'manage')
           ON CONFLICT (vault_id, user_id) DO NOTHING`,
          [rows[0].id, userId],
        )
        res.status(201).json(rows[0])
      } catch (err) {
        next(err)
      }
    },
  )

  // Get a single vault
  router.get(
    '/vaults/:id',
    requireAuth,
    requirePermission('secrets.view'),
    async (req, res, next) => {
      try {
        const userId = req.session.userId!
        const isAdmin = (req.session.permissions ?? []).includes('users.manage')
        const { rows } = await pool.query(
          `SELECT v.* FROM vaults v WHERE v.id = $1`,
          [req.params['id']],
        )
        if (!rows[0]) return void res.status(404).json({ error: 'Vault not found' })
        if (
          !isAdmin &&
          !(await isMember(pool, rows[0].id as string, userId))
        ) {
          return void res.status(403).json({ error: 'Forbidden' })
        }
        // Fetch members
        const { rows: members } = await pool.query(
          `SELECT vm.user_id, vm.access, u.email, u.display_name
           FROM vault_members vm
           JOIN users u ON u.id = vm.user_id
           WHERE vm.vault_id = $1`,
          [rows[0].id],
        )
        res.json({ ...rows[0], members })
      } catch (err) {
        next(err)
      }
    },
  )

  // Update vault name
  router.patch(
    '/vaults/:id',
    requireAuth,
    requirePermission('vault.manage_access'),
    async (req, res, next) => {
      try {
        const userId = req.session.userId!
        const isAdmin = (req.session.permissions ?? []).includes('users.manage')
        if (
          !isAdmin &&
          !(await hasMemberAccess(pool, req.params['id']!, userId, 'manage'))
        ) {
          return void res.status(403).json({ error: 'Forbidden' })
        }
        const { name } = req.body as { name?: string }
        if (!name) return void res.status(400).json({ error: 'name is required' })
        const { rows } = await pool.query(
          `UPDATE vaults SET name = $1 WHERE id = $2 RETURNING *`,
          [name, req.params['id']],
        )
        if (!rows[0]) return void res.status(404).json({ error: 'Vault not found' })
        res.json(rows[0])
      } catch (err) {
        next(err)
      }
    },
  )

  // Delete vault (admin only for safety)
  router.delete(
    '/vaults/:id',
    requireAuth,
    requirePermission('vault.manage_access'),
    async (req, res, next) => {
      try {
        const { rowCount } = await pool.query(
          `DELETE FROM vaults WHERE id = $1`,
          [req.params['id']],
        )
        if (!rowCount) return void res.status(404).json({ error: 'Vault not found' })
        res.json({ ok: true })
      } catch (err) {
        next(err)
      }
    },
  )

  // ── Vault members ────────────────────────────────────────────────────────

  router.post(
    '/vaults/:id/members',
    requireAuth,
    requirePermission('vault.manage_access'),
    async (req, res, next) => {
      try {
        const { userId: targetUserId, access = 'view' } =
          req.body as { userId?: string; access?: string }
        if (!targetUserId) return void res.status(400).json({ error: 'userId is required' })
        if (!['view', 'reveal', 'manage'].includes(access))
          return void res.status(400).json({ error: 'access must be view, reveal, or manage' })
        await pool.query(
          `INSERT INTO vault_members (vault_id, user_id, access)
           VALUES ($1, $2, $3)
           ON CONFLICT (vault_id, user_id) DO UPDATE SET access = EXCLUDED.access`,
          [req.params['id'], targetUserId, access],
        )
        res.status(201).json({ ok: true })
      } catch (err) {
        next(err)
      }
    },
  )

  router.delete(
    '/vaults/:vaultId/members/:userId',
    requireAuth,
    requirePermission('vault.manage_access'),
    async (req, res, next) => {
      try {
        const { rowCount } = await pool.query(
          `DELETE FROM vault_members WHERE vault_id = $1 AND user_id = $2`,
          [req.params['vaultId'], req.params['userId']],
        )
        if (!rowCount) return void res.status(404).json({ error: 'Member not found' })
        res.json({ ok: true })
      } catch (err) {
        next(err)
      }
    },
  )

  // ── Secrets ──────────────────────────────────────────────────────────────

  // List secrets in a vault (never returns value/ciphertext)
  router.get(
    '/vaults/:id/secrets',
    requireAuth,
    requirePermission('secrets.view'),
    async (req, res, next) => {
      try {
        const userId = req.session.userId!
        const isAdmin = (req.session.permissions ?? []).includes('users.manage')
        if (!isAdmin && !(await isMember(pool, req.params['id']!, userId))) {
          return void res.status(403).json({ error: 'Forbidden' })
        }
        const { rows } = await pool.query(
          `SELECT ${SECRET_META_COLS}
           FROM secrets s
           WHERE s.vault_id = $1 AND s.deleted_at IS NULL
           ORDER BY s.title`,
          [req.params['id']],
        )
        res.json(rows)
      } catch (err) {
        next(err)
      }
    },
  )

  // Create a secret (writes encrypted value, never echoes it back)
  router.post(
    '/secrets',
    requireAuth,
    requirePermission('secrets.create'),
    async (req, res, next) => {
      try {
        const {
          vaultId,
          type = 'generic',
          title,
          username,
          hostUrl,
          logoUrl,
          notes,
          value,
          rotationPeriodDays,
          expiresAt,
          serverId,
          appId,
        } = req.body as {
          vaultId?: string
          type?: string
          title?: string
          username?: string
          hostUrl?: string
          logoUrl?: string
          notes?: string
          value?: string
          rotationPeriodDays?: number
          expiresAt?: string
          serverId?: string
          appId?: string
        }

        if (!vaultId) return void res.status(400).json({ error: 'vaultId is required' })
        if (!title) return void res.status(400).json({ error: 'title is required' })
        if (!value) return void res.status(400).json({ error: 'value is required' })
        if (
          !['server_login', 'db_credential', 'api_key', 'ssh_key', 'certificate', 'generic'].includes(
            type,
          )
        ) {
          return void res.status(400).json({ error: 'invalid secret type' })
        }

        const userId = req.session.userId!
        const isAdmin = (req.session.permissions ?? []).includes('users.manage')
        if (!isAdmin && !(await isMember(pool, vaultId, userId))) {
          return void res.status(403).json({ error: 'Forbidden — not a vault member' })
        }

        const kek = getConfig().kek
        const payload = encryptSecret(value, kek, 'v1')

        const { rows } = await pool.query(
          `INSERT INTO secrets
             (vault_id, type, title, username, host_url, logo_url, notes,
              ciphertext, iv, auth_tag, wrapped_dek, key_version,
              rotation_period_days, expires_at, server_id, app_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           RETURNING id, vault_id, type, title, username, host_url, logo_url, notes,
                     key_version, rotation_period_days, expires_at, last_changed_at,
                     server_id, app_id, created_by, created_at, updated_at`,
          [
            vaultId,
            type,
            title,
            username ?? null,
            hostUrl ?? null,
            logoUrl ?? null,
            notes ?? null,
            payload.ciphertext,
            payload.iv,
            payload.authTag,
            payload.wrappedDek,
            payload.keyVersion,
            rotationPeriodDays ?? null,
            expiresAt ?? null,
            serverId ?? null,
            appId ?? null,
            userId,
          ],
        )
        res.status(201).json(rows[0])
      } catch (err) {
        next(err)
      }
    },
  )

  // Get secret metadata (never returns encrypted value or ciphertext fields)
  router.get(
    '/secrets/:id',
    requireAuth,
    requirePermission('secrets.view'),
    async (req, res, next) => {
      try {
        const userId = req.session.userId!
        const isAdmin = (req.session.permissions ?? []).includes('users.manage')
        const { rows } = await pool.query(
          `SELECT ${SECRET_META_COLS}
           FROM secrets s
           WHERE s.id = $1 AND s.deleted_at IS NULL`,
          [req.params['id']],
        )
        if (!rows[0]) return void res.status(404).json({ error: 'Secret not found' })
        // IDOR check — enforce vault membership (§20 F3.3)
        if (!isAdmin && !(await isMember(pool, rows[0].vault_id as string, userId))) {
          return void res.status(403).json({ error: 'Forbidden' })
        }
        res.json(rows[0])
      } catch (err) {
        next(err)
      }
    },
  )

  // Update secret metadata (and optionally rotate the value)
  router.patch(
    '/secrets/:id',
    requireAuth,
    requirePermission('secrets.edit'),
    async (req, res, next) => {
      try {
        const userId = req.session.userId!
        const isAdmin = (req.session.permissions ?? []).includes('users.manage')
        // Fetch to get vault_id for membership check
        const { rows: existing } = await pool.query(
          `SELECT id, vault_id, ciphertext, iv, auth_tag, wrapped_dek, key_version
           FROM secrets WHERE id = $1 AND deleted_at IS NULL`,
          [req.params['id']],
        )
        if (!existing[0]) return void res.status(404).json({ error: 'Secret not found' })
        if (!isAdmin && !(await isMember(pool, existing[0].vault_id as string, userId))) {
          return void res.status(403).json({ error: 'Forbidden' })
        }

        const {
          title,
          username,
          hostUrl,
          logoUrl,
          notes,
          newValue,
          rotationPeriodDays,
          expiresAt,
          serverId,
          reason,
        } = req.body as {
          title?: string
          username?: string
          hostUrl?: string
          logoUrl?: string
          notes?: string
          newValue?: string
          rotationPeriodDays?: number
          expiresAt?: string
          serverId?: string | null
          reason?: string
        }

        // If rotating the value, save history first
        if (newValue) {
          await pool.query(
            `INSERT INTO secret_history
               (secret_id, ciphertext, iv, auth_tag, wrapped_dek, key_version, changed_by, reason)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              existing[0].id,
              existing[0].ciphertext,
              existing[0].iv,
              existing[0].auth_tag,
              existing[0].wrapped_dek,
              existing[0].key_version,
              userId,
              reason ?? null,
            ],
          )

          const kek = getConfig().kek
          const payload = encryptSecret(newValue, kek, 'v1')

          const serverIdForUpdate = typeof serverId === 'string' && serverId.length > 0 ? serverId : null
          const serverIdSet = serverIdForUpdate !== null ? `, server_id = $14::uuid` : ''
          const rotateParams: unknown[] = [
            req.params['id'],
            payload.ciphertext, payload.iv, payload.authTag, payload.wrappedDek, payload.keyVersion,
            title ?? null, username ?? null, hostUrl ?? null, logoUrl ?? null,
            notes ?? null, rotationPeriodDays ?? null, expiresAt ?? null,
          ]
          if (serverIdForUpdate !== null) rotateParams.push(serverIdForUpdate)
          await pool.query(
            `UPDATE secrets SET
               ciphertext = $2, iv = $3, auth_tag = $4, wrapped_dek = $5, key_version = $6,
               last_changed_at = now(), updated_at = now(),
               title = COALESCE($7, title),
               username = COALESCE($8, username),
               host_url = COALESCE($9, host_url),
               logo_url = COALESCE($10, logo_url),
               notes = COALESCE($11, notes),
               rotation_period_days = COALESCE($12, rotation_period_days),
               expires_at = COALESCE($13, expires_at)${serverIdSet}
             WHERE id = $1`,
            rotateParams,
          )
        } else {
          const serverIdForUpdate = typeof serverId === 'string' && serverId.length > 0 ? serverId : null
          const serverIdSet = serverIdForUpdate !== null ? `, server_id = $9::uuid` : ''
          const metaParams: unknown[] = [
            req.params['id'],
            title ?? null, username ?? null, hostUrl ?? null, logoUrl ?? null,
            notes ?? null, rotationPeriodDays ?? null, expiresAt ?? null,
          ]
          if (serverIdForUpdate !== null) metaParams.push(serverIdForUpdate)
          await pool.query(
            `UPDATE secrets SET
               updated_at = now(),
               title = COALESCE($2, title),
               username = COALESCE($3, username),
               host_url = COALESCE($4, host_url),
               logo_url = COALESCE($5, logo_url),
               notes = COALESCE($6, notes),
               rotation_period_days = COALESCE($7, rotation_period_days),
               expires_at = COALESCE($8, expires_at)${serverIdSet}
             WHERE id = $1`,
            metaParams,
          )
        }

        const { rows } = await pool.query(
          `SELECT ${SECRET_META_COLS} FROM secrets s WHERE s.id = $1`,
          [req.params['id']],
        )
        res.json(rows[0])
      } catch (err) {
        next(err)
      }
    },
  )

  // Soft-delete a secret
  router.delete(
    '/secrets/:id',
    requireAuth,
    requirePermission('secrets.delete'),
    async (req, res, next) => {
      try {
        const userId = req.session.userId!
        const isAdmin = (req.session.permissions ?? []).includes('users.manage')
        const { rows: existing } = await pool.query(
          `SELECT id, vault_id FROM secrets WHERE id = $1 AND deleted_at IS NULL`,
          [req.params['id']],
        )
        if (!existing[0]) return void res.status(404).json({ error: 'Secret not found' })
        if (!isAdmin && !(await isMember(pool, existing[0].vault_id as string, userId))) {
          return void res.status(403).json({ error: 'Forbidden' })
        }
        await pool.query(
          `UPDATE secrets SET deleted_at = now() WHERE id = $1`,
          [req.params['id']],
        )
        res.json({ ok: true })
      } catch (err) {
        next(err)
      }
    },
  )

  // Get secret history (encrypted prior values — metadata only, no values)
  router.get(
    '/secrets/:id/history',
    requireAuth,
    requirePermission('secrets.view'),
    async (req, res, next) => {
      try {
        const userId = req.session.userId!
        const isAdmin = (req.session.permissions ?? []).includes('users.manage')
        // IDOR check (§20 F3.3 — history same as secret)
        const { rows: secret } = await pool.query(
          `SELECT vault_id FROM secrets WHERE id = $1 AND deleted_at IS NULL`,
          [req.params['id']],
        )
        if (!secret[0]) return void res.status(404).json({ error: 'Secret not found' })
        if (!isAdmin && !(await isMember(pool, secret[0].vault_id as string, userId))) {
          return void res.status(403).json({ error: 'Forbidden' })
        }
        const { rows } = await pool.query(
          `SELECT id, secret_id, key_version, changed_at, changed_by, reason
           FROM secret_history
           WHERE secret_id = $1
           ORDER BY changed_at DESC`,
          [req.params['id']],
        )
        res.json(rows)
      } catch (err) {
        next(err)
      }
    },
  )

  return router
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function isMember(pool: Pool, vaultId: string, userId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM vault_members WHERE vault_id = $1 AND user_id = $2`,
    [vaultId, userId],
  )
  return rows.length > 0
}

async function hasMemberAccess(
  pool: Pool,
  vaultId: string,
  userId: string,
  minAccess: 'view' | 'reveal' | 'manage',
): Promise<boolean> {
  const ORDER = { view: 0, reveal: 1, manage: 2 }
  const { rows } = await pool.query(
    `SELECT access FROM vault_members WHERE vault_id = $1 AND user_id = $2`,
    [vaultId, userId],
  )
  if (!rows[0]) return false
  return ORDER[rows[0].access as keyof typeof ORDER] >= ORDER[minAccess]
}

export { isMember, hasMemberAccess }
