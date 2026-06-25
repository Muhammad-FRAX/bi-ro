import { Router } from 'express'
import type { Pool } from 'pg'
import { authenticateSelf } from '../auth/self.ts'

export function authRouter(pool: Pool): Router {
  const router = Router()

  router.post('/auth/login', async (req, res, next) => {
    try {
      const { email, password } = req.body as { email?: unknown; password?: unknown }

      if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
        res.status(400).json({ error: 'email and password are required' })
        return
      }

      const identity = await authenticateSelf(pool, email, password)

      if (!identity) {
        res.status(401).json({ error: 'Invalid credentials' })
        return
      }

      // Regenerate session ID on login to prevent session fixation attacks
      req.session.regenerate((regenErr) => {
        if (regenErr) return next(regenErr)

        req.session.userId = identity.userId
        req.session.email = identity.email
        req.session.displayName = identity.displayName
        req.session.permissions = identity.permissions
        req.session.forcePasswordChange = identity.forcePasswordChange

        req.session.save((saveErr) => {
          if (saveErr) return next(saveErr)
          res.json({
            user: {
              userId: identity.userId,
              email: identity.email,
              displayName: identity.displayName,
              forcePasswordChange: identity.forcePasswordChange,
            },
          })
        })
      })
    } catch (err) {
      next(err)
    }
  })

  router.post('/auth/logout', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err)
      res.clearCookie('biro.sid')
      res.json({ ok: true })
    })
  })

  router.get('/auth/me', (req, res) => {
    if (!req.session.userId) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    res.json({
      userId: req.session.userId,
      email: req.session.email,
      displayName: req.session.displayName,
      permissions: req.session.permissions ?? [],
      forcePasswordChange: req.session.forcePasswordChange ?? false,
    })
  })

  return router
}
