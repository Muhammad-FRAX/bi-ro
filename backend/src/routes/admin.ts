import { Router } from 'express'
import type { Pool } from 'pg'
import { requireAuth, requirePermission } from '../middleware/rbac.ts'
import { hashPassword } from '../auth/self.ts'
import { buildSmtpConfig, sendEmail, buildNotificationEmailBody } from '../integrations/smtp.ts'

export function adminRouter(pool: Pool): Router {
  const router = Router()

  // All admin routes require authentication + users.manage permission
  router.use('/admin', requireAuth, requirePermission('users.manage'))

  // ── GET /api/admin/roles ─────────────────────────────────────────────────
  router.get('/admin/roles', async (_req, res, next) => {
    try {
      const { rows } = await pool.query<{ id: string; name: string; description: string; is_builtin: boolean; permissions: string[] }>(
        `SELECT r.id, r.name, r.description, r.is_builtin,
                COALESCE(array_agg(rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         GROUP BY r.id
         ORDER BY r.name`,
      )
      res.json({
        roles: rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          isBuiltin: r.is_builtin,
          permissions: r.permissions,
        })),
      })
    } catch (err) {
      next(err)
    }
  })

  // ── GET /api/admin/users ─────────────────────────────────────────────────
  router.get('/admin/users', async (_req, res, next) => {
    try {
      const { rows } = await pool.query<{
        id: string
        email: string
        display_name: string
        auth_mode: string
        status: string
        force_password_change: boolean
        created_at: string
        last_login_at: string | null
        roles: string[]
      }>(
        `SELECT u.id, u.email, u.display_name, u.auth_mode, u.status,
                u.force_password_change, u.created_at, u.last_login_at,
                COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE u.deleted_at IS NULL
         GROUP BY u.id
         ORDER BY u.created_at`,
      )
      res.json({
        users: rows.map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.display_name,
          authMode: u.auth_mode,
          status: u.status,
          forcePasswordChange: u.force_password_change,
          createdAt: u.created_at,
          lastLoginAt: u.last_login_at,
          roles: u.roles,
        })),
      })
    } catch (err) {
      next(err)
    }
  })

  // ── POST /api/admin/users ────────────────────────────────────────────────
  router.post('/admin/users', async (req, res, next) => {
    const client = await pool.connect()
    try {
      const { email, displayName, role, password } = req.body as {
        email?: unknown
        displayName?: unknown
        role?: unknown
        password?: unknown
      }

      if (
        typeof email !== 'string' || !email.trim() ||
        typeof displayName !== 'string' || !displayName.trim() ||
        typeof role !== 'string' || !role.trim() ||
        typeof password !== 'string' || !password
      ) {
        res.status(400).json({ error: 'email, displayName, role, and password are required' })
        return
      }

      // Validate role exists
      const { rows: roleRows } = await pool.query<{ id: string }>(
        `SELECT id FROM roles WHERE name = $1`,
        [role.trim()],
      )
      if (!roleRows[0]) {
        res.status(400).json({ error: `Unknown role: ${role}` })
        return
      }

      const passwordHash = await hashPassword(password)

      await client.query('BEGIN')

      const { rows: userRows } = await client.query<{ id: string }>(
        `INSERT INTO users (auth_mode, email, display_name, password_hash, status, force_password_change)
         VALUES ('self', $1, $2, $3, 'active', TRUE)
         RETURNING id`,
        [email.trim().toLowerCase(), displayName.trim(), passwordHash],
      ).catch((err: { code?: string }) => {
        if (err.code === '23505') {
          throw Object.assign(new Error('DUPLICATE'), { isDuplicate: true })
        }
        throw err
      })

      await client.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userRows[0]!.id, roleRows[0]!.id],
      )

      await client.query('COMMIT')

      res.status(201).json({
        user: {
          id: userRows[0]!.id,
          email: email.trim().toLowerCase(),
          displayName: displayName.trim(),
          role: role.trim(),
          forcePasswordChange: true,
        },
      })
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {})
      if (err instanceof Error && (err as Error & { isDuplicate?: boolean }).isDuplicate) {
        res.status(409).json({ error: 'A user with that email already exists' })
        return
      }
      next(err)
    } finally {
      client.release()
    }
  })

  // ── PATCH /api/admin/users/:id ────────────────────────────────────────────
  router.patch('/admin/users/:id', async (req, res, next) => {
    try {
      const { id } = req.params
      const { status, role, displayName } = req.body as {
        status?: unknown
        role?: unknown
        displayName?: unknown
      }

      const valid_statuses = ['active', 'suspended', 'pending']
      if (status !== undefined && (typeof status !== 'string' || !valid_statuses.includes(status))) {
        res.status(400).json({ error: `status must be one of: ${valid_statuses.join(', ')}` })
        return
      }

      // Apply status / displayName update
      if (status !== undefined || displayName !== undefined) {
        const updates: string[] = []
        const params: unknown[] = []
        let idx = 1

        if (status !== undefined) {
          updates.push(`status = $${idx++}`)
          params.push(status)
        }
        if (typeof displayName === 'string' && displayName.trim()) {
          updates.push(`display_name = $${idx++}`)
          params.push(displayName.trim())
        }

        if (updates.length > 0) {
          params.push(id)
          const { rowCount } = await pool.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`,
            params,
          )
          if (rowCount === 0) {
            res.status(404).json({ error: 'User not found' })
            return
          }
        }
      }

      // Apply role change
      if (typeof role === 'string' && role.trim()) {
        const { rows: roleRows } = await pool.query<{ id: string }>(
          `SELECT id FROM roles WHERE name = $1`,
          [role.trim()],
        )
        if (!roleRows[0]) {
          res.status(400).json({ error: `Unknown role: ${role}` })
          return
        }
        await pool.query(`DELETE FROM user_roles WHERE user_id = $1`, [id])
        await pool.query(
          `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
          [id, roleRows[0].id],
        )
      }

      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // ── GET /api/admin/smtp — get current SMTP settings (obfuscated) ─────────
  router.get('/admin/smtp', async (_req, res, next) => {
    try {
      const { rows } = await pool.query<{ value: Record<string, unknown> }>(
        `SELECT value FROM settings WHERE key = 'smtp'`,
      )
      const cfg = rows[0]?.value ?? {}
      // Never return the password in plaintext
      res.json({
        smtp: {
          host: cfg['host'] ?? null,
          port: cfg['port'] ?? 587,
          secure: cfg['secure'] ?? false,
          user: cfg['user'] ?? null,
          from: cfg['from'] ?? null,
          hasPassword: Boolean(cfg['password']),
        },
      })
    } catch (err) {
      next(err)
    }
  })

  // ── PUT /api/admin/smtp — save SMTP settings ──────────────────────────────
  router.put('/admin/smtp', async (req, res, next) => {
    try {
      const { host, port, secure, user, password, from } = req.body as {
        host?: unknown
        port?: unknown
        secure?: unknown
        user?: unknown
        password?: unknown
        from?: unknown
      }

      if (typeof host !== 'string' || !host.trim()) {
        res.status(400).json({ error: 'host is required' })
        return
      }

      // Fetch existing to preserve password if not updating
      const { rows: existingRows } = await pool.query<{ value: Record<string, unknown> }>(
        `SELECT value FROM settings WHERE key = 'smtp'`,
      )
      const existing = existingRows[0]?.value ?? {}
      const existingPassword = existing['password']

      const newCfg = {
        host: String(host).trim(),
        port: typeof port === 'number' ? port : parseInt(String(port ?? '587'), 10),
        secure: Boolean(secure),
        user: user != null ? String(user) : null,
        password: typeof password === 'string' && password ? password : existingPassword,
        from: from != null ? String(from) : null,
      }

      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('smtp', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify(newCfg)],
      )

      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // ── POST /api/admin/smtp/test — send a test email ─────────────────────────
  router.post('/admin/smtp/test', async (req, res, next) => {
    try {
      const { to } = req.body as { to?: unknown }
      if (typeof to !== 'string' || !to.trim()) {
        res.status(400).json({ error: 'to (email address) is required' })
        return
      }

      // Load SMTP config from settings
      const { rows } = await pool.query<{ value: Record<string, string | number | boolean> }>(
        `SELECT value FROM settings WHERE key = 'smtp'`,
      )
      const cfg = rows[0]?.value
      if (!cfg || !cfg['host']) {
        res.status(422).json({ error: 'SMTP is not configured. Save SMTP settings first.' })
        return
      }

      const smtpConfig = buildSmtpConfig({
        SMTP_HOST: String(cfg['host'] ?? ''),
        SMTP_PORT: String(cfg['port'] ?? '587'),
        SMTP_SECURE: cfg['secure'] ? '1' : '0',
        SMTP_USER: cfg['user'] != null ? String(cfg['user']) : undefined,
        SMTP_PASS: cfg['password'] != null ? String(cfg['password']) : undefined,
        SMTP_FROM: cfg['from'] != null ? String(cfg['from']) : undefined,
      })

      // Load appTitle from settings
      const { rows: titleRows } = await pool.query<{ value: string }>(
        `SELECT value FROM settings WHERE key = 'appTitle'`,
      )
      const appTitle = String(titleRows[0]?.value ?? '"BI Root"').replace(/^"|"$/g, '')

      const emailBody = buildNotificationEmailBody({
        title: 'Test email from BI Root',
        bodyText: 'If you received this, SMTP is configured correctly.',
        severity: 'info',
        appTitle,
      })

      const result = await sendEmail(smtpConfig, {
        to: to.trim(),
        subject: emailBody.subject,
        text: emailBody.text,
        html: emailBody.html,
      }).catch((err: Error) => ({ delivered: false, error: err.message }))

      if (result.delivered) {
        res.json({ ok: true, messageId: result.messageId })
      } else {
        res.status(422).json({ ok: false, error: result.error ?? 'Send failed' })
      }
    } catch (err) {
      next(err)
    }
  })

  // ── GET /api/admin/audit — audit log (admin only, read-only) ─────────────
  router.get('/admin/audit', requirePermission('audit.read'), async (req, res, next) => {
    try {
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '50'), 10), 200)
      const offset = parseInt(String(req.query['offset'] ?? '0'), 10)
      const action = req.query['action'] ? String(req.query['action']) : null
      const actorId = req.query['actorId'] ? String(req.query['actorId']) : null

      const conditions: string[] = []
      const params: unknown[] = []
      let idx = 1

      if (action) {
        conditions.push(`action = $${idx++}`)
        params.push(action)
      }
      if (actorId) {
        conditions.push(`actor_id = $${idx++}`)
        params.push(actorId)
      }

      params.push(limit, offset)
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      const { rows } = await pool.query(
        `SELECT al.id, al.actor_id, u.email AS actor_email, al.action, al.target_type, al.target_id,
                al.ip, al.user_agent, al.result, al.ts, al.detail
         FROM audit_log al
         LEFT JOIN users u ON u.id = al.actor_id
         ${where}
         ORDER BY al.ts DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        params,
      )

      res.json({ entries: rows })
    } catch (err) {
      next(err)
    }
  })

  return router
}
