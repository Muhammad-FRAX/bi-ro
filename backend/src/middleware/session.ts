import session from 'express-session'
import type { RequestHandler } from 'express'
import { logger } from '../util/logger.ts'

// Augment express-session's SessionData with BI-Ro fields stored at login
declare module 'express-session' {
  interface SessionData {
    userId: string
    email: string
    displayName: string
    permissions: string[]
    forcePasswordChange: boolean
  }
}

interface SessionMiddlewareOptions {
  secret: string
  secure?: boolean
}

export function createSessionMiddleware(options: SessionMiddlewareOptions): RequestHandler {
  if (process.env['NODE_ENV'] === 'production') {
    logger.warn('express-session is using MemoryStore — not suitable for multi-instance production deployment')
  }
  return session({
    secret: options.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: options.secure ?? false,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
    name: 'biro.sid',
  })
}
