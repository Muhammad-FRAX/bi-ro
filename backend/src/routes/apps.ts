import { Router } from 'express'
import type { Pool } from 'pg'
import { requireAuth, requirePermission } from '../middleware/rbac.ts'

const VALID_EXPOSURES = ['internal', 'external', 'localhost'] as const
const VALID_PORT_STATUSES = ['active', 'inactive', 'unknown'] as const
const VALID_PROTOCOLS = ['tcp', 'udp'] as const

function isValidExposure(v: unknown): v is typeof VALID_EXPOSURES[number] {
  return typeof v === 'string' && (VALID_EXPOSURES as readonly string[]).includes(v)
}
function isValidPortStatus(v: unknown): v is typeof VALID_PORT_STATUSES[number] {
  return typeof v === 'string' && (VALID_PORT_STATUSES as readonly string[]).includes(v)
}
function isValidProtocol(v: unknown): v is typeof VALID_PROTOCOLS[number] {
  return typeof v === 'string' && (VALID_PROTOCOLS as readonly string[]).includes(v)
}

export function appsRouter(pool: Pool): Router {
  const router = Router()

  // ── Apps catalog ──────────────────────────────────────────────────────────

  router.get('/apps', requireAuth, async (req, res, next) => {
    try {
      const userId = req.session.userId!
      const perms: string[] = req.session.permissions ?? []
      const isAdmin = perms.includes('users.manage')
      const hasInfraRead = perms.includes('infra.read')

      const { rows } = await pool.query<{
        id: string; name: string; category: string | null; vendor: string | null
        version: string | null; eol_date: string | null; logo_url: string | null
        docs_url: string | null; notes: string | null; created_at: string; updated_at: string
        vault_id: string | null; vault_name: string | null
      }>(
        `SELECT a.id, a.name, a.category, a.vendor, a.version, a.eol_date, a.logo_url,
                a.docs_url, a.notes, a.created_at, a.updated_at, a.vault_id, v.name AS vault_name
         FROM apps a
         LEFT JOIN vaults v ON v.id = a.vault_id
         WHERE a.deleted_at IS NULL
           AND (
             $1                                           -- admin sees all
             OR (a.vault_id IS NULL AND $2)               -- catalog apps: need infra.read
             OR (a.vault_id IS NOT NULL AND EXISTS (      -- vault apps: need membership
               SELECT 1 FROM vault_members vm
               WHERE vm.vault_id = a.vault_id AND vm.user_id = $3
             ))
           )
         ORDER BY a.vault_id NULLS FIRST, a.name`,
        [isAdmin, hasInfraRead, userId],
      )
      res.json({
        apps: rows.map((r) => ({
          id: r.id, name: r.name, category: r.category, vendor: r.vendor,
          version: r.version, eolDate: r.eol_date, logoUrl: r.logo_url,
          docsUrl: r.docs_url, notes: r.notes,
          createdAt: r.created_at, updatedAt: r.updated_at,
          vaultId: r.vault_id, vaultName: r.vault_name,
        })),
      })
    } catch (err) { next(err) }
  })

  router.post('/apps', requireAuth, async (req, res, next) => {
    try {
      const { name, category, vendor, version, eol_date, logo_url, docs_url, notes, vaultId } =
        req.body as Record<string, unknown>

      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'name is required' }); return
      }

      const perms: string[] = req.session.permissions ?? []
      const isAdmin = perms.includes('users.manage')
      const hasServersWrite = perms.includes('servers.write')

      // Vault app: creator must be a vault manager for that vault
      if (typeof vaultId === 'string' && vaultId) {
        const { rows: memberRows } = await pool.query(
          `SELECT access FROM vault_members WHERE vault_id = $1 AND user_id = $2`,
          [vaultId, req.session.userId],
        )
        const isVaultManager = isAdmin || memberRows[0]?.access === 'manage'
        if (!isVaultManager) { res.status(403).json({ error: 'Must be a vault manager to create vault apps' }); return }
      } else if (!hasServersWrite && !isAdmin) {
        res.status(403).json({ error: 'Insufficient permissions' }); return
      }

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO apps (name, category, vendor, version, eol_date, logo_url, docs_url, notes, vault_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          name.trim(),
          typeof category === 'string' ? category.trim() || null : null,
          typeof vendor === 'string' ? vendor.trim() || null : null,
          typeof version === 'string' ? version.trim() || null : null,
          typeof eol_date === 'string' ? eol_date || null : null,
          typeof logo_url === 'string' ? logo_url.trim() || null : null,
          typeof docs_url === 'string' ? docs_url.trim() || null : null,
          typeof notes === 'string' ? notes.trim() || null : null,
          typeof vaultId === 'string' ? vaultId || null : null,
        ],
      ).catch((err: { code?: string }) => {
        if (err.code === '23505') throw Object.assign(new Error('DUPLICATE'), { isDuplicate: true })
        throw err
      })

      res.status(201).json({ app: { id: rows[0]!.id, name: name.trim() } })
    } catch (err: unknown) {
      if (err instanceof Error && (err as Error & { isDuplicate?: boolean }).isDuplicate) {
        res.status(409).json({ error: 'An app with that name already exists' }); return
      }
      next(err)
    }
  })

  router.get('/apps/:id', requireAuth, requirePermission('infra.read'), async (req, res, next) => {
    try {
      const { rows } = await pool.query<{
        id: string; name: string; category: string | null; vendor: string | null
        version: string | null; eol_date: string | null; logo_url: string | null
        docs_url: string | null; notes: string | null; created_at: string; updated_at: string
      }>(
        `SELECT id, name, category, vendor, version, eol_date, logo_url, docs_url, notes,
                created_at, updated_at
         FROM apps WHERE id = $1 AND deleted_at IS NULL`,
        [req.params['id']],
      )
      if (!rows[0]) { res.status(404).json({ error: 'App not found' }); return }
      const r = rows[0]
      res.json({
        app: {
          id: r.id, name: r.name, category: r.category, vendor: r.vendor,
          version: r.version, eolDate: r.eol_date, logoUrl: r.logo_url,
          docsUrl: r.docs_url, notes: r.notes,
          createdAt: r.created_at, updatedAt: r.updated_at,
        },
      })
    } catch (err) { next(err) }
  })

  router.patch('/apps/:id', requireAuth, async (req, res, next) => {
    try {
      const userId = req.session.userId!
      const perms: string[] = req.session.permissions ?? []
      const isAdmin = perms.includes('users.manage')
      const hasServersWrite = perms.includes('servers.write')

      // Fetch current app to check its existing vault ownership
      const { rows: appRows } = await pool.query<{ vault_id: string | null }>(
        `SELECT vault_id FROM apps WHERE id = $1 AND deleted_at IS NULL`,
        [req.params['id']],
      )
      if (!appRows[0]) { res.status(404).json({ error: 'App not found' }); return }
      const currentVaultId = appRows[0].vault_id

      // Check the caller has permission to edit THIS app in its current home
      if (!isAdmin) {
        if (currentVaultId) {
          // Vault app: must be a vault manager
          const { rows: m } = await pool.query(
            `SELECT 1 FROM vault_members WHERE vault_id = $1 AND user_id = $2 AND access = 'manage'`,
            [currentVaultId, userId],
          )
          if (!m.length) { res.status(403).json({ error: 'Must be a vault manager to edit this app' }); return }
        } else {
          // Catalog app: must have servers.write
          if (!hasServersWrite) { res.status(403).json({ error: 'Insufficient permissions' }); return }
        }
      }

      const { name, category, vendor, version, eol_date, logo_url, docs_url, notes, vaultId } =
        req.body as Record<string, unknown>

      // When moving an app to a new vault, check target vault too
      if (vaultId !== undefined && !isAdmin) {
        const targetVaultId = typeof vaultId === 'string' ? vaultId || null : null
        if (targetVaultId) {
          const { rows: tm } = await pool.query(
            `SELECT 1 FROM vault_members WHERE vault_id = $1 AND user_id = $2 AND access = 'manage'`,
            [targetVaultId, userId],
          )
          if (!tm.length) { res.status(403).json({ error: 'Must be a manager of the target vault to assign apps to it' }); return }
        } else if (!hasServersWrite) {
          // Moving to catalog (null vault) requires servers.write
          res.status(403).json({ error: 'servers.write required to move an app to the catalog' }); return
        }
      }

      const updates: string[] = ['updated_at = NOW()']
      const params: unknown[] = []
      let idx = 1

      if (typeof name === 'string' && name.trim()) { updates.push(`name = $${idx++}`); params.push(name.trim()) }
      if (category !== undefined) { updates.push(`category = $${idx++}`); params.push(typeof category === 'string' ? category.trim() || null : null) }
      if (vendor !== undefined) { updates.push(`vendor = $${idx++}`); params.push(typeof vendor === 'string' ? vendor.trim() || null : null) }
      if (version !== undefined) { updates.push(`version = $${idx++}`); params.push(typeof version === 'string' ? version.trim() || null : null) }
      if (eol_date !== undefined) { updates.push(`eol_date = $${idx++}`); params.push(typeof eol_date === 'string' ? eol_date || null : null) }
      if (logo_url !== undefined) { updates.push(`logo_url = $${idx++}`); params.push(typeof logo_url === 'string' ? logo_url.trim() || null : null) }
      if (docs_url !== undefined) { updates.push(`docs_url = $${idx++}`); params.push(typeof docs_url === 'string' ? docs_url.trim() || null : null) }
      if (notes !== undefined) { updates.push(`notes = $${idx++}`); params.push(typeof notes === 'string' ? notes.trim() || null : null) }
      if (vaultId !== undefined) { updates.push(`vault_id = $${idx++}::uuid`); params.push(typeof vaultId === 'string' ? vaultId || null : null) }

      params.push(req.params['id'])
      const { rowCount } = await pool.query(
        `UPDATE apps SET ${updates.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`,
        params,
      )
      if (rowCount === 0) { res.status(404).json({ error: 'App not found' }); return }
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  router.get('/apps/:id/instances', requireAuth, requirePermission('infra.read'), async (req, res, next) => {
    try {
      const { rows } = await pool.query<{
        id: string; server_id: string; hostname: string; environment: string
        version: string | null; notes: string | null; created_at: string
      }>(
        `SELECT ai.id, ai.server_id, s.hostname, s.environment, ai.version, ai.notes, ai.created_at
         FROM app_instances ai
         JOIN servers s ON s.id = ai.server_id
         WHERE ai.app_id = $1 AND ai.deleted_at IS NULL AND s.deleted_at IS NULL
         ORDER BY s.hostname`,
        [req.params['id']],
      )
      res.json({
        instances: rows.map((r) => ({
          id: r.id,
          serverId: r.server_id,
          hostname: r.hostname,
          environment: r.environment,
          version: r.version,
          notes: r.notes,
          createdAt: r.created_at,
        })),
      })
    } catch (err) { next(err) }
  })

  router.get('/apps/:id/secrets', requireAuth, requirePermission('secrets.view'), async (req, res, next) => {
    try {
      const userId = req.session.userId!
      const { rows } = await pool.query<{
        id: string; title: string; type: string; username: string | null
        host_url: string | null; days_remaining: number | null; last_changed_at: string | null
        vault_id: string; vault_name: string
      }>(
        `SELECT s.id, s.title, s.type, s.username, s.host_url,
                s.days_remaining, s.last_changed_at, s.vault_id, v.name AS vault_name
         FROM secrets s
         JOIN vaults v ON v.id = s.vault_id
         JOIN vault_members vm ON vm.vault_id = s.vault_id AND vm.user_id = $2
         WHERE s.app_id = $1 AND s.deleted_at IS NULL
         ORDER BY s.title`,
        [req.params['id'], userId],
      )
      res.json({
        secrets: rows.map((r) => ({
          id: r.id, title: r.title, type: r.type, username: r.username,
          hostUrl: r.host_url, daysRemaining: r.days_remaining,
          lastChangedAt: r.last_changed_at, vaultId: r.vault_id, vaultName: r.vault_name,
        })),
      })
    } catch (err) { next(err) }
  })

  router.delete('/apps/:id', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { rowCount } = await pool.query(
        `UPDATE apps SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
        [req.params['id']],
      )
      if (rowCount === 0) { res.status(404).json({ error: 'App not found' }); return }
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  // ── App instances ──────────────────────────────────────────────────────────

  router.post('/app-instances', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { serverId, appId, version, notes } = req.body as Record<string, unknown>
      if (typeof serverId !== 'string' || !serverId) {
        res.status(400).json({ error: 'serverId is required' }); return
      }
      if (typeof appId !== 'string' || !appId) {
        res.status(400).json({ error: 'appId is required' }); return
      }

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO app_instances (server_id, app_id, version, notes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (server_id, app_id) DO UPDATE SET
           version = EXCLUDED.version, notes = EXCLUDED.notes
         RETURNING id`,
        [
          serverId, appId,
          typeof version === 'string' ? version.trim() || null : null,
          typeof notes === 'string' ? notes.trim() || null : null,
        ],
      )
      res.status(201).json({
        instance: { id: rows[0]!.id, serverId, appId },
      })
    } catch (err) { next(err) }
  })

  router.get('/servers/:id/app-instances', requireAuth, requirePermission('infra.read'), async (req, res, next) => {
    try {
      const { rows } = await pool.query<{
        id: string; server_id: string; app_id: string
        version: string | null; notes: string | null; created_at: string
        app_name: string; app_category: string | null; app_logo_url: string | null
      }>(
        `SELECT ai.id, ai.server_id, ai.app_id, ai.version, ai.notes, ai.created_at,
                a.name AS app_name, a.category AS app_category, a.logo_url AS app_logo_url
         FROM app_instances ai
         JOIN apps a ON a.id = ai.app_id
         WHERE ai.server_id = $1
         ORDER BY a.name`,
        [req.params['id']],
      )
      res.json({
        instances: rows.map((r) => ({
          id: r.id, serverId: r.server_id, appId: r.app_id,
          version: r.version, notes: r.notes, createdAt: r.created_at,
          app: { name: r.app_name, category: r.app_category, logoUrl: r.app_logo_url },
        })),
      })
    } catch (err) { next(err) }
  })

  router.delete('/app-instances/:id', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { rowCount } = await pool.query(
        `DELETE FROM app_instances WHERE id = $1`,
        [req.params['id']],
      )
      if (rowCount === 0) { res.status(404).json({ error: 'App instance not found' }); return }
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  // ── Ports ──────────────────────────────────────────────────────────────────

  router.get('/servers/:id/ports', requireAuth, requirePermission('infra.read'), async (req, res, next) => {
    try {
      const { rows } = await pool.query<{
        id: string; server_id: string; app_instance_id: string | null
        number: number; protocol: string; app_label: string | null
        exposure: string; status: string; description: string | null
        app_name: string | null
      }>(
        `SELECT p.id, p.server_id, p.app_instance_id, p.number, p.protocol,
                p.app_label, p.exposure, p.status, p.description,
                a.name AS app_name
         FROM ports p
         LEFT JOIN app_instances ai ON ai.id = p.app_instance_id
         LEFT JOIN apps a ON a.id = ai.app_id
         WHERE p.server_id = $1
         ORDER BY p.number`,
        [req.params['id']],
      )
      res.json({
        ports: rows.map((r) => ({
          id: r.id, serverId: r.server_id, appInstanceId: r.app_instance_id,
          number: r.number, protocol: r.protocol, appLabel: r.app_label,
          exposure: r.exposure, status: r.status, description: r.description,
          appName: r.app_name,
        })),
      })
    } catch (err) { next(err) }
  })

  router.post('/servers/:id/ports', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { id: serverId } = req.params
      const { number, protocol, appLabel, appInstanceId, exposure, status, description } =
        req.body as Record<string, unknown>

      const portNum = typeof number === 'number' ? number : parseInt(String(number), 10)
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        res.status(400).json({ error: 'number must be an integer between 1 and 65535' }); return
      }

      const proto = protocol ?? 'tcp'
      if (!isValidProtocol(proto)) {
        res.status(400).json({ error: 'protocol must be tcp or udp' }); return
      }

      const exp = exposure ?? 'internal'
      if (!isValidExposure(exp)) {
        res.status(400).json({ error: `exposure must be one of: ${VALID_EXPOSURES.join(', ')}` }); return
      }

      const stat = status ?? 'active'
      if (!isValidPortStatus(stat)) {
        res.status(400).json({ error: `status must be one of: ${VALID_PORT_STATUSES.join(', ')}` }); return
      }

      const { rows } = await pool.query<{ id: string; number: number }>(
        `INSERT INTO ports (server_id, number, protocol, app_label, app_instance_id, exposure, status, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, number`,
        [
          serverId, portNum, proto,
          typeof appLabel === 'string' ? appLabel.trim() || null : null,
          typeof appInstanceId === 'string' ? appInstanceId : null,
          exp, stat,
          typeof description === 'string' ? description.trim() || null : null,
        ],
      ).catch((err: { code?: string }) => {
        if (err.code === '23505') throw Object.assign(new Error('DUPLICATE'), { isDuplicate: true })
        throw err
      })

      res.status(201).json({ port: { id: rows[0]!.id, number: rows[0]!.number } })
    } catch (err: unknown) {
      if (err instanceof Error && (err as Error & { isDuplicate?: boolean }).isDuplicate) {
        res.status(409).json({ error: 'Port already exists on this server with that protocol' })
        return
      }
      next(err)
    }
  })

  router.patch('/ports/:id', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { appLabel, appInstanceId, exposure, status, description } = req.body as Record<string, unknown>
      if (exposure !== undefined && !isValidExposure(exposure)) {
        res.status(400).json({ error: `exposure must be one of: ${VALID_EXPOSURES.join(', ')}` }); return
      }
      if (status !== undefined && !isValidPortStatus(status)) {
        res.status(400).json({ error: `status must be one of: ${VALID_PORT_STATUSES.join(', ')}` }); return
      }

      const updates: string[] = []
      const params: unknown[] = []
      let idx = 1

      if (appLabel !== undefined) { updates.push(`app_label = $${idx++}`); params.push(typeof appLabel === 'string' ? appLabel.trim() || null : null) }
      if (appInstanceId !== undefined) { updates.push(`app_instance_id = $${idx++}`); params.push(typeof appInstanceId === 'string' ? appInstanceId : null) }
      if (exposure !== undefined) { updates.push(`exposure = $${idx++}`); params.push(exposure) }
      if (status !== undefined) { updates.push(`status = $${idx++}`); params.push(status) }
      if (description !== undefined) { updates.push(`description = $${idx++}`); params.push(typeof description === 'string' ? description.trim() || null : null) }

      if (updates.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return }

      params.push(req.params['id'])
      const { rowCount } = await pool.query(
        `UPDATE ports SET ${updates.join(', ')} WHERE id = $${idx}`,
        params,
      )
      if (rowCount === 0) { res.status(404).json({ error: 'Port not found' }); return }
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  router.delete('/ports/:id', requireAuth, requirePermission('servers.write'), async (req, res, next) => {
    try {
      const { rowCount } = await pool.query(`DELETE FROM ports WHERE id = $1`, [req.params['id']])
      if (rowCount === 0) { res.status(404).json({ error: 'Port not found' }); return }
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  return router
}
