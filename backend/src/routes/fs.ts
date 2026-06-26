import { Router } from 'express'
import type { Pool } from 'pg'
import { requireAuth, requirePermission } from '../middleware/rbac.ts'
import {
  generateBashScript,
  generatePs1Script,
  validateFsTreeSchema,
} from '../util/fsScript.ts'
import type { FsTreeDoc } from '../util/fsScript.ts'

const JSON_SIZE_LIMIT_BYTES = 2 * 1024 * 1024 // 2 MB
const NODE_COUNT_LIMIT = 50_000
const MAX_DEPTH_LIMIT = 20

export function fsRouter(pool: Pool): Router {
  const router = Router()

  // ── C3.2: Generate bash/ps1 scripts ─────────────────────────────────────────

  router.post(
    '/servers/:id/fs/generate-script',
    requireAuth,
    requirePermission('infra.read'),
    async (req, res, next) => {
      try {
        const { id } = req.params as { id: string }
        const { root, maxDepth } = req.body as Record<string, unknown>

        // Validate inputs
        if (typeof root !== 'string' || !root.trim()) {
          res.status(400).json({ error: 'root must be a non-empty string' })
          return
        }
        const depth = typeof maxDepth === 'number' ? maxDepth : Number(maxDepth)
        if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH_LIMIT) {
          res.status(400).json({ error: `maxDepth must be an integer between 1 and ${MAX_DEPTH_LIMIT}` })
          return
        }

        // Verify server exists
        const { rows } = await pool.query<{ hostname: string }>(
          `SELECT hostname FROM servers WHERE id = $1 AND deleted_at IS NULL`,
          [id],
        )
        if (rows.length === 0) {
          res.status(404).json({ error: 'Server not found' })
          return
        }

        const host = rows[0]!.hostname
        const bash = generateBashScript(root.trim(), depth, host)
        const ps1 = generatePs1Script(root.trim(), depth, host)

        res.json({ bash, ps1 })
      } catch (err) { next(err) }
    },
  )

  // ── C3.3: Import a pasted fstree JSON ────────────────────────────────────────

  router.post(
    '/servers/:id/fs/import',
    requireAuth,
    requirePermission('servers.write'),
    async (req, res, next) => {
      try {
        const { id } = req.params as { id: string }
        const { json: jsonStr } = req.body as Record<string, unknown>

        if (typeof jsonStr !== 'string') {
          res.status(422).json({ error: 'json field must be a string' })
          return
        }

        // Size limit check (bytes)
        if (Buffer.byteLength(jsonStr, 'utf8') > JSON_SIZE_LIMIT_BYTES) {
          res.status(422).json({ error: 'JSON payload too large (max 2 MB)' })
          return
        }

        // Parse JSON
        let parsed: unknown
        try {
          parsed = JSON.parse(jsonStr)
        } catch {
          res.status(422).json({ error: 'Invalid JSON' })
          return
        }

        // Node count limit (pre-schema-validation, fast check)
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          Array.isArray((parsed as Record<string, unknown>)['nodes']) &&
          ((parsed as Record<string, unknown>)['nodes'] as unknown[]).length > NODE_COUNT_LIMIT
        ) {
          res.status(422).json({ error: 'too large: nodes exceeds 50000 limit' })
          return
        }

        // Schema validation
        const validation = validateFsTreeSchema(parsed)
        if (!validation.valid) {
          res.status(422).json({ error: validation.error ?? 'Invalid fstree document' })
          return
        }

        const doc = parsed as FsTreeDoc

        // max_depth cap (redundant with schema but belt-and-suspenders)
        if (doc.max_depth > MAX_DEPTH_LIMIT) {
          res.status(422).json({ error: 'max_depth exceeds limit' })
          return
        }

        // Verify server exists
        const srvCheck = await pool.query(
          `SELECT id FROM servers WHERE id = $1 AND deleted_at IS NULL`,
          [id],
        )
        if (srvCheck.rows.length === 0) {
          res.status(404).json({ error: 'Server not found' })
          return
        }

        const userId = req.session.userId as string | undefined

        // Insert snapshot
        const snapRes = await pool.query<{ id: string; created_at: string }>(
          `INSERT INTO fs_snapshots (server_id, root_path, max_depth, host, generated_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, created_at`,
          [id, doc.root, doc.max_depth, doc.host, doc.generated_at, userId ?? null],
        )
        const snap = snapRes.rows[0]!

        // Batch insert nodes in chunks to stay under PostgreSQL's 65535 param limit
        // 5 params per row → max 13107 rows per batch (65535 / 5 = 13107)
        const CHUNK_SIZE = 1000 // well below limit; safe and efficient
        for (let start = 0; start < doc.nodes.length; start += CHUNK_SIZE) {
          const chunk = doc.nodes.slice(start, start + CHUNK_SIZE)
          const valuePlaceholders: string[] = []
          const params: unknown[] = []
          let idx = 1
          for (const node of chunk) {
            valuePlaceholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`)
            params.push(snap.id, node.path, node.type, node.size ?? null, node.mtime)
          }
          await pool.query(
            `INSERT INTO fs_nodes (snapshot_id, path, type, size, mtime)
             VALUES ${valuePlaceholders.join(', ')}`,
            params,
          )
        }

        res.status(201).json({
          snapshot: {
            id: snap.id,
            serverId: id,
            rootPath: doc.root,
            maxDepth: doc.max_depth,
            host: doc.host,
            generatedAt: doc.generated_at,
            createdAt: snap.created_at,
            nodeCount: doc.nodes.length,
          },
        })
      } catch (err) { next(err) }
    },
  )

  // ── C3.3: List snapshots ──────────────────────────────────────────────────────

  router.get(
    '/servers/:id/fs/snapshots',
    requireAuth,
    requirePermission('infra.read'),
    async (req, res, next) => {
      try {
        const { id } = req.params as { id: string }

        const { rows } = await pool.query<{
          id: string
          server_id: string
          root_path: string
          max_depth: number
          host: string
          generated_at: string
          created_at: string
          node_count: string
        }>(
          `SELECT s.id, s.server_id, s.root_path, s.max_depth, s.host,
                  s.generated_at, s.created_at,
                  COUNT(n.id)::text AS node_count
           FROM fs_snapshots s
           LEFT JOIN fs_nodes n ON n.snapshot_id = s.id
           WHERE s.server_id = $1
           GROUP BY s.id
           ORDER BY s.created_at DESC`,
          [id],
        )

        res.json({
          snapshots: rows.map((r) => ({
            id: r.id,
            serverId: r.server_id,
            rootPath: r.root_path,
            maxDepth: r.max_depth,
            host: r.host,
            generatedAt: r.generated_at,
            createdAt: r.created_at,
            nodeCount: Number(r.node_count),
          })),
        })
      } catch (err) { next(err) }
    },
  )

  // ── C3.3: Snapshot detail ─────────────────────────────────────────────────────

  router.get(
    '/servers/:id/fs/snapshots/:snapshotId',
    requireAuth,
    requirePermission('infra.read'),
    async (req, res, next) => {
      try {
        const { id, snapshotId } = req.params as { id: string; snapshotId: string }

        const snapRes = await pool.query<{
          id: string
          server_id: string
          root_path: string
          max_depth: number
          host: string
          generated_at: string
          created_at: string
        }>(
          `SELECT id, server_id, root_path, max_depth, host, generated_at, created_at
           FROM fs_snapshots
           WHERE id = $1 AND server_id = $2`,
          [snapshotId, id],
        )

        if (snapRes.rows.length === 0) {
          res.status(404).json({ error: 'Snapshot not found' })
          return
        }

        const snap = snapRes.rows[0]!

        const nodesRes = await pool.query<{
          id: string
          path: string
          type: string
          size: string | null
          mtime: string | null
          linked_type: string | null
          linked_id: string | null
        }>(
          `SELECT id, path, type, size, mtime, linked_type, linked_id
           FROM fs_nodes
           WHERE snapshot_id = $1
           ORDER BY path`,
          [snapshotId],
        )

        res.json({
          snapshot: {
            id: snap.id,
            serverId: snap.server_id,
            rootPath: snap.root_path,
            maxDepth: snap.max_depth,
            host: snap.host,
            generatedAt: snap.generated_at,
            createdAt: snap.created_at,
          },
          nodes: nodesRes.rows.map((n) => ({
            id: n.id,
            path: n.path,
            type: n.type,
            size: n.size !== null ? Number(n.size) : null,
            mtime: n.mtime,
            linkedType: n.linked_type,
            linkedId: n.linked_id,
          })),
        })
      } catch (err) { next(err) }
    },
  )

  return router
}
