import { Router } from 'express'
import type { Pool } from 'pg'
import { requireAuth, requirePermission } from '../middleware/rbac.ts'

type ItemType = 'servers' | 'apps' | 'documents' | 'secrets' | 'users'

const VALID_TYPES = new Set<ItemType>(['servers', 'apps', 'documents', 'secrets', 'users'])

interface TableConfig {
  table: string
  labelCol: string
  permission: string
}

const TYPE_CONFIG: Record<ItemType, TableConfig> = {
  servers:   { table: 'servers',   labelCol: 'hostname', permission: 'infra.read' },
  apps:      { table: 'apps',      labelCol: 'name',     permission: 'infra.read' },
  documents: { table: 'documents', labelCol: 'filename', permission: 'docs.read' },
  secrets:   { table: 'secrets',   labelCol: 'title',    permission: 'vault.manage_access' },
  users:     { table: 'users',     labelCol: 'email',    permission: 'users.manage' },
}

export function recycleBinRouter(pool: Pool): Router {
  const router = Router()

  // ── GET /api/recycle-bin?type=... ──────────────────────────────────────────
  router.get('/recycle-bin', requireAuth, async (req, res, next) => {
    try {
      const { type } = req.query as { type?: string }

      if (!type || !VALID_TYPES.has(type as ItemType)) {
        res.status(400).json({ error: 'Invalid or missing type. Must be one of: servers, apps, documents, secrets, users' })
        return
      }

      const itemType = type as ItemType
      const cfg = TYPE_CONFIG[itemType]

      // Check permission
      if (!(req.session.permissions ?? []).includes(cfg.permission)) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }

      const { rows } = await pool.query<{ id: string; label: string; deleted_at: string }>(
        `SELECT id, ${cfg.labelCol} AS label, deleted_at
         FROM ${cfg.table}
         WHERE deleted_at IS NOT NULL
         ORDER BY deleted_at DESC
         LIMIT 100`,
      )

      res.json({
        items: rows.map((r) => ({
          id: r.id,
          type: itemType,
          label: r.label,
          deletedAt: r.deleted_at,
        })),
      })
    } catch (err) {
      next(err)
    }
  })

  // ── POST /api/recycle-bin/:type/:id/restore ────────────────────────────────
  router.post('/recycle-bin/:type/:id/restore', requireAuth, async (req, res, next) => {
    try {
      const { type, id } = req.params as { type: string; id: string }

      if (!type || !VALID_TYPES.has(type as ItemType)) {
        res.status(400).json({ error: 'Invalid type. Must be one of: servers, apps, documents, secrets, users' })
        return
      }

      const itemType = type as ItemType
      const cfg = TYPE_CONFIG[itemType]

      // Check permission
      if (!(req.session.permissions ?? []).includes(cfg.permission)) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }

      const { rowCount } = await pool.query(
        `UPDATE ${cfg.table} SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL`,
        [id],
      )

      if (rowCount === 0) {
        res.status(404).json({ error: 'Item not found in recycle bin' })
        return
      }

      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  return router
}
