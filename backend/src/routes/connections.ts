import { Router } from 'express'
import type { Pool } from 'pg'
import { requireAuth, requirePermission } from '../middleware/rbac.ts'

export function connectionsRouter(pool: Pool): Router {
  const router = Router()

  // ── Connections ────────────────────────────────────────────────────────────

  router.get('/connections', requireAuth, requirePermission('infra.read'), async (_req, res, next) => {
    try {
      const { rows } = await pool.query<{
        id: string
        from_app_instance_id: string
        to_app_instance_id: string
        label: string | null
        protocol: string | null
        notes: string | null
        created_at: string
        from_app_name: string
        from_server_hostname: string
        to_app_name: string
        to_server_hostname: string
      }>(
        `SELECT c.id, c.from_app_instance_id, c.to_app_instance_id,
                c.label, c.protocol, c.notes, c.created_at,
                fa.name AS from_app_name, fs.hostname AS from_server_hostname,
                ta.name AS to_app_name, ts.hostname AS to_server_hostname
         FROM connections c
         JOIN app_instances fai ON fai.id = c.from_app_instance_id
         JOIN apps fa ON fa.id = fai.app_id
         JOIN servers fs ON fs.id = fai.server_id
         JOIN app_instances tai ON tai.id = c.to_app_instance_id
         JOIN apps ta ON ta.id = tai.app_id
         JOIN servers ts ON ts.id = tai.server_id
         ORDER BY c.created_at DESC`,
      )
      res.json({ connections: rows.map(mapConnection) })
    } catch (err) { next(err) }
  })

  router.post('/connections', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { fromAppInstanceId, toAppInstanceId, label, protocol, notes } =
        req.body as Record<string, unknown>

      if (typeof fromAppInstanceId !== 'string' || !fromAppInstanceId) {
        res.status(400).json({ error: 'fromAppInstanceId is required' }); return
      }
      if (typeof toAppInstanceId !== 'string' || !toAppInstanceId) {
        res.status(400).json({ error: 'toAppInstanceId is required' }); return
      }

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO connections (from_app_instance_id, to_app_instance_id, label, protocol, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          fromAppInstanceId, toAppInstanceId,
          typeof label === 'string' ? label.trim() || null : null,
          typeof protocol === 'string' ? protocol.trim() || null : null,
          typeof notes === 'string' ? notes.trim() || null : null,
        ],
      )
      res.status(201).json({ connection: { id: rows[0]!.id } })
    } catch (err) { next(err) }
  })

  router.patch('/connections/:id', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { label, protocol, notes } = req.body as Record<string, unknown>
      const updates: string[] = []
      const params: unknown[] = []
      let idx = 1

      if (label !== undefined) { updates.push(`label = $${idx++}`); params.push(typeof label === 'string' ? label.trim() || null : null) }
      if (protocol !== undefined) { updates.push(`protocol = $${idx++}`); params.push(typeof protocol === 'string' ? protocol.trim() || null : null) }
      if (notes !== undefined) { updates.push(`notes = $${idx++}`); params.push(typeof notes === 'string' ? notes.trim() || null : null) }

      if (updates.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return }

      params.push(req.params['id'])
      const { rowCount } = await pool.query(
        `UPDATE connections SET ${updates.join(', ')} WHERE id = $${idx}`,
        params,
      )
      if (rowCount === 0) { res.status(404).json({ error: 'Connection not found' }); return }
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  router.delete('/connections/:id', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { rowCount } = await pool.query(
        `DELETE FROM connections WHERE id = $1`,
        [req.params['id']],
      )
      if (rowCount === 0) { res.status(404).json({ error: 'Connection not found' }); return }
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  // Connections for a specific app instance (both directions)
  router.get('/app-instances/:id/connections', requireAuth, requirePermission('infra.read'), async (req, res, next) => {
    try {
      const { id } = req.params
      const { rows } = await pool.query<{
        id: string
        from_app_instance_id: string
        to_app_instance_id: string
        label: string | null
        protocol: string | null
        notes: string | null
        created_at: string
        from_app_name: string
        from_server_hostname: string
        to_app_name: string
        to_server_hostname: string
      }>(
        `SELECT c.id, c.from_app_instance_id, c.to_app_instance_id,
                c.label, c.protocol, c.notes, c.created_at,
                fa.name AS from_app_name, fs.hostname AS from_server_hostname,
                ta.name AS to_app_name, ts.hostname AS to_server_hostname
         FROM connections c
         JOIN app_instances fai ON fai.id = c.from_app_instance_id
         JOIN apps fa ON fa.id = fai.app_id
         JOIN servers fs ON fs.id = fai.server_id
         JOIN app_instances tai ON tai.id = c.to_app_instance_id
         JOIN apps ta ON ta.id = tai.app_id
         JOIN servers ts ON ts.id = tai.server_id
         WHERE c.from_app_instance_id = $1 OR c.to_app_instance_id = $1
         ORDER BY c.created_at DESC`,
        [id],
      )
      res.json({ connections: rows.map(mapConnection) })
    } catch (err) { next(err) }
  })

  return router
}

function mapConnection(r: {
  id: string
  from_app_instance_id: string
  to_app_instance_id: string
  label: string | null
  protocol: string | null
  notes: string | null
  created_at: string
  from_app_name: string
  from_server_hostname: string
  to_app_name: string
  to_server_hostname: string
}) {
  return {
    id: r.id,
    fromAppInstanceId: r.from_app_instance_id,
    toAppInstanceId: r.to_app_instance_id,
    label: r.label,
    protocol: r.protocol,
    notes: r.notes,
    createdAt: r.created_at,
    from: { appName: r.from_app_name, serverHostname: r.from_server_hostname },
    to: { appName: r.to_app_name, serverHostname: r.to_server_hostname },
  }
}
