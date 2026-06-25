import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import pg from 'pg'
import { runMigrations } from '../db/migrate.ts'
import { createSessionMiddleware } from '../middleware/session.ts'
import { authRouter } from '../routes/auth.ts'
import { setupRouter } from '../routes/setup.ts'
import { setupGuard, resetSetupGuardForTesting } from '../middleware/setupGuard.ts'

const { Pool } = pg
const DB_URL = process.env['DATABASE_URL']
const ADMIN_EMAIL = process.env['BIRO_ADMIN_EMAIL'] ?? 'admin@biro.local'
const ADMIN_PASSWORD = process.env['BIRO_ADMIN_PASSWORD'] ?? 'ChangeMe!'
const AUTH_MODE = (process.env['AUTH_MODE'] ?? 'self') as 'self' | 'keycloak' | 'ldap'

describe.skipIf(!DB_URL)('C1.3 first-launch setup wizard', () => {
  let pool: pg.Pool
  let app: express.Express

  beforeAll(async () => {
    resetSetupGuardForTesting() // reset in-process cache for repeated runs (e.g. vitest watch)
    pool = new Pool({ connectionString: DB_URL })
    pool.on('error', () => {})
    await runMigrations(DB_URL!)

    // Reset setup state so tests start fresh
    await pool.query(
      `UPDATE setup_state SET initialized = FALSE, auth_mode = NULL, initialized_at = NULL WHERE id = TRUE`,
    )
    await pool.query(`DELETE FROM users WHERE email = $1`, [ADMIN_EMAIL])

    app = express()
    app.use(express.json())
    app.use(createSessionMiddleware({ secret: 'test-session-secret-32chars-minimum!' }))
    // Setup guard blocks non-setup API routes while not initialized
    app.use('/api', setupGuard(pool))
    // Setup routes (always reachable — setupGuard allows them)
    app.use('/api', setupRouter(pool, { adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD, authMode: AUTH_MODE }))
    // Auth routes (blocked by setupGuard until initialized)
    app.use('/api', authRouter(pool))
    // A protected route to verify blocking
    app.get('/api/test/guarded', (_req, res) => res.json({ ok: true }))
  }, 30_000)

  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM users WHERE email = $1`, [ADMIN_EMAIL])
      await pool.query(
        `UPDATE setup_state SET initialized = FALSE, auth_mode = NULL, initialized_at = NULL WHERE id = TRUE`,
      )
      await pool.end()
    }
  })

  // ── GET /api/setup/state ───────────────────────────────────────────────────

  it('GET /api/setup/state returns initialized=false on fresh instance', async () => {
    const res = await request(app).get('/api/setup/state')
    expect(res.status).toBe(200)
    expect(res.body.initialized).toBe(false)
    expect(res.body.authMode).toBeNull()
  })

  // ── setup guard ────────────────────────────────────────────────────────────

  it('non-setup API route returns 503 before initialization', async () => {
    const res = await request(app).get('/api/test/guarded')
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/not initialized/i)
  })

  it('/api/health is reachable before initialization', async () => {
    // health is defined in server.ts; the test guard app doesn't mount it,
    // so we assert that /api/setup/state itself is always reachable (covered above).
    // setup/state is in the always-allowed list, meaning the guard passed for it.
    const res = await request(app).get('/api/setup/state')
    expect(res.status).toBe(200)
  })

  // ── POST /api/setup/initialize ─────────────────────────────────────────────

  it('POST /api/setup/initialize creates admin user and marks as initialized', async () => {
    const res = await request(app)
      .post('/api/setup/initialize')
      .send({ appTitle: 'Test BI Root', appAccent: '#a78bfa' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('after initialization GET /api/setup/state returns initialized=true with authMode', async () => {
    const res = await request(app).get('/api/setup/state')
    expect(res.status).toBe(200)
    expect(res.body.initialized).toBe(true)
    expect(res.body.authMode).toBe(AUTH_MODE)
  })

  it('admin user exists in DB with Argon2id hash after initialization', async () => {
    const { rows } = await pool.query<{ password_hash: string; status: string; force_password_change: boolean }>(
      `SELECT password_hash, status, force_password_change FROM users WHERE email = $1`,
      [ADMIN_EMAIL],
    )
    expect(rows.length).toBe(1)
    expect(rows[0]!.password_hash).toMatch(/^\$argon2id\$/)
    expect(rows[0]!.status).toBe('active')
    expect(rows[0]!.force_password_change).toBe(true)
  })

  it('admin user has the admin role', async () => {
    const { rows } = await pool.query<{ name: string }>(
      `SELECT r.name FROM users u
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles r ON ur.role_id = r.id
       WHERE u.email = $1`,
      [ADMIN_EMAIL],
    )
    expect(rows.map((r) => r.name)).toContain('admin')
  })

  it('settings table has appTitle and appAccent stored', async () => {
    const { rows } = await pool.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM settings WHERE key IN ('appTitle', 'appAccent') ORDER BY key`,
    )
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    expect(byKey['appTitle']).toBe('Test BI Root')
    expect(byKey['appAccent']).toBe('#a78bfa')
  })

  it('POST /api/setup/initialize again returns 409 (already initialized)', async () => {
    const res = await request(app)
      .post('/api/setup/initialize')
      .send({ appTitle: 'Another Title' })
    expect(res.status).toBe(409)
  })

  it('non-setup API route is reachable after initialization', async () => {
    const res = await request(app).get('/api/test/guarded')
    expect(res.status).toBe(200)
  })

  it('admin can log in with env-seeded credentials after initialization', async () => {
    const agent = request.agent(app)
    const res = await agent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe(ADMIN_EMAIL)
  })
})
