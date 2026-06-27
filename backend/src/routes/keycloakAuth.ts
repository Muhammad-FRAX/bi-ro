import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import type { KeycloakProvider } from '../auth/keycloakProvider.ts'
import { logger } from '../util/logger.ts'

/**
 * OIDC routes for Keycloak mode (C7.2).
 * Mounted under /api when AUTH_MODE=keycloak.
 *
 * GET  /auth/keycloak/login            — initiate OIDC authorization code + PKCE flow
 * GET  /auth/keycloak/callback         — exchange code, provision user, create session
 * GET  /auth/keycloak/stepup           — initiate step-up re-auth (max_age=0)
 * GET  /auth/keycloak/stepup/callback  — mark session as freshly authenticated
 */
export function keycloakAuthRouter(provider: KeycloakProvider): Router {
  const router = Router()

  const redirectUri = (req: { headers: { host?: string }; secure?: boolean }, path: string): string => {
    // Use KEYCLOAK_REDIRECT_URI from config if set (recommended for prod),
    // else derive from request host (handy for dev/test)
    if (provider['config'].redirectUri && !provider['config'].redirectUri.includes('/auth/keycloak/callback')) {
      // If the configured redirect URI points to callback, derive stepup from it
      return provider['config'].redirectUri
    }
    return provider['config'].redirectUri ?? `${req.secure ? 'https' : 'http'}://${req.headers.host}/api${path}`
  }

  // ── GET /auth/keycloak/login ────────────────────────────────────────────────
  router.get('/auth/keycloak/login', (req, res, next) => {
    if (!provider.isConfigured) {
      return void res.status(503).json({
        error: 'Keycloak is not configured. Set KEYCLOAK_ISSUER, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET, KEYCLOAK_REDIRECT_URI in your .env file.',
        needsConfig: true,
      })
    }

    const state = randomBytes(16).toString('hex')
    const nonce = randomBytes(16).toString('hex')
    const codeVerifier = KeycloakProvider.generateCodeVerifier()
    const codeChallenge = KeycloakProvider.buildCodeChallenge(codeVerifier)
    const cbUri = redirectUri(req, '/auth/keycloak/callback')

    req.session.oidcState = state
    req.session.oidcCodeVerifier = codeVerifier
    req.session.oidcNonce = nonce

    req.session.save((err) => {
      if (err) return next(err)
      provider.buildAuthUrl({ state, codeChallenge, nonce, redirectUri: cbUri })
        .then((url) => res.redirect(url))
        .catch(next)
    })
  })

  // ── GET /auth/keycloak/callback ─────────────────────────────────────────────
  router.get('/auth/keycloak/callback', async (req, res, next) => {
    try {
      const { code, state, error, error_description } = req.query as Record<string, string | undefined>

      if (error) {
        logger.warn({ error, error_description }, 'Keycloak OIDC error')
        return void res.redirect(`/?auth_error=${encodeURIComponent(error_description ?? error ?? 'oidc_error')}`)
      }

      if (!code || !state) {
        return void res.status(400).json({ error: 'Missing code or state' })
      }
      if (state !== req.session.oidcState) {
        return void res.status(400).json({ error: 'State mismatch — possible CSRF' })
      }

      const codeVerifier = req.session.oidcCodeVerifier
      const nonce = req.session.oidcNonce ?? ''
      if (!codeVerifier) {
        return void res.status(400).json({ error: 'Missing PKCE code verifier in session' })
      }

      const cbUri = redirectUri(req, '/auth/keycloak/callback')
      const { identity, lastAuthAt } = await provider.handleCallback(code, codeVerifier, cbUri, nonce)

      req.session.regenerate((regenErr) => {
        if (regenErr) return next(regenErr)

        req.session.userId = identity.userId
        req.session.email = identity.email
        req.session.displayName = identity.displayName
        req.session.permissions = identity.permissions
        req.session.forcePasswordChange = identity.forcePasswordChange
        req.session.lastAuthAt = lastAuthAt

        req.session.save((saveErr) => {
          if (saveErr) return next(saveErr)
          res.redirect('/')
        })
      })
    } catch (err) {
      next(err)
    }
  })

  // ── GET /auth/keycloak/stepup ───────────────────────────────────────────────
  // Initiates a Keycloak re-auth with max_age=0 (forces re-login even if SSO active).
  // The ?returnTo query param is encoded in state so the stepup callback can redirect back.
  router.get('/auth/keycloak/stepup', (req, res, next) => {
    if (!req.session.userId) {
      return void res.status(401).json({ error: 'Authentication required' })
    }
    if (!provider.isConfigured) {
      return void res.status(503).json({ error: 'Keycloak not configured', needsConfig: true })
    }

    const returnTo = typeof req.query['returnTo'] === 'string' ? req.query['returnTo'] : '/'
    const state = randomBytes(16).toString('hex')
    const nonce = randomBytes(16).toString('hex')
    const codeVerifier = KeycloakProvider.generateCodeVerifier()
    const codeChallenge = KeycloakProvider.buildCodeChallenge(codeVerifier)
    const cbUri = redirectUri(req, '/auth/keycloak/stepup/callback')

    req.session.oidcState = `stepup:${state}:${encodeURIComponent(returnTo)}`
    req.session.oidcCodeVerifier = codeVerifier
    req.session.oidcNonce = nonce

    req.session.save((err) => {
      if (err) return next(err)
      provider.buildAuthUrl({ state: req.session.oidcState!, codeChallenge, nonce, redirectUri: cbUri, stepUp: true })
        .then((url) => res.redirect(url))
        .catch(next)
    })
  })

  // ── GET /auth/keycloak/stepup/callback ──────────────────────────────────────
  // After Keycloak re-auth, validate tokens and refresh the session's lastAuthAt.
  router.get('/auth/keycloak/stepup/callback', async (req, res, next) => {
    try {
      const { code, state, error } = req.query as Record<string, string | undefined>

      if (error) {
        return void res.redirect(`/?stepup_error=${encodeURIComponent(error)}`)
      }
      if (!code || !state || state !== req.session.oidcState) {
        return void res.status(400).json({ error: 'State mismatch' })
      }

      // Parse returnTo from state
      const parts = state.split(':')
      const returnTo = parts.length >= 3 ? decodeURIComponent(parts.slice(2).join(':')) : '/'

      const codeVerifier = req.session.oidcCodeVerifier!
      const nonce = req.session.oidcNonce ?? ''
      const cbUri = redirectUri(req, '/auth/keycloak/stepup/callback')

      // We only need the tokens to update lastAuthAt; ignore provisioning (user already exists)
      await provider.handleCallback(code, codeVerifier, cbUri, nonce)

      req.session.lastAuthAt = Date.now()
      req.session.oidcState = undefined
      req.session.oidcCodeVerifier = undefined
      req.session.oidcNonce = undefined

      req.session.save((err) => {
        if (err) return next(err)
        res.redirect(returnTo)
      })
    } catch (err) {
      next(err)
    }
  })

  return router
}
