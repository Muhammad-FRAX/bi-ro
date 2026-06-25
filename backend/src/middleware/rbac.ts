import type { Request, Response, NextFunction } from 'express'

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }
  next()
}

export function requirePermission(flag: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session.userId) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    if (!(req.session.permissions ?? []).includes(flag)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    next()
  }
}
