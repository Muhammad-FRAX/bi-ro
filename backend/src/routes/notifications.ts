import { Router } from 'express'
import type { Pool } from 'pg'
import { requireAuth, requirePermission } from '../middleware/rbac.ts'

export function notificationsRouter(pool: Pool): Router {
  const router = Router()

  // ── GET /api/notifications — list notifications (newest first) ──────────
  router.get('/notifications', requireAuth, async (req, res, next) => {
    try {
      const unreadOnly = req.query['unread'] === 'true'
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '50'), 10), 200)
      const offset = parseInt(String(req.query['offset'] ?? '0'), 10)

      const { rows } = await pool.query<{
        id: string
        type: string
        severity: string
        title: string
        body: string
        target_type: string | null
        target_id: string | null
        created_at: string
        read_at: string | null
      }>(
        `SELECT id, type, severity, title, body, target_type, target_id, created_at, read_at
         FROM notifications
         ${unreadOnly ? 'WHERE read_at IS NULL' : ''}
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      )

      res.json({
        notifications: rows.map((n) => ({
          id: n.id,
          type: n.type,
          severity: n.severity,
          title: n.title,
          body: n.body,
          targetType: n.target_type,
          targetId: n.target_id,
          createdAt: n.created_at,
          readAt: n.read_at,
        })),
      })
    } catch (err) {
      next(err)
    }
  })

  // ── GET /api/notifications/unread-count ─────────────────────────────────
  router.get('/notifications/unread-count', requireAuth, async (_req, res, next) => {
    try {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM notifications WHERE read_at IS NULL`,
      )
      res.json({ count: parseInt(rows[0]!.count, 10) })
    } catch (err) {
      next(err)
    }
  })

  // ── GET /api/notifications/expiring-soon — secrets (+ certs) near expiry ─
  router.get(
    '/notifications/expiring-soon',
    requireAuth,
    requirePermission('secrets.view'),
    async (req, res, next) => {
      try {
        const days = parseInt(String(req.query['days'] ?? '7'), 10)
        const userId = req.session.userId!
        const isAdmin = (req.session.permissions ?? []).includes('users.manage')

        // Secrets near expiry that the user can see (vault member or admin)
        const { rows } = await pool.query<{
          id: string
          title: string
          type: string
          vault_id: string
          vault_name: string
          days_remaining: number | null
          expires_at: string | null
          last_changed_at: string | null
          rotation_period_days: number | null
        }>(
          `SELECT s.id, s.title, s.type, s.vault_id, v.name AS vault_name,
                  s.expires_at, s.last_changed_at, s.rotation_period_days,
                  CASE
                    WHEN s.expires_at IS NOT NULL THEN
                      EXTRACT(EPOCH FROM (s.expires_at - now())) / 86400.0
                    WHEN s.rotation_period_days IS NOT NULL THEN
                      s.rotation_period_days - EXTRACT(EPOCH FROM (now() - s.last_changed_at)) / 86400.0
                    ELSE NULL
                  END AS days_remaining
           FROM secrets s
           JOIN vaults v ON v.id = s.vault_id
           ${isAdmin ? '' : 'JOIN vault_members vm ON vm.vault_id = s.vault_id AND vm.user_id = $2'}
           WHERE s.deleted_at IS NULL
             AND (
               (s.expires_at IS NOT NULL AND s.expires_at <= now() + ($1 * interval '1 day'))
               OR
               (s.rotation_period_days IS NOT NULL AND s.last_changed_at IS NOT NULL
                AND s.last_changed_at + (s.rotation_period_days * interval '1 day') <= now() + ($1 * interval '1 day'))
             )
           ORDER BY days_remaining ASC NULLS LAST
           LIMIT 20`,
          isAdmin ? [days] : [days, userId],
        )

        res.json({
          items: rows.map((r) => ({
            id: r.id,
            title: r.title,
            type: r.type,
            vaultId: r.vault_id,
            vaultName: r.vault_name,
            daysRemaining: r.days_remaining !== null ? Math.round(Number(r.days_remaining) * 10) / 10 : null,
            expiresAt: r.expires_at,
            lastChangedAt: r.last_changed_at,
            rotationPeriodDays: r.rotation_period_days,
          })),
        })
      } catch (err) {
        next(err)
      }
    },
  )

  // ── GET /api/notifications/rules — list notification rules ───────────────
  router.get(
    '/notifications/rules',
    requireAuth,
    requirePermission('settings.manage'),
    async (_req, res, next) => {
      try {
        const { rows } = await pool.query<{
          id: string
          kind: string
          threshold_days: number | null
          enabled: boolean
        }>(`SELECT id, kind, threshold_days, enabled FROM notification_rules ORDER BY kind, threshold_days`)
        res.json({
          rules: rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            thresholdDays: r.threshold_days,
            enabled: r.enabled,
          })),
        })
      } catch (err) {
        next(err)
      }
    },
  )

  // ── PATCH /api/notifications/rules/:id — update rule ─────────────────────
  router.patch(
    '/notifications/rules/:id',
    requireAuth,
    requirePermission('settings.manage'),
    async (req, res, next) => {
      try {
        const { id } = req.params
        const { enabled } = req.body as { enabled?: unknown }
        if (typeof enabled !== 'boolean') {
          res.status(400).json({ error: 'enabled (boolean) is required' })
          return
        }
        const { rowCount } = await pool.query(
          `UPDATE notification_rules SET enabled = $1, updated_at = now() WHERE id = $2`,
          [enabled, id],
        )
        if (rowCount === 0) {
          res.status(404).json({ error: 'Rule not found' })
          return
        }
        res.json({ ok: true })
      } catch (err) {
        next(err)
      }
    },
  )

  // ── POST /api/notifications — create notification (internal/admin use) ───
  router.post('/notifications', requireAuth, async (req, res, next) => {
    try {
      const { type, severity, title, body, targetType, targetId } = req.body as {
        type?: unknown
        severity?: unknown
        title?: unknown
        body?: unknown
        targetType?: unknown
        targetId?: unknown
      }

      const validTypes = ['expiry', 'cert_expiry', 'worker_stale', 'system']
      const validSeverities = ['info', 'warning', 'danger']

      if (!type || !validTypes.includes(String(type))) {
        res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` })
        return
      }
      if (!severity || !validSeverities.includes(String(severity))) {
        res.status(400).json({ error: `severity must be one of: ${validSeverities.join(', ')}` })
        return
      }
      if (typeof title !== 'string' || !title.trim()) {
        res.status(400).json({ error: 'title is required' })
        return
      }

      const validTargetTypes = ['secret', 'server', 'cert', null, undefined]
      if (targetType !== null && targetType !== undefined && !validTargetTypes.includes(String(targetType))) {
        res.status(400).json({ error: 'targetType must be secret, server, cert, or null' })
        return
      }

      const { rows } = await pool.query<{
        id: string
        type: string
        severity: string
        title: string
        body: string
        target_type: string | null
        target_id: string | null
        created_at: string
        read_at: string | null
      }>(
        `INSERT INTO notifications (type, severity, title, body, target_type, target_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, type, severity, title, body, target_type, target_id, created_at, read_at`,
        [
          String(type),
          String(severity),
          title.trim(),
          typeof body === 'string' ? body : '',
          targetType ?? null,
          targetId ?? null,
        ],
      )

      res.status(201).json({
        notification: {
          id: rows[0]!.id,
          type: rows[0]!.type,
          severity: rows[0]!.severity,
          title: rows[0]!.title,
          body: rows[0]!.body,
          targetType: rows[0]!.target_type,
          targetId: rows[0]!.target_id,
          createdAt: rows[0]!.created_at,
          readAt: rows[0]!.read_at,
        },
      })
    } catch (err) {
      next(err)
    }
  })

  // ── PATCH /api/notifications/:id/read — mark single notification as read ─
  router.patch('/notifications/:id/read', requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params
      const { rowCount } = await pool.query(
        `UPDATE notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL`,
        [id],
      )
      if (rowCount === 0) {
        // Either not found or already read — both are OK
        res.json({ ok: true })
        return
      }
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // ── PATCH /api/notifications/read-all — mark all notifications as read ──
  router.patch('/notifications/read-all', requireAuth, async (_req, res, next) => {
    try {
      await pool.query(`UPDATE notifications SET read_at = now() WHERE read_at IS NULL`)
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  return router
}

// Exported for use by expiry worker
export async function createNotification(
  pool: Pool,
  {
    type,
    severity,
    title,
    body,
    targetType,
    targetId,
  }: {
    type: 'expiry' | 'cert_expiry' | 'worker_stale' | 'system'
    severity: 'info' | 'warning' | 'danger'
    title: string
    body: string
    targetType?: 'secret' | 'server' | 'cert' | null
    targetId?: string | null
  },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO notifications (type, severity, title, body, target_type, target_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [type, severity, title, body, targetType ?? null, targetId ?? null],
  )
  return rows[0]!.id
}
