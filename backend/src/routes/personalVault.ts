import { Router } from 'express'
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'node:crypto'
import type { Pool } from 'pg'
import { requireAuth } from '../middleware/rbac.ts'
import {
  generatePersonalVaultKey,
  encryptPersonalSecret,
  decryptPersonalSecret,
} from '../crypto/envelope.ts'

// Derive a 32-byte wrapper key from user password using PBKDF2
function deriveWrapperKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, 600000, 32, 'sha256')
}

// Wrap the PVK (personal vault key) under the derived wrapper key using AES-256-GCM
// Format: iv(12) || authTag(16) || encrypted_pvk(32) = 60 bytes
function wrapPvk(pvk: Buffer, wrapperKey: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', wrapperKey, iv)
  const encrypted = Buffer.concat([cipher.update(pvk), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted])
}

// Unwrap the PVK using the derived wrapper key
function unwrapPvk(cipherBlob: Buffer, wrapperKey: Buffer): Buffer {
  const iv = cipherBlob.subarray(0, 12)
  const authTag = cipherBlob.subarray(12, 28)
  const encrypted = cipherBlob.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', wrapperKey, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()])
}

export function personalVaultRouter(pool: Pool): Router {
  const router = Router()

  // All personal vault routes require authentication
  router.use('/personal-vault', requireAuth)

  // ── GET /api/personal-vault/status ──────────────────────────────────────────
  router.get('/personal-vault/status', async (req, res, next) => {
    try {
      const userId = req.session.userId!
      const { rows } = await pool.query<{ personal_vault_key_salt: Buffer | null }>(
        `SELECT personal_vault_key_salt FROM users WHERE id = $1`,
        [userId],
      )
      const initialized = rows[0]?.personal_vault_key_salt != null
      res.json({ initialized })
    } catch (err) {
      next(err)
    }
  })

  // ── POST /api/personal-vault/initialize ─────────────────────────────────────
  router.post('/personal-vault/initialize', async (req, res, next) => {
    try {
      const userId = req.session.userId!
      const { password } = req.body as { password?: unknown }

      if (typeof password !== 'string' || !password) {
        res.status(400).json({ error: 'password is required' })
        return
      }

      // Check if already initialized
      const { rows } = await pool.query<{ personal_vault_key_salt: Buffer | null }>(
        `SELECT personal_vault_key_salt FROM users WHERE id = $1`,
        [userId],
      )
      if (rows[0]?.personal_vault_key_salt != null) {
        res.status(409).json({ error: 'Personal vault already initialized' })
        return
      }

      // Derive wrapper key from password
      const salt = randomBytes(32)
      const wrapperKey = deriveWrapperKey(password, salt)

      // Generate and wrap PVK
      const pvk = generatePersonalVaultKey()
      const pvkCipher = wrapPvk(pvk, wrapperKey)

      // Store salt and wrapped PVK
      await pool.query(
        `UPDATE users SET personal_vault_key_salt = $1, personal_vault_key_cipher = $2 WHERE id = $3`,
        [salt, pvkCipher, userId],
      )

      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // ── GET /api/personal-vault/entries ─────────────────────────────────────────
  // Returns metadata only — no crypto fields
  router.get('/personal-vault/entries', async (req, res, next) => {
    try {
      const userId = req.session.userId!
      const { rows } = await pool.query<{
        id: string
        title: string
        url: string | null
        username: string | null
        logo_url: string | null
        created_at: string
        updated_at: string
      }>(
        `SELECT id, title, url, username, logo_url, created_at, updated_at
         FROM personal_entries
         WHERE owner_id = $1 AND deleted_at IS NULL
         ORDER BY title`,
        [userId],
      )
      res.json({
        entries: rows.map((r) => ({
          id: r.id,
          title: r.title,
          url: r.url,
          username: r.username,
          logoUrl: r.logo_url,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      })
    } catch (err) {
      next(err)
    }
  })

  // ── POST /api/personal-vault/entries ────────────────────────────────────────
  router.post('/personal-vault/entries', async (req, res, next) => {
    try {
      const userId = req.session.userId!
      const { title, url, username, value, logo_url, password } = req.body as {
        title?: unknown
        url?: unknown
        username?: unknown
        value?: unknown
        logo_url?: unknown
        password?: unknown
      }

      if (typeof title !== 'string' || !title.trim()) {
        res.status(400).json({ error: 'title is required' })
        return
      }
      if (typeof value !== 'string' || !value) {
        res.status(400).json({ error: 'value is required' })
        return
      }
      if (typeof password !== 'string' || !password) {
        res.status(400).json({ error: 'password is required to encrypt the entry' })
        return
      }

      // Load user's vault key material
      const { rows: userRows } = await pool.query<{
        personal_vault_key_salt: Buffer | null
        personal_vault_key_cipher: Buffer | null
      }>(
        `SELECT personal_vault_key_salt, personal_vault_key_cipher FROM users WHERE id = $1`,
        [userId],
      )

      if (!userRows[0]?.personal_vault_key_salt || !userRows[0]?.personal_vault_key_cipher) {
        res.status(422).json({ error: 'Personal vault not initialized. Call POST /personal-vault/initialize first.' })
        return
      }

      // Re-derive wrapper key and unwrap PVK
      let pvk: Buffer
      try {
        const wrapperKey = deriveWrapperKey(password, userRows[0].personal_vault_key_salt)
        pvk = unwrapPvk(userRows[0].personal_vault_key_cipher, wrapperKey)
      } catch {
        res.status(401).json({ error: 'Incorrect password' })
        return
      }

      // Encrypt value with PVK
      const { ciphertext, iv, authTag } = encryptPersonalSecret(value, pvk)

      const { rows } = await pool.query<{
        id: string
        title: string
        url: string | null
        username: string | null
        logo_url: string | null
        created_at: string
        updated_at: string
      }>(
        `INSERT INTO personal_entries (owner_id, title, url, username, logo_url, ciphertext, iv, auth_tag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, title, url, username, logo_url, created_at, updated_at`,
        [
          userId,
          title.trim(),
          typeof url === 'string' && url.trim() ? url.trim() : null,
          typeof username === 'string' && username.trim() ? username.trim() : null,
          typeof logo_url === 'string' && logo_url.trim() ? logo_url.trim() : null,
          ciphertext,
          iv,
          authTag,
        ],
      )

      const entry = rows[0]!
      res.status(201).json({
        entry: {
          id: entry.id,
          title: entry.title,
          url: entry.url,
          username: entry.username,
          logoUrl: entry.logo_url,
          createdAt: entry.created_at,
          updatedAt: entry.updated_at,
        },
      })
    } catch (err) {
      next(err)
    }
  })

  // ── GET /api/personal-vault/entries/:id ─────────────────────────────────────
  // Returns metadata only — IDOR: owner_id = userId
  router.get('/personal-vault/entries/:id', async (req, res, next) => {
    try {
      const userId = req.session.userId!
      const { id } = req.params
      const { rows } = await pool.query<{
        id: string
        title: string
        url: string | null
        username: string | null
        logo_url: string | null
        created_at: string
        updated_at: string
      }>(
        `SELECT id, title, url, username, logo_url, created_at, updated_at
         FROM personal_entries
         WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
        [id, userId],
      )
      if (!rows[0]) {
        res.status(404).json({ error: 'Entry not found' })
        return
      }
      const entry = rows[0]
      res.json({
        entry: {
          id: entry.id,
          title: entry.title,
          url: entry.url,
          username: entry.username,
          logoUrl: entry.logo_url,
          createdAt: entry.created_at,
          updatedAt: entry.updated_at,
        },
      })
    } catch (err) {
      next(err)
    }
  })

  // ── PATCH /api/personal-vault/entries/:id ────────────────────────────────────
  // Update metadata; optionally rotate value (requires vault password)
  router.patch('/personal-vault/entries/:id', async (req, res, next) => {
    try {
      const userId = req.session.userId!
      const { id } = req.params
      const { title, url, username, logo_url, newValue, password } = req.body as {
        title?: unknown
        url?: unknown
        username?: unknown
        logo_url?: unknown
        newValue?: unknown
        password?: unknown
      }

      const updates: string[] = ['updated_at = NOW()']
      const params: unknown[] = []
      let idx = 1

      if (typeof title === 'string' && title.trim()) {
        updates.push(`title = $${idx++}`)
        params.push(title.trim())
      }
      if (url !== undefined) {
        updates.push(`url = $${idx++}`)
        params.push(typeof url === 'string' && url.trim() ? url.trim() : null)
      }
      if (username !== undefined) {
        updates.push(`username = $${idx++}`)
        params.push(typeof username === 'string' && username.trim() ? username.trim() : null)
      }
      if (logo_url !== undefined) {
        updates.push(`logo_url = $${idx++}`)
        params.push(typeof logo_url === 'string' && logo_url.trim() ? logo_url.trim() : null)
      }

      // Value rotation — requires vault password
      if (typeof newValue === 'string' && newValue) {
        if (typeof password !== 'string' || !password) {
          res.status(400).json({ error: 'password is required to update the secret value' })
          return
        }
        const { rows: userRows } = await pool.query<{
          personal_vault_key_salt: Buffer | null
          personal_vault_key_cipher: Buffer | null
        }>(
          `SELECT personal_vault_key_salt, personal_vault_key_cipher FROM users WHERE id = $1`,
          [userId],
        )
        if (!userRows[0]?.personal_vault_key_salt || !userRows[0]?.personal_vault_key_cipher) {
          res.status(422).json({ error: 'Personal vault not initialized' })
          return
        }
        let pvk: Buffer
        try {
          const wrapperKey = deriveWrapperKey(password, userRows[0].personal_vault_key_salt)
          pvk = unwrapPvk(userRows[0].personal_vault_key_cipher, wrapperKey)
        } catch {
          res.status(401).json({ error: 'Incorrect password' })
          return
        }
        const { ciphertext, iv, authTag } = encryptPersonalSecret(newValue, pvk)
        updates.push(`ciphertext = $${idx++}`, `iv = $${idx++}`, `auth_tag = $${idx++}`)
        params.push(ciphertext, iv, authTag)
      }

      params.push(id, userId)
      const { rowCount } = await pool.query(
        `UPDATE personal_entries SET ${updates.join(', ')}
         WHERE id = $${idx} AND owner_id = $${idx + 1} AND deleted_at IS NULL`,
        params,
      )

      if (rowCount === 0) {
        res.status(404).json({ error: 'Entry not found' })
        return
      }
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // ── DELETE /api/personal-vault/entries/:id ───────────────────────────────────
  // Soft-delete — IDOR: owner_id = userId
  router.delete('/personal-vault/entries/:id', async (req, res, next) => {
    try {
      const userId = req.session.userId!
      const { id } = req.params
      const { rowCount } = await pool.query(
        `UPDATE personal_entries SET deleted_at = NOW()
         WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
        [id, userId],
      )
      if (rowCount === 0) {
        res.status(404).json({ error: 'Entry not found' })
        return
      }
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // ── POST /api/personal-vault/entries/:id/reveal ──────────────────────────────
  // Re-derives wrapper key from password, unwraps PVK, decrypts entry value
  router.post('/personal-vault/entries/:id/reveal', async (req, res, next) => {
    try {
      const userId = req.session.userId!
      const { id } = req.params
      const { password } = req.body as { password?: unknown }

      if (typeof password !== 'string' || !password) {
        res.status(400).json({ error: 'password is required' })
        return
      }

      // Load user's vault key material
      const { rows: userRows } = await pool.query<{
        personal_vault_key_salt: Buffer | null
        personal_vault_key_cipher: Buffer | null
      }>(
        `SELECT personal_vault_key_salt, personal_vault_key_cipher FROM users WHERE id = $1`,
        [userId],
      )

      if (!userRows[0]?.personal_vault_key_salt || !userRows[0]?.personal_vault_key_cipher) {
        res.status(422).json({ error: 'Personal vault not initialized' })
        return
      }

      // Load entry — IDOR: owner_id = userId
      const { rows: entryRows } = await pool.query<{
        ciphertext: Buffer
        iv: Buffer
        auth_tag: Buffer
      }>(
        `SELECT ciphertext, iv, auth_tag FROM personal_entries
         WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
        [id, userId],
      )

      if (!entryRows[0]) {
        res.status(404).json({ error: 'Entry not found' })
        return
      }

      // Re-derive wrapper key and unwrap PVK
      let pvk: Buffer
      try {
        const wrapperKey = deriveWrapperKey(password, userRows[0].personal_vault_key_salt)
        pvk = unwrapPvk(userRows[0].personal_vault_key_cipher, wrapperKey)
      } catch {
        res.status(401).json({ error: 'Incorrect password' })
        return
      }

      // Decrypt entry value
      let value: string
      try {
        const entry = entryRows[0]
        value = decryptPersonalSecret(entry.ciphertext, entry.iv, entry.auth_tag, pvk)
      } catch {
        res.status(401).json({ error: 'Incorrect password' })
        return
      }

      res.json({ value })
    } catch (err) {
      next(err)
    }
  })

  return router
}
