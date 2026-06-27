import { Router } from 'express'
import type { Pool } from 'pg'
import { requireAuth, requirePermission } from '../middleware/rbac.ts'

interface TopologyNode {
  id: string
  type: 'server' | 'app_instance'
  data: Record<string, unknown>
}

interface TopologyEdge {
  id: string
  source: string
  target: string
  data: Record<string, unknown>
}

interface TopologyResult {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}

export function topologyRouter(pool: Pool): Router {
  const router = Router()

  // ── Fleet-wide topology ────────────────────────────────────────────────────

  router.get('/topology', requireAuth, requirePermission('infra.read'), async (_req, res, next) => {
    try {
      const result = await buildFleetTopology(pool)
      res.json(result)
    } catch (err) { next(err) }
  })

  // ── Per-server topology ────────────────────────────────────────────────────

  router.get('/servers/:id/topology', requireAuth, requirePermission('infra.read'), async (req, res, next) => {
    try {
      const { id } = req.params

      // Check server exists
      const serverCheck = await pool.query<{ id: string }>(
        `SELECT id FROM servers WHERE id = $1`,
        [id],
      )
      if (serverCheck.rowCount === 0) {
        res.status(404).json({ error: 'Server not found' })
        return
      }

      const result = await buildServerTopology(pool, id)
      res.json(result)
    } catch (err) { next(err) }
  })

  return router
}

// ── Build fleet-wide topology ─────────────────────────────────────────────────

async function buildFleetTopology(pool: Pool): Promise<TopologyResult> {
  // Fetch all servers
  const serversResult = await pool.query<{
    id: string
    hostname: string
    environment: string
    status: string
  }>(`SELECT id, hostname, environment, status FROM servers ORDER BY hostname`)

  // Fetch all app instances with app names
  const instancesResult = await pool.query<{
    id: string
    server_id: string
    app_name: string
    server_hostname: string
  }>(
    `SELECT ai.id, ai.server_id, a.name AS app_name, s.hostname AS server_hostname
     FROM app_instances ai
     JOIN apps a ON a.id = ai.app_id
     JOIN servers s ON s.id = ai.server_id
     ORDER BY s.hostname, a.name`,
  )

  // Fetch all connections
  const connectionsResult = await pool.query<{
    id: string
    from_app_instance_id: string
    to_app_instance_id: string
    label: string | null
    protocol: string | null
  }>(
    `SELECT id, from_app_instance_id, to_app_instance_id, label, protocol
     FROM connections
     ORDER BY created_at`,
  )

  // Fetch ports for all servers
  const serverIds = serversResult.rows.map((s) => s.id)
  const portsByServer = await fetchPortsByServer(pool, serverIds)

  return buildTopologyResponse(
    serversResult.rows,
    instancesResult.rows,
    connectionsResult.rows,
    portsByServer,
  )
}

// ── Build per-server topology (one hop out) ───────────────────────────────────

