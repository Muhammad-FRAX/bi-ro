import { createHash, randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import type { KeycloakConfig } from '../config.ts'
import type { AuthIdentity, AuthProvider, StepUpCredentials } from './types.ts'
import { logger } from '../util/logger.ts'

// Step-up window: if the user authenticated within this many ms, step-up passes
const STEP_UP_WINDOW_MS = 30 * 60 * 1000

interface OidcDiscovery {
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
  end_session_endpoint?: string
}

interface IdTokenClaims {
  sub: string
  email?: string
  preferred_username?: string
  name?: string
  groups?: string[]
  realm_access?: { roles?: string[] }
  nonce?: string
}

export class KeycloakProvider implements AuthProvider {
  private discovery: OidcDiscovery | null = null
  private discoveryFetchedAt = 0

  constructor(
    private readonly pool: Pool,
    private readonly config: KeycloakConfig,
  ) {}

  /** True when the required env vars are present */
  get isConfigured(): boolean {
    return Boolean(this.config.issuer && this.config.clientId && this.config.clientSecret)
  }

  private async getDiscovery(): Promise<OidcDiscovery> {
    // Re-fetch discovery every 12 hours
    if (!this.discovery || Date.now() - this.discoveryFetchedAt > 12 * 60 * 60 * 1000) {
      const url = `${this.config.issuer}/.well-known/openid-configuration`
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`)
      this.discovery = (await res.json()) as OidcDiscovery
      this.discoveryFetchedAt = Date.now()
    }
    return this.discovery
  }

  /** Generate PKCE code_challenge from a code_verifier */
  static buildCodeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url')
  }

  /** Generate a cryptographically random PKCE code_verifier */
  static generateCodeVerifier(): string {
    return randomBytes(48).toString('base64url')
  }

  /** Build the Keycloak authorization URL for the login or step-up redirect */
  async buildAuthUrl(opts: {
    state: string
    codeChallenge: string
    nonce: string
    redirectUri: string
    stepUp?: boolean
  }): Promise<string> {
    const discovery = await this.getDiscovery()
    const params = new URLSearchParams({
      client_id: this.config.clientId!,
      redirect_uri: opts.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: opts.state,
      code_challenge: opts.codeChallenge,
      code_challenge_method: 'S256',
      nonce: opts.nonce,
    })
    if (opts.stepUp) {
      params.set('max_age', '0')
      params.set('prompt', 'login')
    }
    return `${discovery.authorization_endpoint}?${params.toString()}`
  }

  /**
   * Exchange the authorization code for tokens, then validate the access token
   * by calling the userinfo endpoint (confidential-client flow — the code exchange
   * with client_secret proves Keycloak issued the tokens).
   */
  async handleCallback(
    code: string,
    codeVerifier: string,
    redirectUri: string,
    expectedNonce: string,
  ): Promise<{ identity: AuthIdentity; lastAuthAt: number }> {
    const discovery = await this.getDiscovery()

    // Exchange authorization code for tokens
    const tokenRes = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: this.config.clientId!,
        client_secret: this.config.clientSecret!,
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!tokenRes.ok) {
      const body = await tokenRes.text()
      throw new Error(`Token exchange failed: ${tokenRes.status} ${body}`)
    }
    const tokens = (await tokenRes.json()) as {
      access_token: string
      id_token?: string
      token_type: string
    }

    // Validate access token + get user info via userinfo endpoint
    const userInfoRes = await fetch(discovery.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!userInfoRes.ok) throw new Error(`Userinfo fetch failed: ${userInfoRes.status}`)
    const userInfo = (await userInfoRes.json()) as IdTokenClaims

    // Verify nonce from ID token if present (basic replay protection)
    if (tokens.id_token) {
      try {
        const [, payloadB64] = tokens.id_token.split('.')
        const claims = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString()) as IdTokenClaims
        if (claims.nonce && claims.nonce !== expectedNonce) {
          throw new Error('Nonce mismatch — possible replay attack')
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('Nonce mismatch')) throw err
        // Ignore JWT parse errors (non-JWT tokens from some Keycloak configs)
      }
    }

    const identity = await this.provisionUser(userInfo)
    return { identity, lastAuthAt: Date.now() }
  }

  /**
   * Provision or link a BI-Ro user from Keycloak claims.
   * - Existing user (matched by external_id or email with auth_mode='keycloak') → update last_login
   * - New user → auto-provision with configured default role
   */
  async provisionUser(claims: IdTokenClaims): Promise<AuthIdentity> {
    const email = (claims.email ?? claims.preferred_username ?? '').toLowerCase()
    if (!email) throw new Error('Keycloak did not return an email address')
    const externalId = claims.sub
    const displayName = claims.name ?? claims.preferred_username ?? email

    // Load group→role mapping from settings
    const { rows: mappingRows } = await this.pool.query<{ value: Record<string, unknown> }>(
      `SELECT value FROM settings WHERE key = 'auth_mappings'`,
    )
    const mappingGroups = (mappingRows[0]?.value as { groups?: Record<string, string> } | undefined)?.groups ?? {}

    // Determine BI-Ro role from Keycloak groups / realm roles
    const kcGroups = [
      ...(claims.groups ?? []),
      ...(claims.realm_access?.roles ?? []),
    ]
    let biroRoleName = this.config.defaultRole
    for (const g of kcGroups) {
      if (mappingGroups[g]) {
        biroRoleName = mappingGroups[g]!
        break
      }
    }

    // Find existing user: prefer matching by external_id (sub), fall back to email
    const { rows: existing } = await this.pool.query<{ id: string }>(
      `SELECT id FROM users
       WHERE (external_id = $1 OR (email = $2 AND auth_mode = 'keycloak'))
         AND deleted_at IS NULL
       LIMIT 1`,
      [externalId, email],
    )

    let userId: string

    if (existing[0]) {
      userId = existing[0].id
      await this.pool.query(
        `UPDATE users SET external_id = $1, email = $2, display_name = $3, last_login_at = NOW()
         WHERE id = $4`,
        [externalId, email, displayName, userId],
      )
    } else {
      // Auto-provision: look up the target role
      const { rows: roleRows } = await this.pool.query<{ id: string }>(
        `SELECT id FROM roles WHERE name = $1`,
        [biroRoleName],
      )
      if (!roleRows[0]) {
        logger.warn({ biroRoleName }, 'Keycloak default role not found — falling back to viewer')
        const { rows: fallbackRoles } = await this.pool.query<{ id: string }>(
          `SELECT id FROM roles WHERE name = 'viewer'`,
        )
        if (!fallbackRoles[0]) throw new Error('viewer role not found in DB')
        roleRows.push(fallbackRoles[0])
      }

      const client = await this.pool.connect()
      try {
        await client.query('BEGIN')
        const { rows: userRows } = await client.query<{ id: string }>(
          `INSERT INTO users (auth_mode, external_id, email, display_name, status, last_login_at)
           VALUES ('keycloak', $1, $2, $3, 'active', NOW())
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [externalId, email, displayName],
        )
        if (!userRows[0]) {
          // Race: user was created concurrently — fetch it
          const { rows: raceFetch } = await client.query<{ id: string }>(
            `SELECT id FROM users WHERE external_id = $1 AND deleted_at IS NULL`,
            [externalId],
          )
          userId = raceFetch[0]!.id
        } else {
          userId = userRows[0].id
          await client.query(
            `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [userId, roleRows[0]!.id],
          )
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    }

    const permissions = await this.resolveRoles(userId)
    return {
      userId,
      email,
      displayName,
      permissions,
      forcePasswordChange: false,
    }
  }

  /**
   * authenticate() is not used for Keycloak — login goes through the OIDC redirect flow.
   * Returns null always so that the standard POST /auth/login path correctly rejects.
   */
  async authenticate(_credentials: { email: string; password: string }): Promise<AuthIdentity | null> {
    return null
  }

  /**
   * Step-up for Keycloak: pass if the user authenticated (via OIDC callback) within
   * the last 30 minutes. If the session is stale, the caller receives 401 and the
   * frontend should redirect to Keycloak for re-authentication.
   */
  async stepUp(
    user: { userId: string; email: string; lastAuthAt?: number },
    _credentials: StepUpCredentials,
  ): Promise<boolean> {
    if (!user.lastAuthAt) return false
    return Date.now() - user.lastAuthAt < STEP_UP_WINDOW_MS
  }

  async resolveRoles(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ permission: string }>(
      `SELECT rp.permission
       FROM user_roles ur
       JOIN role_permissions rp ON ur.role_id = rp.role_id
       WHERE ur.user_id = $1
       UNION
       SELECT permission FROM user_permission_overrides
       WHERE user_id = $1 AND allow = TRUE
       EXCEPT
       SELECT permission FROM user_permission_overrides
       WHERE user_id = $1 AND allow = FALSE`,
      [userId],
    )
    return rows.map((r) => r.permission)
  }
}
