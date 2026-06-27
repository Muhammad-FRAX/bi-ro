import { hash, verify } from '@node-rs/argon2'
import type { Pool } from 'pg'
import type { AuthIdentity, AuthProvider, StepUpCredentials } from './types.ts'
import { verifyTotpCode } from './totp.ts'

let _dummyHashPromise: Promise<string> | undefined
function getDummyHash(): Promise<string> {
  if (!_dummyHashPromise) _dummyHashPromise = hash('__biro_timing_dummy__')
  return _dummyHashPromise
}

export class SelfAuthProvider implements AuthProvider {
  constructor(private readonly pool: Pool) {}

  async authenticate(credentials: { email: string; password: string; totpCode?: string }): Promise<AuthIdentity | null> {
    const trimmedEmail = credentials.email.trim()
    const { rows } = await this.pool.query<{
      id: string
      display_name: string
      password_hash: string | null
      status: string
      force_password_change: boolean
      totp_enabled: boolean
      totp_secret: string | null
    }>(
      `SELECT id, display_name, password_hash, status, force_password_change,
              totp_enabled, totp_secret
       FROM users
       WHERE email = $1 AND deleted_at IS NULL AND auth_mode = 'self'`,
      [trimmedEmail],
    )
    const user = rows[0]

    if (!user || !user.password_hash || user.status !== 'active') {
      await verify(await getDummyHash(), credentials.password).catch(() => false)
      return null
    }

    const valid = await verify(user.password_hash, credentials.password)
    if (!valid) return null

    // TOTP check: if enabled, require a valid code at login
    if (user.totp_enabled && user.totp_secret) {
      if (!credentials.totpCode) return null // TOTP required but not provided
      const totpOk = await verifyTotpCode(credentials.totpCode, user.totp_secret)
      if (!totpOk) return null
    }

    const permissions = await this.resolveRoles(user.id)
    return {
      userId: user.id,
      email: trimmedEmail,
      displayName: user.display_name,
      permissions,
      forcePasswordChange: user.force_password_change,
    }
  }

  async stepUp(
    user: { userId: string; email: string; lastAuthAt?: number },
    credentials: StepUpCredentials,
  ): Promise<boolean> {
    // Load user's TOTP state
    const { rows } = await this.pool.query<{
      totp_enabled: boolean
      totp_secret: string | null
    }>(
      `SELECT totp_enabled, totp_secret FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [user.userId],
    )
    const dbUser = rows[0]

    // Option A: TOTP code provided — verify it
    if (credentials.totpCode && dbUser?.totp_enabled && dbUser.totp_secret) {
      return verifyTotpCode(credentials.totpCode, dbUser.totp_secret)
    }

    // Option B: Password provided — re-verify password (TOTP NOT required for step-up if password is used)
    if (credentials.password) {
      const identity = await this.authenticate({ email: user.email, password: credentials.password })
      return identity !== null
    }

    return false
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
