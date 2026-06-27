import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import pg from 'pg'
import { hashPassword } from '../auth/self.ts'
import { SelfAuthProvider } from '../auth/selfProvider.ts'
import { runMigrations } from '../db/migrate.ts'
import { createSessionMiddleware } from '../middleware/session.ts'
import { requireAuth, requirePermission } from '../middleware/rbac.ts'
import { authRouter } from '../routes/auth.ts'

const { Pool } = pg
const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('C1.2 self-auth + RBAC', () => {
  let pool: pg.Pool
  let testApp: express.Express
  let adminUserId: string
  let viewerUserId: string

  const ADMIN_EMAIL = 'admin-test@biro.local'
  const ADMIN_PASS = 'SuperSecret123!'
  const VIEWER_EMAIL = 'viewer-test@biro.local'
  const VIEWER_PASS = 'ViewOnly456!'

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL })
    pool.on('error', () => {})
    await runMigrations(DB_URL!)

    // Clean up any leftover test users from previous runs
    await pool.query(`DELETE FROM users WHERE email IN ($1, $2)`, [ADMIN_EMAIL, VIEWER_EMAIL])

    // Hash passwords and seed test users
    const adminHash = await hashPassword(ADMIN_PASS)
    const viewerHash = await hashPassword(VIEWER_PASS)

    const { rows: [adminRow] } = await pool.query<{ id: string }>(
      `INSERT INTO users (auth_mode, email, display_name, password_hash, status)
       VALUES ('self', $1, 'Test Admin', $2, 'active')
       RETURNING id`,
      [ADMIN_EMAIL, adminHash],
    )
    adminUserId = adminRow!.id

    const { rows: [viewerRow] } = await pool.query<{ id: string }>(
      `INSERT INTO users (auth_mode, email, display_name, password_hash, status)
       VALUES ('self', $1, 'Test Viewer', $2, 'active')
       RETURNING id`,
      [VIEWER_EMAIL, viewerHash],
    )
    viewerUserId = viewerRow!.id

    // Assign admin role to adminUser, viewer role to viewerUser
    const { rows: [adminRole] } = await pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'admin'`,
    )
    const { rows: [viewerRole] } = await pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'viewer'`,
    )
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2), ($3, $4)`,
      [adminUserId, adminRole!.id, viewerUserId, viewerRole!.id],
    )

    // Build test app
    testApp = express()
    testApp.use(express.json())
    testApp.use(createSessionMiddleware({ secret: 'test-session-secret-32chars-minimum!' }))
    testApp.use('/api', authRouter(pool, new SelfAuthProvider(pool)))

    // Test routes guarded by permission
    testApp.get(
      '/api/test/infra',
      requireAuth,
      requirePermission('infra.read'),
      (_req, res) => { res.json({ ok: true }) },
    )
    testApp.get(
      '/api/test/users-manage',
      requireAuth,
      requirePermission('users.manage'),
      (_req, res) => { res.json({ ok: true }) },
    )
  }, 30_000)

  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM users WHERE email IN ($1, $2)`, [ADMIN_EMAIL, VIEWER_EMAIL])
      await pool.end()
    }
  })

  // ── login ──────────────────────────────────────────────────────────────────

  it('POST /api/auth/login with correct credentials returns 200 and sets a session cookie', async () => {
    const res = await request(testApp)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASS })

    expect(res.status).toBe(200)
    expect(res.body.user).toBeDefined()
    expect(res.body.user.email).toBe(ADMIN_EMAIL)
    expect(res.headers['set-cookie']).toBeDefined()
    // session cookie must be httpOnly
    const cookieHeader = (res.headers['set-cookie'] as string[]).join('; ')
    expect(cookieHeader.toLowerCase()).toContain('httponly')
  })

  it('POST /api/auth/login with wrong password returns 401', async () => {
    const res = await request(testApp)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'wrong-password' })

    expect(res.status).toBe(401)
    // must NOT reveal whether email exists (enumeration prevention)
    expect(res.body.error).toBe('Invalid credentials')
  })

  it('POST /api/auth/login with unknown email returns 401 with same error (no enumeration)', async () => {
    const res = await request(testApp)
      .post('/api/auth/login')
      .send({ email: 'nobody@biro.local', password: 'whatever' })

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Invalid credentials')
  })

  it('POST /api/auth/login missing body fields returns 400', async () => {
    const res = await request(testApp)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL })

    expect(res.status).toBe(400)
  })

  // ── me ─────────────────────────────────────────────────────────────────────

  it('GET /api/auth/me without session returns 401', async () => {
    const res = await request(testApp).get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('GET /api/auth/me with active session returns the current user', async () => {
    const agent = request.agent(testApp)
    await agent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASS })
    const res = await agent.get('/api/auth/me')

    expect(res.status).toBe(200)
    expect(res.body.email).toBe(ADMIN_EMAIL)
    expect(res.body.displayName).toBe('Test Admin')
    expect(Array.isArray(res.body.permissions)).toBe(true)
    expect(res.body.permissions).toContain('users.manage')
    // must NOT expose password hash or session internals
    expect(res.body.passwordHash).toBeUndefined()
  })

  // ── logout ─────────────────────────────────────────────────────────────────

  it('POST /api/auth/logout destroys the session', async () => {
    const agent = request.agent(testApp)
    await agent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASS })

    const logoutRes = await agent.post('/api/auth/logout')
    expect(logoutRes.status).toBe(200)

    // subsequent /me must 401
    const meRes = await agent.get('/api/auth/me')
    expect(meRes.status).toBe(401)
  })

  // ── RBAC ──────────────────────────────────────────────────────────────────

  it('viewer can reach an infra.read route (200)', async () => {
    const agent = request.agent(testApp)
    await agent.post('/api/auth/login').send({ email: VIEWER_EMAIL, password: VIEWER_PASS })
    const res = await agent.get('/api/test/infra')
    expect(res.status).toBe(200)
  })

  it('viewer is denied a users.manage route (403)', async () => {
    const agent = request.agent(testApp)
    await agent.post('/api/auth/login').send({ email: VIEWER_EMAIL, password: VIEWER_PASS })
    const res = await agent.get('/api/test/users-manage')
    expect(res.status).toBe(403)
  })

  it('admin can reach a users.manage route (200)', async () => {
    const agent = request.agent(testApp)
    await agent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASS })
    const res = await agent.get('/api/test/users-manage')
    expect(res.status).toBe(200)
  })

  it('unauthenticated request to guarded route returns 401 not 403', async () => {
    const res = await request(testApp).get('/api/test/infra')
    expect(res.status).toBe(401)
  })

  // ── password storage ───────────────────────────────────────────────────────

  it('stored password_hash is an Argon2id hash, not the plaintext', async () => {
    const { rows } = await pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE email = $1`,
      [ADMIN_EMAIL],
    )
    const hash = rows[0]!.password_hash
    // Argon2id hashes start with $argon2id$
    expect(hash).toMatch(/^\$argon2id\$/)
    expect(hash).not.toContain(ADMIN_PASS)
  })
})
