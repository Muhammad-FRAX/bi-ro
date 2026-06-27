import { Router } from 'express'
import type { Pool } from 'pg'
import type { AuthProvider } from '../auth/types.ts'
import { requireAuth } from '../middleware/rbac.ts'
import { generateTotpSecret, buildOtpauthUri, verifyTotpCode } from '../auth/totp.ts'

export function authRouter(pool: Pool, provider: AuthProvider): Router {
  const router = Router()

  // ── POST /auth/login ────────────────────────────────────────────────────────
  router.post('/auth/login', async (req, res, next) => {
    try {
      const { email, password, totpCode } = req.body as {
        email?: unknown
        password?: unknown
        totpCode?: unknown
      }

      if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
        res.status(400).json({ error: 'email and password are required' })
        return
      }

      const identity = await provider.authenticate({
        email,
        password,
        totpCode: typeof totpCode === 'string' ? totpCode : undefined,
      })

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
        req.session.lastAuthAt = Date.now()

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

  // ── POST /auth/logout ───────────────────────────────────────────────────────
  router.post('/auth/logout', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err)
      res.clearCookie('biro.sid')
      res.json({ ok: true })
    })
  })

  // ── GET /auth/me ────────────────────────────────────────────────────────────
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

  // ── TOTP enrollment (self mode only, C7.4) ──────────────────────────────────

  /**
   * POST /auth/totp/enroll
   * Starts TOTP enrollment: generates a new secret, stores it as pending in the
   * session, and returns the otpauth:// URI for the user to scan.
   * The user must call POST /auth/totp/activate within the same session to confirm.
   */
  router.post('/auth/totp/enroll', requireAuth, async (req, res, next) => {
    try {
      const userId = req.session.userId!

      // Check not already enrolled
      const { rows } = await pool.query<{ totp_enabled: boolean }>(
        `SELECT totp_enabled FROM users WHERE id = $1`,
        [userId],
      )
      if (rows[0]?.totp_enabled) {
        return void res.status(409).json({ error: 'TOTP is already enabled. Disable it first.' })
      }

      const secret = await generateTotpSecret()

      // Load appTitle for the otpauth URI label
      const { rows: titleRows } = await pool.query<{ value: string }>(
        `SELECT value FROM settings WHERE key = 'appTitle'`,
      )
      const appTitle = String(titleRows[0]?.value ?? '"BI Root"').replace(/^"|"$/g, '')

      const otpauthUri = await buildOtpauthUri(secret, req.session.email!, appTitle)

      // Store pending secret in session (not in DB until confirmed)
      req.session.pendingTotpSecret = secret
      req.session.pendingTotpUserId = userId

      req.session.save((err) => {
        if (err) return next(err)
        res.json({ secret, otpauthUri })
      })
    } catch (err) {
      next(err)
    }
  })

  /**
   * POST /auth/totp/activate { code }
   * Verifies the TOTP code against the pending secret, then enables TOTP.
   */
  router.post('/auth/totp/activate', requireAuth, async (req, res, next) => {
    try {
      const { code } = req.body as { code?: unknown }
      const userId = req.session.userId!

      if (typeof code !== 'string' || !code.trim()) {
        return void res.status(400).json({ error: 'code is required' })
      }

      const pendingSecret = req.session.pendingTotpSecret
      if (!pendingSecret || req.session.pendingTotpUserId !== userId) {
        return void res.status(400).json({ error: 'No pending TOTP enrollment. Call /auth/totp/enroll first.' })
      }

      const valid = await verifyTotpCode(code.trim(), pendingSecret)
      if (!valid) {
        return void res.status(401).json({ error: 'Invalid TOTP code' })
      }

      // Persist secret and enable TOTP
      await pool.query(
        `UPDATE users SET totp_secret = $1, totp_enabled = TRUE, totp_enrolled_at = NOW() WHERE id = $2`,
        [pendingSecret, userId],
      )

      req.session.pendingTotpSecret = undefined
      req.session.pendingTotpUserId = undefined
      req.session.save((err) => {
        if (err) return next(err)
        res.json({ ok: true, message: 'TOTP enabled successfully' })
      })
    } catch (err) {
      next(err)
    }
  })

  /**
   * DELETE /auth/totp
   * Disables TOTP for the current user (requires valid current TOTP code or password).
   */
  router.delete('/auth/totp', requireAuth, async (req, res, next) => {
    try {
      const userId = req.session.userId!
      const { code, password } = req.body as { code?: unknown; password?: unknown }

      const { rows } = await pool.query<{ totp_secret: string | null; totp_enabled: boolean }>(
        `SELECT totp_secret, totp_enabled FROM users WHERE id = $1`,
        [userId],
      )
      const user = rows[0]

      if (!user?.totp_enabled) {
        return void res.status(409).json({ error: 'TOTP is not enabled' })
      }

      // Verify via TOTP code or password before disabling
      let authorized = false
      if (typeof code === 'string' && user.totp_secret) {
        authorized = await verifyTotpCode(code, user.totp_secret)
      } else if (typeof password === 'string') {
        // Delegate to provider step-up
        authorized = await provider.stepUp(
          { userId, email: req.session.email!, lastAuthAt: req.session.lastAuthAt },
          { password },
        )
      }

      if (!authorized) {
        return void res.status(401).json({ error: 'Provide a valid TOTP code or password to disable TOTP' })
      }

      await pool.query(
        `UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, totp_enrolled_at = NULL WHERE id = $1`,
        [userId],
      )

      res.json({ ok: true, message: 'TOTP disabled' })
    } catch (err) {
      next(err)
    }
  })

  /**
   * GET /auth/totp/status
   * Returns whether TOTP is enabled for the current user.
   */
  router.get('/auth/totp/status', requireAuth, async (req, res, next) => {
    try {
      const { rows } = await pool.query<{ totp_enabled: boolean; totp_enrolled_at: string | null }>(
        `SELECT totp_enabled, totp_enrolled_at FROM users WHERE id = $1`,
        [req.session.userId],
      )
      const user = rows[0]
      res.json({
        totpEnabled: user?.totp_enabled ?? false,
        enrolledAt: user?.totp_enrolled_at ?? null,
      })
    } catch (err) {
      next(err)
    }
  })

  return router
}
