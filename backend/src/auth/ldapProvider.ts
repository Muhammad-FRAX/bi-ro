import type { Pool } from 'pg'
import type { LdapConfig } from '../config.ts'
import type { AuthIdentity, AuthProvider, StepUpCredentials } from './types.ts'
import { SelfAuthProvider } from './selfProvider.ts'
import { logger } from '../util/logger.ts'

/**
 * LdapProvider — Active Directory / LDAP authentication (C7.3).
 *
 * Authentication flow:
 *  1. If the user has auth_mode='self' in the DB (env-seeded admin), fall back to
 *     SelfAuthProvider so the admin always works regardless of AUTH_MODE.
 *  2. Otherwise, try to bind to AD using the user's email as the bind DN
 *     (or using LDAP_BIND_TEMPLATE if configured).
 *  3. On successful bind, look up the BI-Ro user by email with auth_mode='ldap'.
 *     If no profile exists → reject (admin must pre-create the account).
 *
 * User provisioning (done by admin in Settings → Users → New user with authMode=ldap):
 *  - Admin enters displayName, email, role; no password field.
 *  - auth_mode='ldap' is set; external_id is left NULL (matched by email).
 *  - First successful LDAP bind sets last_login_at.
 *
 * Step-up: re-bind to LDAP with the password the user enters.
 */
export class LdapProvider implements AuthProvider {
  private readonly selfProvider: SelfAuthProvider

  constructor(
    private readonly pool: Pool,
    private readonly config: LdapConfig,
  ) {
    this.selfProvider = new SelfAuthProvider(pool)
  }

  get isConfigured(): boolean {
    return Boolean(this.config.url)
  }

  /**
   * Build the bind DN from the email.
   * If LDAP_BIND_TEMPLATE is set (e.g. "{username}@company.local"), the username
   * part of the email replaces {username}. Otherwise the full email is used as-is
   * (works with UPN format in AD: user@domain.local).
   */
  private buildBindDn(email: string): string {
    if (!this.config.bindTemplate) return email
    const username = email.includes('@') ? email.split('@')[0]! : email
    return this.config.bindTemplate.replace('{username}', username)
  }

  /** Attempt to bind to the LDAP server. Returns true on success, false on failure. */
  private async tryBind(bindDn: string, password: string): Promise<boolean> {
    if (!this.config.url) return false

    let Client: typeof import('ldapts').Client
    try {
      // Dynamic import so the server boots cleanly even if ldapts isn't installed
      const mod = await import('ldapts')
      Client = mod.Client
    } catch {
      logger.warn('ldapts is not installed — LDAP authentication is unavailable')
      return false
    }

    const client = new Client({
      url: this.config.url,
      tlsOptions: this.config.tlsEnabled ? { rejectUnauthorized: true } : undefined,
      timeout: 10_000,
      connectTimeout: 10_000,
    })

    try {
      await client.bind(bindDn, password)
      return true
    } catch (err) {
      // 49 = Invalid credentials; log others as warnings
      const ldapErr = err as { code?: number }
      if (ldapErr.code !== 49) {
        logger.warn({ err, bindDn }, 'LDAP bind error (non-auth failure)')
      }
      return false
    } finally {
      await client.unbind().catch(() => {})
    }
  }

  async authenticate(credentials: { email: string; password: string }): Promise<AuthIdentity | null> {
    const email = credentials.email.trim().toLowerCase()

    // 1. Check for env-seeded admin (auth_mode='self') — always falls back to SelfAuthProvider
    const { rows: selfRows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 AND auth_mode = 'self' AND deleted_at IS NULL`,
      [email],
    )
    if (selfRows[0]) {
      return this.selfProvider.authenticate(credentials)
    }

    // 2. Reject if LDAP is not configured
    if (!this.isConfigured) {
      logger.warn('LDAP URL is not configured — authentication unavailable')
      return null
    }

    // 3. Bind to LDAP using the email as bind DN
    const bindDn = this.buildBindDn(email)
    const bound = await this.tryBind(bindDn, credentials.password)
    if (!bound) return null

    // 4. Find BI-Ro profile — must be pre-created by admin
    const { rows } = await this.pool.query<{
      id: string
      display_name: string
      status: string
      force_password_change: boolean
    }>(
      `SELECT id, display_name, status, force_password_change
       FROM users
       WHERE email = $1 AND auth_mode = 'ldap' AND deleted_at IS NULL`,
      [email],
    )
    const user = rows[0]
    if (!user) {
      // Bind succeeded but no BI-Ro profile → reject (admin must create the account)
      logger.info({ email }, 'LDAP bind succeeded but no BI-Ro profile found')
      return null
    }
    if (user.status !== 'active') {
      logger.info({ email, status: user.status }, 'LDAP user account is not active')
      return null
    }

    // 5. Update last_login_at
    await this.pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id])

    const permissions = await this.resolveRoles(user.id)
    return {
      userId: user.id,
      email,
      displayName: user.display_name,
      permissions,
      forcePasswordChange: user.force_password_change,
    }
  }

  async stepUp(
    user: { userId: string; email: string; lastAuthAt?: number },
    credentials: StepUpCredentials,
  ): Promise<boolean> {
    if (!credentials.password) return false
    if (!this.isConfigured) return false

    // Re-bind to LDAP to verify the password
    const bindDn = this.buildBindDn(user.email)
    return this.tryBind(bindDn, credentials.password)
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
