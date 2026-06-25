import type { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'

declare global {
  namespace Express {
    interface Request {
      id: string
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = randomUUID()
  req.id = id
  res.setHeader('X-Request-Id', id)
  next()
}