async function buildServerTopology(pool: Pool, serverId: string): Promise<TopologyResult> {
  // Fetch the target server
  const serversResult = await pool.query<{
    id: string
    hostname: string
    environment: string
    status: string
  }>(
    `SELECT id, hostname, environment, status FROM servers WHERE id = $1`,
    [serverId],
  )

  // Fetch all instances on this server
  const instancesOnServer = await pool.query<{ id: string }>(
    `SELECT id FROM app_instances WHERE server_id = $1`,
    [serverId],
  )
  const instanceIds = instancesOnServer.rows.map((r) => r.id)

  if (instanceIds.length === 0) {
    const portsByServer = await fetchPortsByServer(pool, serversResult.rows.map((s) => s.id))
    return buildTopologyResponse(serversResult.rows, [], [], portsByServer)
  }

  // Find connections where any instance on this server is involved (one hop out)
  const connectionsResult = await pool.query<{
    id: string
    from_app_instance_id: string
    to_app_instance_id: string
    label: string | null
    protocol: string | null
  }>(
    `SELECT id, from_app_instance_id, to_app_instance_id, label, protocol
     FROM connections
     WHERE from_app_instance_id = ANY($1::uuid[])
        OR to_app_instance_id = ANY($1::uuid[])
     ORDER BY created_at`,
    [instanceIds],
  )

  // Collect all instance IDs involved (local + connected)
  const allInstanceIds = new Set<string>(instanceIds)
  for (const conn of connectionsResult.rows) {
    allInstanceIds.add(conn.from_app_instance_id)
    allInstanceIds.add(conn.to_app_instance_id)
  }

  // Fetch all relevant instances
  const allInstanceIdsArr = Array.from(allInstanceIds)
  const instancesResult = await pool.query<{
    id: string
    server_id: string
    app_name: string
    server_hostname: string
  }>(
    `SELECT ai.id, ai.server_id, a.name AS app_name, s.hostname AS server_hostname
     FROM app_instances ai
     JOIN apps a ON a.id = ai.app_id
     JOIN servers s ON s.id = ai.server_id
     WHERE ai.id = ANY($1::uuid[])
     ORDER BY s.hostname, a.name`,
    [allInstanceIdsArr],
  )

  // Collect all server IDs involved (local + connected servers)
  const allServerIds = new Set<string>([serverId])
  for (const inst of instancesResult.rows) {
    allServerIds.add(inst.server_id)
  }

  // Fetch all relevant servers
  const allServerIdsArr = Array.from(allServerIds)
  const allServersResult = await pool.query<{
    id: string
    hostname: string
    environment: string
    status: string
  }>(
    `SELECT id, hostname, environment, status
     FROM servers
     WHERE id = ANY($1::uuid[])
     ORDER BY hostname`,
    [allServerIdsArr],
  )

  const portsByServer = await fetchPortsByServer(pool, Array.from(allServerIds))

  return buildTopologyResponse(
    allServersResult.rows,
    instancesResult.rows,
    connectionsResult.rows,
    portsByServer,
  )
}

// ── Fetch ports grouped by server ────────────────────────────────────────────

async function fetchPortsByServer(
  pool: Pool,
  serverIds: string[],
): Promise<Map<string, Array<{ number: number; protocol: string; appLabel: string | null; exposure: string }>>> {
  const map = new Map<string, Array<{ number: number; protocol: string; appLabel: string | null; exposure: string }>>()
  if (serverIds.length === 0) return map

  const { rows } = await pool.query<{
    server_id: string
    number: number
    protocol: string
    app_label: string | null
    exposure: string
  }>(
    `SELECT server_id, number, protocol, app_label, exposure
     FROM ports
     WHERE server_id = ANY($1::uuid[]) AND status != 'closed'
     ORDER BY server_id, number`,
    [serverIds],
  )

  for (const row of rows) {
    if (!map.has(row.server_id)) map.set(row.server_id, [])
    map.get(row.server_id)!.push({
      number: row.number,
      protocol: row.protocol,
      appLabel: row.app_label,
      exposure: row.exposure,
    })
  }
  return map
}

// ── Map DB rows to topology response ─────────────────────────────────────────

function buildTopologyResponse(
  servers: Array<{ id: string; hostname: string; environment: string; status: string }>,
  instances: Array<{ id: string; server_id: string; app_name: string; server_hostname: string }>,
  connections: Array<{
    id: string
    from_app_instance_id: string
    to_app_instance_id: string
    label: string | null
    protocol: string | null
  }>,
  portsByServer: Map<string, Array<{ number: number; protocol: string; appLabel: string | null; exposure: string }>>,
): TopologyResult {
  const nodes: TopologyNode[] = [
    ...servers.map((s) => ({
      id: `server-${s.id}`,
      type: 'server' as const,
      data: {
        label: s.hostname,
        environment: s.environment,
        status: s.status,
        serverId: s.id,
        ports: portsByServer.get(s.id) ?? [],
      },
    })),
    ...instances.map((i) => ({
      id: `instance-${i.id}`,
      type: 'app_instance' as const,
      data: {
        label: i.app_name,
        serverId: i.server_id,
        serverHostname: i.server_hostname,
        instanceId: i.id,
      },
    })),
  ]

  const edges: TopologyEdge[] = connections.map((c) => ({
    id: `conn-${c.id}`,
    source: `instance-${c.from_app_instance_id}`,
    target: `instance-${c.to_app_instance_id}`,
    data: {
      label: c.label,
      protocol: c.protocol,
    },
  }))

  return { nodes, edges }
}
