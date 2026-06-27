import { hash, verify } from '@node-rs/argon2'
import type { Pool } from 'pg'
import type { AuthIdentity, AuthProvider } from './types.ts'

let _dummyHashPromise: Promise<string> | undefined
function getDummyHash(): Promise<string> {
  if (!_dummyHashPromise) _dummyHashPromise = hash('__biro_timing_dummy__')
  return _dummyHashPromise
}

export class SelfAuthProvider implements AuthProvider {
  constructor(private readonly pool: Pool) {}

  async authenticate(credentials: { email: string; password: string }): Promise<AuthIdentity | null> {
    const trimmedEmail = credentials.email.trim()
    const { rows } = await this.pool.query<{
      id: string
      display_name: string
      password_hash: string | null
      status: string
      force_password_change: boolean
    }>(
      `SELECT id, display_name, password_hash, status, force_password_change
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

    const permissions = await this.resolveRoles(user.id)
    return {
      userId: user.id,
      email: trimmedEmail,
      displayName: user.display_name,
      permissions,
      forcePasswordChange: user.force_password_change,
    }
  }

  async stepUp(user: { userId: string; email: string }, credentials: { password?: string }): Promise<boolean> {
    if (!credentials.password) return false
    const identity = await this.authenticate({ email: user.email, password: credentials.password })
    return identity !== null
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
