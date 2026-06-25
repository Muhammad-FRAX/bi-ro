import type { Pool } from 'pg'
import type { Request, Response, NextFunction, RequestHandler } from 'express'

const ALWAYS_ALLOWED = ['/setup/state', '/setup/initialize', '/health']

let _initialized = false

export function setupGuard(pool: Pool): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Fast path: once initialized the flag is cached in-process
    if (_initialized) {
      next()
      return
    }

    // Always allow health + setup routes regardless of init state
    const allowed = ALWAYS_ALLOWED.some((p) => req.path.startsWith(p))
    if (allowed) {
      next()
      return
    }

    try {
      const { rows } = await pool.query<{ initialized: boolean }>(
        `SELECT initialized FROM setup_state WHERE id = TRUE`,
      )
      if (rows[0]?.initialized) {
        _initialized = true
        next()
        return
      }
      res.status(503).json({
        error: 'Application not initialized. Complete setup at /setup to continue.',
      })
    } catch (err) {
      next(err)
    }
  }
}

export function resetSetupGuardForTesting(): void {
  _initialized = false
}
