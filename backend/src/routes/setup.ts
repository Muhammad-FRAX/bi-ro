import { Router } from 'express'
import type { Pool } from 'pg'
import { hashPassword } from '../auth/self.ts'

interface SetupRouterOptions {
  adminEmail: string
  adminPassword: string
  authMode: 'self' | 'keycloak' | 'ldap'
}

export function setupRouter(pool: Pool, opts: SetupRouterOptions): Router {
  const router = Router()

  router.get('/setup/state', async (_req, res, next) => {
    try {
      const { rows } = await pool.query<{ initialized: boolean; auth_mode: string | null }>(
        `SELECT initialized, auth_mode FROM setup_state WHERE id = TRUE`,
      )
      const row = rows[0]
      res.json({
        initialized: row?.initialized ?? false,
        authMode: row?.auth_mode ?? null,
        adminEmail: row?.initialized ? undefined : opts.adminEmail,
      })
    } catch (err) {
      next(err)
    }
  })

  router.post('/setup/initialize', async (req, res, next) => {
    const client = await pool.connect()
    try {
      // ── 1. Check if already initialized (fast, no lock) ──────────────────
      const { rows: stateRows } = await client.query<{ initialized: boolean }>(
        `SELECT initialized FROM setup_state WHERE id = TRUE`,
      )
      if (stateRows[0]?.initialized) {
        res.status(409).json({ error: 'Already initialized' })
        return
      }

      // ── 2. Validate env-seeded admin credentials ──────────────────────────
      if (!opts.adminEmail || !opts.adminPassword) {
        res.status(500).json({
          error: 'BIRO_ADMIN_EMAIL and BIRO_ADMIN_PASSWORD must be set before running setup',
        })
        return
      }

      const { appTitle, appAccent } = req.body as { appTitle?: unknown; appAccent?: unknown }
      const title = typeof appTitle === 'string' && appTitle.trim() ? appTitle.trim() : 'BI Root'
      const accent = typeof appAccent === 'string' && appAccent.trim() ? appAccent.trim() : '#a78bfa'

      // ── 3. Begin transaction ──────────────────────────────────────────────
      await client.query('BEGIN')

      // Re-check under lock to prevent race (§20 F4.2)
      const { rows: lockRows } = await client.query<{ initialized: boolean }>(
        `SELECT initialized FROM setup_state WHERE id = TRUE FOR UPDATE`,
      )
      if (lockRows[0]?.initialized) {
        await client.query('ROLLBACK')
        res.status(409).json({ error: 'Already initialized' })
        return
      }

      // ── 4. Create first admin user ────────────────────────────────────────
      const passwordHash = await hashPassword(opts.adminPassword)
      const { rows: userRows } = await client.query<{ id: string }>(
        `INSERT INTO users (auth_mode, email, display_name, password_hash, status, force_password_change)
         VALUES ('self', $1, $2, $3, 'active', TRUE)
         ON CONFLICT (email) WHERE deleted_at IS NULL DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               force_password_change = TRUE,
               status = 'active'
         RETURNING id`,
        [opts.adminEmail, opts.adminEmail, passwordHash],
      )
      const adminUserId = userRows[0]!.id

      // ── 5. Assign admin role ──────────────────────────────────────────────
      const { rows: roleRows } = await client.query<{ id: string }>(
        `SELECT id FROM roles WHERE name = 'admin'`,
      )
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [adminUserId, roleRows[0]!.id],
      )

      // ── 6. Persist settings ───────────────────────────────────────────────
      await client.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb), ($3, $4::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        ['appTitle', JSON.stringify(title), 'appAccent', JSON.stringify(accent)],
      )

      // ── 7. Mark as initialized ────────────────────────────────────────────
      await client.query(
        `UPDATE setup_state SET initialized = TRUE, auth_mode = $1, initialized_at = NOW() WHERE id = TRUE`,
        [opts.authMode],
      )

      await client.query('COMMIT')
      res.json({ ok: true })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      next(err)
    } finally {
      client.release()
    }
  })

  return router
}
