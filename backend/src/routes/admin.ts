import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import { requireAuth, requirePermission } from '../middleware/rbac.ts'
import { hashPassword } from '../auth/self.ts'
import { buildSmtpConfig, sendEmail, buildNotificationEmailBody } from '../integrations/smtp.ts'
import { hashApiKey } from '../middleware/apiKey.ts'

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
  // Creates a new user account.
  // For self mode: email, displayName, role, password (required).
  // For ldap mode: email, displayName, role, authMode='ldap' (no password — auth is via AD bind).
  // For keycloak mode: email, displayName, role, authMode='keycloak' (no password — provisioned on first login).
  router.post('/admin/users', async (req, res, next) => {
    const client = await pool.connect()
    try {
      const { email, displayName, role, password, authMode } = req.body as {
        email?: unknown
        displayName?: unknown
        role?: unknown
        password?: unknown
        authMode?: unknown
      }

      const resolvedAuthMode = typeof authMode === 'string' && ['self', 'ldap', 'keycloak'].includes(authMode)
        ? (authMode as 'self' | 'ldap' | 'keycloak')
        : 'self'

      if (
        typeof email !== 'string' || !email.trim() ||
        typeof displayName !== 'string' || !displayName.trim() ||
        typeof role !== 'string' || !role.trim()
      ) {
        res.status(400).json({ error: 'email, displayName, and role are required' })
        return
      }

      // Password required only for self mode
      if (resolvedAuthMode === 'self' && (typeof password !== 'string' || !password)) {
        res.status(400).json({ error: 'password is required for self-auth users' })
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

      const passwordHash = resolvedAuthMode === 'self' && typeof password === 'string'
        ? await hashPassword(password)
        : null

      await client.query('BEGIN')

      const { rows: userRows } = await client.query<{ id: string }>(
        `INSERT INTO users (auth_mode, email, display_name, password_hash, status, force_password_change)
         VALUES ($1, $2, $3, $4, 'active', $5)
         RETURNING id`,
        [
          resolvedAuthMode,
          email.trim().toLowerCase(),
          displayName.trim(),
          passwordHash,
          resolvedAuthMode === 'self', // force_password_change only for self mode
        ],
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
          authMode: resolvedAuthMode,
          role: role.trim(),
          forcePasswordChange: resolvedAuthMode === 'self',
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

  // ── GET /api/admin/settings/auth-mappings — group→role mapping config ───────
  // Used by Keycloak (C7.2) and LDAP (C7.3) providers to map external groups to BI-Ro roles.
  // For self mode this returns an empty mapping. Requires settings.manage permission.
  router.get(
    '/admin/settings/auth-mappings',
    requirePermission('settings.manage'),
    async (_req, res, next) => {
      try {
        const { rows } = await pool.query<{ value: Record<string, unknown> }>(
          `SELECT value FROM settings WHERE key = 'auth_mappings'`,
        )
        const mappings = rows[0]?.value ?? { groups: {} }
        res.json({ mappings })
      } catch (err) {
        next(err)
      }
    },
  )

  // ── PUT /api/admin/settings/auth-mappings — save group→role mapping config ──
  router.put(
    '/admin/settings/auth-mappings',
    requirePermission('settings.manage'),
    async (req, res, next) => {
      try {
        const { groups } = req.body as { groups?: unknown }
        if (!groups || typeof groups !== 'object' || Array.isArray(groups)) {
          res.status(400).json({ error: 'groups must be an object mapping external group names to BI-Ro role names' })
          return
        }
        // Validate all values are strings
        for (const [key, val] of Object.entries(groups as Record<string, unknown>)) {
          if (typeof key !== 'string' || typeof val !== 'string') {
            res.status(400).json({ error: 'Each mapping entry must be { "groupName": "biroRoleName" }' })
            return
          }
        }
        const mappings = { groups }
        await pool.query(
          `INSERT INTO settings (key, value) VALUES ('auth_mappings', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [JSON.stringify(mappings)],
        )
        res.json({ ok: true })
      } catch (err) {
        next(err)
      }
    },
  )

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

  // ── POST /api/admin/api-clients — create API client ──────────────────────
  // Returns raw key once — only the SHA-256 hash is stored
  router.post('/admin/api-clients', async (req, res, next) => {
    try {
      const { name, scopes, rateLimit } = req.body as {
        name?: unknown
        scopes?: unknown
        rateLimit?: unknown
      }

      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'name is required' })
        return
      }

      const resolvedScopes = Array.isArray(scopes) ? scopes.filter((s): s is string => typeof s === 'string') : []
      const resolvedRateLimit = typeof rateLimit === 'number' && rateLimit > 0 ? rateLimit : 60

      // Generate random API key and hash it for storage
      const rawKey = randomBytes(32).toString('base64url')
      const keyHash = hashApiKey(rawKey)

      const { rows } = await pool.query<{ id: string; name: string; created_at: string }>(
        `INSERT INTO api_clients (name, key_hash, scopes, rate_limit, created_by)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         RETURNING id, name, created_at`,
        [name.trim(), keyHash, JSON.stringify(resolvedScopes), resolvedRateLimit, req.session.userId],
      )

      // Return raw key once — never retrievable again
      res.status(201).json({
        id: rows[0]!.id,
        name: rows[0]!.name,
        scopes: resolvedScopes,
        rateLimit: resolvedRateLimit,
        createdAt: rows[0]!.created_at,
        key: rawKey, // shown once only
      })
    } catch (err) {
      next(err)
    }
  })

  // ── GET /api/admin/api-clients — list API clients ────────────────────────
  // Never exposes key_hash or raw key
  router.get('/admin/api-clients', async (_req, res, next) => {
    try {
      const { rows } = await pool.query<{
        id: string
        name: string
        scopes: string[]
        rate_limit: number
        created_at: string
        revoked_at: string | null
      }>(
        `SELECT id, name, scopes, rate_limit, created_at, revoked_at
         FROM api_clients
         ORDER BY created_at DESC`,
      )
      res.json({
        clients: rows.map((r) => ({
          id: r.id,
          name: r.name,
          scopes: r.scopes,
          rateLimit: r.rate_limit,
          createdAt: r.created_at,
          revokedAt: r.revoked_at,
          active: r.revoked_at == null,
        })),
      })
    } catch (err) {
      next(err)
    }
  })

  // ── DELETE /api/admin/api-clients/:id — revoke API client ────────────────
  router.delete('/admin/api-clients/:id', async (req, res, next) => {
    try {
      const { rowCount } = await pool.query(
        `UPDATE api_clients SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
        [req.params['id']],
      )
      if (rowCount === 0) {
        res.status(404).json({ error: 'API client not found or already revoked' })
        return
      }
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // ── POST /api/admin/webhook-endpoints — create webhook endpoint ───────────
  router.post('/admin/webhook-endpoints', async (req, res, next) => {
    try {
      const { name, url, secret, events } = req.body as {
        name?: unknown
        url?: unknown
        secret?: unknown
        events?: unknown
      }

      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'name is required' })
        return
      }
      if (typeof url !== 'string' || !url.trim()) {
        res.status(400).json({ error: 'url is required' })
        return
      }
      if (typeof secret !== 'string' || !secret) {
        res.status(400).json({ error: 'secret is required' })
        return
      }

      const resolvedEvents = Array.isArray(events)
        ? events.filter((e): e is string => typeof e === 'string')
        : ['secret.expiring', 'server.changed']

      const { rows } = await pool.query<{ id: string; name: string; url: string; events: string[]; created_at: string }>(
        `INSERT INTO webhook_endpoints (name, url, secret, events, created_by)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         RETURNING id, name, url, events, created_at`,
        [name.trim(), url.trim(), secret, JSON.stringify(resolvedEvents), req.session.userId],
      )

      // Never echo the secret back
      res.status(201).json({
        id: rows[0]!.id,
        name: rows[0]!.name,
        url: rows[0]!.url,
        events: rows[0]!.events,
        createdAt: rows[0]!.created_at,
      })
    } catch (err) {
      next(err)
    }
  })

  // ── GET /api/admin/webhook-endpoints — list webhook endpoints ─────────────
  // Never exposes the HMAC secret
  router.get('/admin/webhook-endpoints', async (_req, res, next) => {
    try {
      const { rows } = await pool.query<{
        id: string
        name: string
        url: string
        events: string[]
        enabled: boolean
        created_at: string
      }>(
        `SELECT id, name, url, events, enabled, created_at
         FROM webhook_endpoints
         ORDER BY created_at DESC`,
      )
      res.json({
        endpoints: rows.map((r) => ({
          id: r.id,
          name: r.name,
          url: r.url,
          events: r.events,
          enabled: r.enabled,
          createdAt: r.created_at,
        })),
      })
    } catch (err) {
      next(err)
    }
  })

  return router
}
