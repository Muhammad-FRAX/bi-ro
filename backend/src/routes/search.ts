import { Router } from 'express'
import type { Pool } from 'pg'
import { requireAuth, requirePermission } from '../middleware/rbac.ts'

interface SearchResult {
  type: string
  id: string
  title: string
  subtitle: string
  url: string
}

export function searchRouter(pool: Pool): Router {
  const router = Router()

  // GET /api/search?q=text
  // requireAuth + requirePermission('infra.read')
  // Searches across servers, apps, documents, secrets metadata (title/username only — NEVER ciphertext/value)
  // Returns { results: SearchResult[] } limited to 20 total
  router.get(
    '/search',
    requireAuth,
    requirePermission('infra.read'),
    async (req, res, next) => {
      try {
        const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : ''
        if (!q) {
          res.json({ results: [] })
          return
        }

        const pattern = `%${q}%`
        const results: SearchResult[] = []

        // Search servers (hostname, notes, location)
        const { rows: servers } = await pool.query<{
          id: string
          hostname: string
          notes: string | null
          location: string | null
        }>(
          `SELECT id, hostname, notes, location
           FROM servers
           WHERE deleted_at IS NULL
             AND (hostname ILIKE $1 OR notes ILIKE $1 OR location ILIKE $1)
           LIMIT 5`,
          [pattern],
        )
        for (const s of servers) {
          results.push({
            type: 'server',
            id: s.id,
            title: s.hostname,
            subtitle: s.location ?? s.notes ?? 'Server',
            url: `/servers/${s.id}`,
          })
        }

        // Search apps (name, vendor, category)
        const { rows: apps } = await pool.query<{
          id: string
          name: string
          vendor: string | null
          category: string | null
        }>(
          `SELECT id, name, vendor, category
           FROM apps
           WHERE deleted_at IS NULL
             AND (name ILIKE $1 OR vendor ILIKE $1 OR category ILIKE $1)
           LIMIT 5`,
          [pattern],
        )
        for (const a of apps) {
          results.push({
            type: 'app',
            id: a.id,
            title: a.name,
            subtitle: [a.vendor, a.category].filter(Boolean).join(' · ') || 'App',
            url: `/apps`,
          })
        }

        // Search documents (filename only — documents table has no description column)
        const { rows: docs } = await pool.query<{
          id: string
          filename: string
          mime: string
        }>(
          `SELECT id, filename, mime
           FROM documents
           WHERE deleted_at IS NULL
             AND filename ILIKE $1
           LIMIT 5`,
          [pattern],
        )
        for (const d of docs) {
          results.push({
            type: 'document',
            id: d.id,
            title: d.filename,
            subtitle: d.mime ?? 'Document',
            url: `/documents`,
          })
        }

        // Search secrets metadata: title, username ONLY — NEVER ciphertext, iv, auth_tag, wrapped_dek, value
        const { rows: secrets } = await pool.query<{
          id: string
          vault_id: string
          title: string
          username: string | null
        }>(
          `SELECT id, vault_id, title, username
           FROM secrets
           WHERE deleted_at IS NULL
             AND (title ILIKE $1 OR username ILIKE $1)
           LIMIT 5`,
          [pattern],
        )
        for (const s of secrets) {
          results.push({
            type: 'secret',
            id: s.id,
            title: s.title,
            subtitle: s.username ? `User: ${s.username}` : 'Secret',
            url: `/vault/${s.vault_id}`,
          })
        }

        // Trim to 20 total
        res.json({ results: results.slice(0, 20) })
      } catch (err) {
        next(err)
      }
    },
  )

  return router
}
