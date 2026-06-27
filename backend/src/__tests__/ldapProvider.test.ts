/**
 * C7.3 — LdapProvider tests
 *
 * Pure unit tests (no real LDAP server needed) — mock the LDAP client.
 * DB tests verify the self-admin fallback and profile lookup logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LdapProvider } from '../auth/ldapProvider.ts'
import type { LdapConfig } from '../config.ts'
import type { Pool } from 'pg'

const DB_URL = process.env['DATABASE_URL']

const testConfig: LdapConfig = {
  url: 'ldap://192.168.1.10:389',
  bindTemplate: undefined,
  tlsEnabled: false,
}

function makePool(rows: Record<string, unknown>[][] = []): Pool {
  let callIdx = 0
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve({ rows: rows[callIdx++] ?? [] })),
    connect: vi.fn(),
  } as unknown as Pool
}

describe('LdapProvider', () => {
  describe('isConfigured', () => {
    it('returns true when LDAP_URL is set', () => {
      const p = new LdapProvider(makePool(), testConfig)
      expect(p.isConfigured).toBe(true)
    })

    it('returns false when LDAP_URL is absent', () => {
      const p = new LdapProvider(makePool(), { ...testConfig, url: undefined })
      expect(p.isConfigured).toBe(false)
    })
  })

  describe('buildBindDn (via authenticate)', () => {
    it('uses full email as bind DN when no LDAP_BIND_TEMPLATE', () => {
      // Private method tested via provider instance access
      const p = new LdapProvider(makePool(), testConfig)
      // @ts-expect-error testing private method
      expect(p.buildBindDn('user@company.com')).toBe('user@company.com')
    })

    it('replaces {username} in LDAP_BIND_TEMPLATE', () => {
      const p = new LdapProvider(makePool(), {
        ...testConfig,
        bindTemplate: '{username}@company.local',
      })
      // @ts-expect-error testing private method
      expect(p.buildBindDn('user@company.com')).toBe('user@company.local')
    })

    it('uses full string when email has no @ and no template', () => {
      const p = new LdapProvider(makePool(), testConfig)
      // @ts-expect-error testing private method
      expect(p.buildBindDn('sAMAccountName')).toBe('sAMAccountName')
    })
  })

  describe('authenticate()', () => {
    it('returns null when LDAP is not configured', async () => {
      // First query: self-user check → no rows
      const pool = makePool([[]])
      const p = new LdapProvider(pool, { ...testConfig, url: undefined })
      const result = await p.authenticate({ email: 'u@x.com', password: 'pw' })
      expect(result).toBeNull()
    })

    it('delegates to SelfAuthProvider for auth_mode=self users', async () => {
      // First query: self-user check → returns a self user
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'self-user-id' }] }) // self check
          .mockResolvedValueOnce({ rows: [] }) // SelfAuthProvider lookup (no user found → null)
          .mockResolvedValue({ rows: [] }),
      } as unknown as Pool
      const p = new LdapProvider(pool, testConfig)
      // SelfAuthProvider will look up the self user; since password_hash is not returned null
      const result = await p.authenticate({ email: 'admin@example.com', password: 'pass' })
      // SelfAuthProvider returns null (no password_hash mock) → expect null but confirm delegate happened
      expect(result).toBeNull()
      expect((pool.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("auth_mode = 'self'")
    })

    it('returns null when LDAP bind fails (wrong password)', async () => {
      const pool = makePool([[]])  // self check → no self user

      // Mock ldapts to throw an invalid-credentials error (code 49)
      vi.mock('ldapts', () => ({
        Client: vi.fn().mockImplementation(() => ({
          bind: vi.fn().mockRejectedValue(Object.assign(new Error('Invalid creds'), { code: 49 })),
          unbind: vi.fn().mockResolvedValue(undefined),
        })),
      }))

      const p = new LdapProvider(pool, testConfig)
      const result = await p.authenticate({ email: 'u@company.com', password: 'wrong' })
      expect(result).toBeNull()
    })

    it('returns null when LDAP bind succeeds but no BI-Ro profile exists', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] })  // self check → no self user
          .mockResolvedValueOnce({ rows: [] }),  // ldap profile lookup → not found
      } as unknown as Pool

      vi.mock('ldapts', () => ({
        Client: vi.fn().mockImplementation(() => ({
          bind: vi.fn().mockResolvedValue(undefined),
          unbind: vi.fn().mockResolvedValue(undefined),
        })),
      }))

      const p = new LdapProvider(pool, testConfig)
      const result = await p.authenticate({ email: 'unprovisioned@company.com', password: 'correct' })
      expect(result).toBeNull()
    })
  })

  describe('stepUp()', () => {
    it('returns false when password is not provided', async () => {
      const p = new LdapProvider(makePool(), testConfig)
      const result = await p.stepUp({ userId: 'u1', email: 'u@x.com' }, {})
      expect(result).toBe(false)
    })

    it('returns false when LDAP is not configured', async () => {
      const p = new LdapProvider(makePool(), { ...testConfig, url: undefined })
      const result = await p.stepUp({ userId: 'u1', email: 'u@x.com' }, { password: 'pw' })
      expect(result).toBe(false)
    })
  })
})

describe.skipIf(!DB_URL)('LdapProvider (structural gate)', () => {
  it('LdapProvider implements the AuthProvider interface', async () => {
    const { LdapProvider: LP } = await import('../auth/ldapProvider.ts')
    const p = new LP({} as Pool, { url: undefined, tlsEnabled: false })
    expect(typeof p.authenticate).toBe('function')
    expect(typeof p.stepUp).toBe('function')
    expect(typeof p.resolveRoles).toBe('function')
  })
})
