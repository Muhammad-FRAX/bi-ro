import { createHash, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'
import type { Request, Response, NextFunction } from 'express'

// Compute SHA-256 hex hash of a raw API key
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

// Constant-time comparison of two hex strings (must be same length to be equal)
export function timingSafeHashCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

// Middleware factory: validates X-API-Key header and checks required scope
export function requireApiKey(scope: string) {
  return (pool: Pool) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const rawKey = req.headers['x-api-key']
      if (!rawKey || typeof rawKey !== 'string') {
        res.status(401).json({ error: 'API key required' })
        return
      }

      const keyHash = hashApiKey(rawKey)

      // Query by hash — constant-time after hashing since hashing is deterministic
      const { rows } = await pool.query<{
        id: string
        scopes: string[]
        key_hash: string
      }>(
        `SELECT id, scopes, key_hash FROM api_clients WHERE revoked_at IS NULL AND key_hash = $1`,
        [keyHash],
      ).catch(() => ({ rows: [] as Array<{ id: string; scopes: string[]; key_hash: string }> }))

      if (!rows[0]) {
        res.status(401).json({ error: 'Invalid API key' })
        return
      }

      // Defense-in-depth: constant-time compare stored hash vs computed hash
      if (!timingSafeHashCompare(rows[0].key_hash, keyHash)) {
        res.status(401).json({ error: 'Invalid API key' })
        return
      }

      const scopes: string[] = rows[0].scopes
      if (!scopes.includes(scope)) {
        res.status(403).json({ error: 'Insufficient scope' })
        return
      }

      // Attach client id to request for downstream use
      req.apiClientId = rows[0].id
      next()
    }
}
