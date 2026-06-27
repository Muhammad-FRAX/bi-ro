import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import pg from 'pg'
import { hashPassword } from '../auth/self.ts'
import { SelfAuthProvider } from '../auth/selfProvider.ts'
import { runMigrations } from '../db/migrate.ts'
import type { AuthProvider } from '../auth/types.ts'

const { Pool } = pg
const DB_URL = process.env['DATABASE_URL']
const __dirname = dirname(fileURLToPath(import.meta.url))

// ── C7.1 structural gate: no direct authenticateSelf calls in routes/middleware ─

describe('C7.1 structural gate — AuthProvider interface enforced', () => {
  it('routes/auth.ts does not import authenticateSelf directly', () => {
    const content = readFileSync(join(__dirname, '..', 'routes', 'auth.ts'), 'utf8')
    expect(content).not.toContain('authenticateSelf')
  })

  it('middleware/stepUp.ts does not import authenticateSelf directly', () => {
    const content = readFileSync(join(__dirname, '..', 'middleware', 'stepUp.ts'), 'utf8')
    expect(content).not.toContain('authenticateSelf')
  })

  it('SelfAuthProvider implements all AuthProvider methods', () => {
    const proto = SelfAuthProvider.prototype
    expect(typeof proto.authenticate).toBe('function')
    expect(typeof proto.stepUp).toBe('function')
    expect(typeof proto.resolveRoles).toBe('function')
  })
})

// ── C7.1 integration: SelfAuthProvider works correctly through the interface ──

describe.skipIf(!DB_URL)('C7.1 SelfAuthProvider via AuthProvider interface', () => {
  let pool: pg.Pool
  let provider: AuthProvider

  const EMAIL = 'provider-test@biro.local'
  const PASS = 'Provider1234!'

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL })
    pool.on('error', () => {})
    await runMigrations(DB_URL!)

    await pool.query(`DELETE FROM users WHERE email = $1`, [EMAIL])
    const hash = await hashPassword(PASS)
    await pool.query(
      `INSERT INTO users (auth_mode, email, display_name, password_hash, status)
       VALUES ('self', $1, 'Provider Test', $2, 'active')`,
      [EMAIL, hash],
    )

    provider = new SelfAuthProvider(pool)
  }, 30_000)

  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM users WHERE email = $1`, [EMAIL])
      await pool.end()
    }
  })

  it('authenticate returns AuthIdentity for valid credentials', async () => {
    const identity = await provider.authenticate({ email: EMAIL, password: PASS })
    expect(identity).not.toBeNull()
    expect(identity!.email).toBe(EMAIL)
    expect(identity!.displayName).toBe('Provider Test')
    expect(Array.isArray(identity!.permissions)).toBe(true)
    expect(typeof identity!.userId).toBe('string')
    expect(identity!.forcePasswordChange).toBe(false)
  })

  it('authenticate returns null for wrong password', async () => {
    const identity = await provider.authenticate({ email: EMAIL, password: 'wrong-pass' })
    expect(identity).toBeNull()
  })

  it('authenticate returns null for unknown email', async () => {
    const identity = await provider.authenticate({ email: 'nobody@biro.local', password: PASS })
    expect(identity).toBeNull()
  })

  it('stepUp returns true for correct password', async () => {
    const identity = await provider.authenticate({ email: EMAIL, password: PASS })
    expect(identity).not.toBeNull()
    const ok = await provider.stepUp({ userId: identity!.userId, email: EMAIL }, { password: PASS })
    expect(ok).toBe(true)
  })

  it('stepUp returns false for wrong password', async () => {
    const identity = await provider.authenticate({ email: EMAIL, password: PASS })
    expect(identity).not.toBeNull()
    const ok = await provider.stepUp({ userId: identity!.userId, email: EMAIL }, { password: 'wrong' })
    expect(ok).toBe(false)
  })

  it('stepUp returns false when no password provided', async () => {
    const identity = await provider.authenticate({ email: EMAIL, password: PASS })
    expect(identity).not.toBeNull()
    const ok = await provider.stepUp({ userId: identity!.userId, email: EMAIL }, {})
    expect(ok).toBe(false)
  })

  it('resolveRoles returns an array of permission strings for a user', async () => {
    const identity = await provider.authenticate({ email: EMAIL, password: PASS })
    expect(identity).not.toBeNull()
    const roles = await provider.resolveRoles(identity!.userId)
    expect(Array.isArray(roles)).toBe(true)
  })
})
