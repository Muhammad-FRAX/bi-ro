import type { Request, Response, NextFunction } from 'express'
import { logger } from '../util/logger.ts'

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status = (err as NodeJS.ErrnoException & { status?: number; statusCode?: number }).status
    ?? (err as NodeJS.ErrnoException & { status?: number; statusCode?: number }).statusCode
    ?? 500

  logger.error({ err, requestId: req.id }, err.message)

  res.status(status).json({
    error: status < 500 ? err.message : 'Internal server error',
    requestId: req.id,
  })
}
