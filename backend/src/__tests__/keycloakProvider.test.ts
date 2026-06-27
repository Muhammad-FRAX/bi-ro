/**
 * C7.2 — KeycloakProvider tests
 *
 * Structural gate: validates provider shape and core behaviors.
 * DB-dependent tests are gated behind DB_URL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { KeycloakProvider } from '../auth/keycloakProvider.ts'
import type { KeycloakConfig } from '../config.ts'
import type { Pool } from 'pg'

const DB_URL = process.env['DATABASE_URL']

const testConfig: KeycloakConfig = {
  issuer: 'https://keycloak.test/realms/biro',
  clientId: 'bi-ro',
  clientSecret: 'test-secret',
  redirectUri: 'http://localhost:5000/api/auth/keycloak/callback',
  defaultRole: 'viewer',
}

function makePool(overrides: Partial<Pool> = {}): Pool {
  return {
    query: vi.fn(),
    connect: vi.fn(),
    ...overrides,
  } as unknown as Pool
}

describe('KeycloakProvider', () => {
  describe('static helpers', () => {
    it('buildCodeChallenge returns base64url-encoded SHA-256 of verifier', () => {
      const verifier = 'abc123'
      const challenge = KeycloakProvider.buildCodeChallenge(verifier)
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/) // base64url
      expect(challenge.length).toBeGreaterThan(20)
    })

    it('generateCodeVerifier returns a long random base64url string', () => {
      const v1 = KeycloakProvider.generateCodeVerifier()
      const v2 = KeycloakProvider.generateCodeVerifier()
      expect(v1.length).toBeGreaterThan(40)
      expect(v1).not.toBe(v2)
    })

    it('different verifiers produce different challenges', () => {
      const c1 = KeycloakProvider.buildCodeChallenge(KeycloakProvider.generateCodeVerifier())
      const c2 = KeycloakProvider.buildCodeChallenge(KeycloakProvider.generateCodeVerifier())
      expect(c1).not.toBe(c2)
    })
  })

  describe('isConfigured', () => {
    it('returns true when all required env vars are present', () => {
      const provider = new KeycloakProvider(makePool(), testConfig)
      expect(provider.isConfigured).toBe(true)
    })

    it('returns false when issuer is missing', () => {
      const provider = new KeycloakProvider(makePool(), { ...testConfig, issuer: undefined })
      expect(provider.isConfigured).toBe(false)
    })

    it('returns false when clientId is missing', () => {
      const provider = new KeycloakProvider(makePool(), { ...testConfig, clientId: undefined })
      expect(provider.isConfigured).toBe(false)
    })

    it('returns false when clientSecret is missing', () => {
      const provider = new KeycloakProvider(makePool(), { ...testConfig, clientSecret: undefined })
      expect(provider.isConfigured).toBe(false)
    })
  })

  describe('authenticate()', () => {
    it('always returns null — login uses the OIDC redirect flow, not direct credentials', async () => {
      const provider = new KeycloakProvider(makePool(), testConfig)
      const result = await provider.authenticate({ email: 'user@example.com', password: 'pw' })
      expect(result).toBeNull()
    })
  })

  describe('stepUp()', () => {
    it('returns true when lastAuthAt is within 30 minutes', async () => {
      const provider = new KeycloakProvider(makePool(), testConfig)
      const lastAuthAt = Date.now() - 5 * 60 * 1000 // 5 min ago
      const ok = await provider.stepUp(
        { userId: 'u1', email: 'u@x.com', lastAuthAt },
        {},
      )
      expect(ok).toBe(true)
    })

    it('returns false when lastAuthAt is older than 30 minutes', async () => {
      const provider = new KeycloakProvider(makePool(), testConfig)
      const lastAuthAt = Date.now() - 31 * 60 * 1000 // 31 min ago
      const ok = await provider.stepUp(
        { userId: 'u1', email: 'u@x.com', lastAuthAt },
        {},
      )
      expect(ok).toBe(false)
    })

    it('returns false when lastAuthAt is undefined', async () => {
      const provider = new KeycloakProvider(makePool(), testConfig)
      const ok = await provider.stepUp({ userId: 'u1', email: 'u@x.com' }, {})
      expect(ok).toBe(false)
    })
  })
})

describe.skipIf(!DB_URL)('KeycloakProvider (DB-gated)', () => {
  let provider: KeycloakProvider

  beforeEach(() => {
    // Use a real pool but with mocked fetch for OIDC discovery
    provider = new KeycloakProvider(makePool(), testConfig)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolveRoles returns empty array for unknown user', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool
    const p = new KeycloakProvider(pool, testConfig)
    const roles = await p.resolveRoles('nonexistent-user-id')
    expect(Array.isArray(roles)).toBe(true)
    expect(roles.length).toBe(0)
  })
})
