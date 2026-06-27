import { Router } from 'express'
import type { Pool } from 'pg'
import { requireApiKey } from '../middleware/apiKey.ts'

// Read-only API endpoints protected by X-API-Key (not session cookies)
// §4.8: never returns secret values or crypto fields
export function v1Router(pool: Pool): Router {
  const router = Router()

  // ── GET /api/v1/servers ──────────────────────────────────────────────────────
  // Scoped read endpoint — requires API key with scope: servers.read
  // Returns server metadata only — NO secret values, NO crypto fields
  router.get(
    '/v1/servers',
    requireApiKey('servers.read')(pool),
    async (req, res, next) => {
      try {
        const { tag } = req.query as { tag?: string }

        const conditions: string[] = ['s.deleted_at IS NULL']
        const params: unknown[] = []
        let idx = 1

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
          id: string
          hostname: string
          environment: string
          os: string | null
          location: string | null
          status: string
          created_at: string
          updated_at: string
          tags: Array<{ id: string; name: string; color: string }>
        }>(
          `SELECT s.id, s.hostname, s.environment, s.os, s.location, s.status,
                  s.created_at, s.updated_at,
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

        // §4.8: explicitly map only safe fields — never include ciphertext/iv/auth_tag/wrapped_dek/key_hash
        res.json({
          servers: rows.map((r) => ({
            id: r.id,
            hostname: r.hostname,
            environment: r.environment,
            os: r.os,
            location: r.location,
            status: r.status,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            tags: r.tags,
          })),
        })
      } catch (err) {
        next(err)
      }
    },
  )

  return router
}
