import { Router } from 'express'
import type { Pool } from 'pg'
import { requireAuth, requirePermission } from '../middleware/rbac.ts'

const VALID_ENVIRONMENTS = ['prod', 'staging', 'dev', 'other'] as const
const VALID_STATUSES = ['active', 'decommissioned', 'maintenance'] as const

type Environment = typeof VALID_ENVIRONMENTS[number]
type Status = typeof VALID_STATUSES[number]

function isValidEnv(v: unknown): v is Environment {
  return typeof v === 'string' && (VALID_ENVIRONMENTS as readonly string[]).includes(v)
}

function isValidStatus(v: unknown): v is Status {
  return typeof v === 'string' && (VALID_STATUSES as readonly string[]).includes(v)
}

export function serversRouter(pool: Pool): Router {
  const router = Router()

  // ── Tags ──────────────────────────────────────────────────────────────────

  router.get('/tags', requireAuth, requirePermission('infra.read'), async (_req, res, next) => {
    try {
      const { rows } = await pool.query<{ id: string; name: string; color: string }>(
        `SELECT id, name, color FROM tags ORDER BY name`,
      )
      res.json({ tags: rows })
    } catch (err) {
      next(err)
    }
  })

  router.post('/tags', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { name, color } = req.body as { name?: unknown; color?: unknown }
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'name is required' })
        return
      }
      const tagColor = typeof color === 'string' && color.trim() ? color.trim() : '#a78bfa'
      const { rows } = await pool.query<{ id: string; name: string; color: string }>(
        `INSERT INTO tags (name, color) VALUES ($1, $2) RETURNING id, name, color`,
        [name.trim(), tagColor],
      ).catch((err: { code?: string }) => {
        if (err.code === '23505') throw Object.assign(new Error('DUPLICATE'), { isDuplicate: true })
        throw err
      })
      res.status(201).json({ tag: rows[0]! })
    } catch (err: unknown) {
      if (err instanceof Error && (err as Error & { isDuplicate?: boolean }).isDuplicate) {
        res.status(409).json({ error: 'A tag with that name already exists' })
        return
      }
      next(err)
    }
  })

  router.patch('/tags/:id', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { id } = req.params
      const { name, color } = req.body as { name?: unknown; color?: unknown }
      const updates: string[] = []
      const params: unknown[] = []
      let idx = 1
      if (typeof name === 'string' && name.trim()) { updates.push(`name = $${idx++}`); params.push(name.trim()) }
      if (typeof color === 'string' && color.trim()) { updates.push(`color = $${idx++}`); params.push(color.trim()) }
      if (updates.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return }
      params.push(id)
      const { rowCount } = await pool.query(`UPDATE tags SET ${updates.join(', ')} WHERE id = $${idx}`, params)
      if (rowCount === 0) { res.status(404).json({ error: 'Tag not found' }); return }
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  router.delete('/tags/:id', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { rowCount } = await pool.query(`DELETE FROM tags WHERE id = $1`, [req.params['id']])
      if (rowCount === 0) { res.status(404).json({ error: 'Tag not found' }); return }
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  // ── Servers ────────────────────────────────────────────────────────────────

  router.get('/servers', requireAuth, requirePermission('infra.read'), async (req, res, next) => {
    try {
      const { environment, status, tag } = req.query as { environment?: string; status?: string; tag?: string }

      const conditions: string[] = ['s.deleted_at IS NULL']
      const params: unknown[] = []
      let idx = 1

      if (environment) {
        conditions.push(`s.environment = $${idx++}`)
        params.push(environment)
      }
      if (status) {
        conditions.push(`s.status = $${idx++}`)
        params.push(status)
      }
      if (tag) {
        conditions.push(`EXISTS (
          SELECT 1 FROM server_tags st
          JOIN tags t ON t.id = st.tag_id
          WHERE st.server_id = s.id AND t.name = $${idx++}
        )`)
        params.push(tag)
      }

      const where = conditions.join(' AND ')

      const { rows } = await pool.query<{
        id: string; hostname: string; environment: string; os: string | null
        location: string | null; status: string; ips: unknown; aliases: unknown
        notes: string | null; created_at: string; updated_at: string
        tags: Array<{ id: string; name: string; color: string }>
      }>(
        `SELECT s.id, s.hostname, s.environment, s.os, s.location, s.status,
                s.ips, s.aliases, s.notes, s.created_at, s.updated_at,
                COALESCE(
                  json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
                  FILTER (WHERE t.id IS NOT NULL), '[]'
                ) AS tags
         FROM servers s
         LEFT JOIN server_tags st ON st.server_id = s.id
         LEFT JOIN tags t ON t.id = st.tag_id
         WHERE ${where}
         GROUP BY s.id
         ORDER BY s.hostname`,
        params,
      )

      res.json({
        servers: rows.map((r) => ({
          id: r.id,
          hostname: r.hostname,
          environment: r.environment,
          os: r.os,
          location: r.location,
          status: r.status,
          ips: r.ips,
          aliases: r.aliases,
          notes: r.notes,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          tags: r.tags,
        })),
      })
    } catch (err) { next(err) }
  })

  router.post('/servers', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { hostname, environment, os, location, cpu_ram_disk, status, notes, ips, aliases } =
        req.body as Record<string, unknown>

      if (typeof hostname !== 'string' || !hostname.trim()) {
        res.status(400).json({ error: 'hostname is required' })
        return
      }
      const env = environment ?? 'other'
      if (!isValidEnv(env)) {
        res.status(400).json({ error: `environment must be one of: ${VALID_ENVIRONMENTS.join(', ')}` })
        return
      }
      const srv_status = status ?? 'active'
      if (!isValidStatus(srv_status)) {
        res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` })
        return
      }

      const ipsVal = Array.isArray(ips) ? JSON.stringify(ips) : '[]'
      const aliasesVal = Array.isArray(aliases) ? JSON.stringify(aliases) : '[]'

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO servers (hostname, environment, os, location, cpu_ram_disk, status, notes, ips, aliases)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
         RETURNING id`,
        [
          hostname.trim(), env,
          typeof os === 'string' ? os.trim() || null : null,
          typeof location === 'string' ? location.trim() || null : null,
          typeof cpu_ram_disk === 'string' ? cpu_ram_disk.trim() || null : null,
          srv_status,
          typeof notes === 'string' ? notes.trim() || null : null,
          ipsVal, aliasesVal,
        ],
      )
      res.status(201).json({
        server: {
          id: rows[0]!.id,
          hostname: hostname.trim(),
          environment: env,
          status: srv_status,
        },
      })
    } catch (err) { next(err) }
  })

  router.get('/servers/:id', requireAuth, requirePermission('infra.read'), async (req, res, next) => {
    try {
      const { id } = req.params
      const { rows } = await pool.query<{
        id: string; hostname: string; environment: string; os: string | null
        location: string | null; cpu_ram_disk: string | null; status: string
        ips: unknown; aliases: unknown; notes: string | null
        created_at: string; updated_at: string
        tags: Array<{ id: string; name: string; color: string }>
      }>(
        `SELECT s.id, s.hostname, s.environment, s.os, s.location, s.cpu_ram_disk,
                s.status, s.ips, s.aliases, s.notes, s.created_at, s.updated_at,
                COALESCE(
                  json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
                  FILTER (WHERE t.id IS NOT NULL), '[]'
                ) AS tags
         FROM servers s
         LEFT JOIN server_tags st ON st.server_id = s.id
         LEFT JOIN tags t ON t.id = st.tag_id
         WHERE s.id = $1 AND s.deleted_at IS NULL
         GROUP BY s.id`,
        [id],
      )
      if (!rows[0]) { res.status(404).json({ error: 'Server not found' }); return }
      const r = rows[0]
      res.json({
        server: {
          id: r.id,
          hostname: r.hostname,
          environment: r.environment,
          os: r.os,
          location: r.location,
          cpuRamDisk: r.cpu_ram_disk,
          status: r.status,
          ips: r.ips,
          aliases: r.aliases,
          notes: r.notes,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          tags: r.tags,
        },
      })
    } catch (err) { next(err) }
  })

  router.patch('/servers/:id', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { id } = req.params
      const { hostname, environment, os, location, cpu_ram_disk, status, notes, ips, aliases } =
        req.body as Record<string, unknown>

      if (environment !== undefined && !isValidEnv(environment)) {
        res.status(400).json({ error: `environment must be one of: ${VALID_ENVIRONMENTS.join(', ')}` })
        return
      }
      if (status !== undefined && !isValidStatus(status)) {
        res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` })
        return
      }

      const updates: string[] = ['updated_at = NOW()']
      const params: unknown[] = []
      let idx = 1

      if (typeof hostname === 'string' && hostname.trim()) { updates.push(`hostname = $${idx++}`); params.push(hostname.trim()) }
      if (environment !== undefined) { updates.push(`environment = $${idx++}`); params.push(environment) }
      if (os !== undefined) { updates.push(`os = $${idx++}`); params.push(typeof os === 'string' ? os.trim() || null : null) }
      if (location !== undefined) { updates.push(`location = $${idx++}`); params.push(typeof location === 'string' ? location.trim() || null : null) }
      if (cpu_ram_disk !== undefined) { updates.push(`cpu_ram_disk = $${idx++}`); params.push(typeof cpu_ram_disk === 'string' ? cpu_ram_disk.trim() || null : null) }
      if (status !== undefined) { updates.push(`status = $${idx++}`); params.push(status) }
      if (notes !== undefined) { updates.push(`notes = $${idx++}`); params.push(typeof notes === 'string' ? notes.trim() || null : null) }
      if (Array.isArray(ips)) { updates.push(`ips = $${idx++}::jsonb`); params.push(JSON.stringify(ips)) }
      if (Array.isArray(aliases)) { updates.push(`aliases = $${idx++}::jsonb`); params.push(JSON.stringify(aliases)) }

      params.push(id)
      const { rowCount } = await pool.query(
        `UPDATE servers SET ${updates.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`,
        params,
      )
      if (rowCount === 0) { res.status(404).json({ error: 'Server not found' }); return }
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  router.delete('/servers/:id', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { rowCount } = await pool.query(
        `UPDATE servers SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
        [req.params['id']],
      )
      if (rowCount === 0) { res.status(404).json({ error: 'Server not found' }); return }
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  // ── Server tags ────────────────────────────────────────────────────────────

  router.post('/servers/:id/tags', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { id } = req.params
      const { tagId } = req.body as { tagId?: unknown }
      if (typeof tagId !== 'string' || !tagId) {
        res.status(400).json({ error: 'tagId is required' })
        return
      }
      await pool.query(
        `INSERT INTO server_tags (server_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, tagId],
      )
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  router.delete('/servers/:id/tags/:tagId', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      await pool.query(
        `DELETE FROM server_tags WHERE server_id = $1 AND tag_id = $2`,
        [req.params['id'], req.params['tagId']],
      )
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  return router
}
