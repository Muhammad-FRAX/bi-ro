import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import pg from 'pg'
import { hashPassword } from '../auth/self.ts'
import { runMigrations } from '../db/migrate.ts'
import { createSessionMiddleware } from '../middleware/session.ts'
import { authRouter } from '../routes/auth.ts'
import { adminRouter } from '../routes/admin.ts'
import { setupRouter } from '../routes/setup.ts'
import { setupGuard, resetSetupGuardForTesting } from '../middleware/setupGuard.ts'

const { Pool } = pg
const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('C1.4 admin users/roles', () => {
  let pool: pg.Pool
  let app: express.Express

  const ADMIN_EMAIL = 'admin-c14@biro.local'
  const ADMIN_PASS = 'AdminPass123!'
  const VIEWER_EMAIL = 'viewer-c14@biro.local'
  const VIEWER_PASS = 'ViewerPass456!'

  beforeAll(async () => {
    resetSetupGuardForTesting()
    pool = new Pool({ connectionString: DB_URL })
    pool.on('error', () => {})
    await runMigrations(DB_URL!)

    // Reset setup and users
    await pool.query(
      `UPDATE setup_state SET initialized = FALSE, auth_mode = NULL, initialized_at = NULL WHERE id = TRUE`,
    )
    await pool.query(`DELETE FROM users WHERE email IN ($1, $2)`, [ADMIN_EMAIL, VIEWER_EMAIL])

    // Build test app
    app = express()
    app.use(express.json())
    app.use(createSessionMiddleware({ secret: 'test-session-secret-32chars-minimum!' }))
    app.use('/api', setupGuard(pool))
    app.use('/api', setupRouter(pool, {
      adminEmail: ADMIN_EMAIL,
      adminPassword: ADMIN_PASS,
      authMode: 'self',
    }))
    app.use('/api', authRouter(pool))
    app.use('/api', adminRouter(pool))

    // Initialize the app (creates admin user)
    await request(app).post('/api/setup/initialize').send({ appTitle: 'Test', appAccent: '#a78bfa' })
  }, 30_000)

  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM users WHERE email IN ($1, $2)`, [ADMIN_EMAIL, VIEWER_EMAIL])
      await pool.query(
        `UPDATE setup_state SET initialized = FALSE, auth_mode = NULL, initialized_at = NULL WHERE id = TRUE`,
      )
      await pool.end()
    }
  })

  // ── GET /api/admin/roles ───────────────────────────────────────────────────

  it('GET /api/admin/roles returns all built-in roles with permissions (admin only)', async () => {
    const adminAgent = request.agent(app)
    await adminAgent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASS })

    const res = await adminAgent.get('/api/admin/roles')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.roles)).toBe(true)

    const names = res.body.roles.map((r: { name: string }) => r.name)
    expect(names).toContain('admin')
    expect(names).toContain('editor')
    expect(names).toContain('viewer_secrets')
    expect(names).toContain('viewer')

    const adminRole = res.body.roles.find((r: { name: string }) => r.name === 'admin')
    expect(Array.isArray(adminRole.permissions)).toBe(true)
    expect(adminRole.permissions).toContain('users.manage')
    expect(adminRole.permissions).toContain('audit.read')
  })

  it('GET /api/admin/roles returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/admin/roles')
    expect(res.status).toBe(401)
  })

  // ── GET /api/admin/users ───────────────────────────────────────────────────

  it('GET /api/admin/users returns list of users (admin only)', async () => {
    const adminAgent = request.agent(app)
    await adminAgent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASS })

    const res = await adminAgent.get('/api/admin/users')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.users)).toBe(true)

    const adminUser = res.body.users.find((u: { email: string }) => u.email === ADMIN_EMAIL)
    expect(adminUser).toBeDefined()
    expect(adminUser.passwordHash).toBeUndefined()
    expect(adminUser.roles).toContain('admin')
  })

  it('GET /api/admin/users returns 403 for non-admin', async () => {
    // Create a viewer user first
    const viewerHash = await hashPassword(VIEWER_PASS)
    const { rows: [vRow] } = await pool.query<{ id: string }>(
      `INSERT INTO users (auth_mode, email, display_name, password_hash, status)
       VALUES ('self', $1, 'Viewer C14', $2, 'active') RETURNING id`,
      [VIEWER_EMAIL, viewerHash],
    )
    const viewerRoleId = (await pool.query<{ id: string }>(`SELECT id FROM roles WHERE name = 'viewer'`)).rows[0]!.id
    await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [vRow!.id, viewerRoleId])

    const viewerAgent = request.agent(app)
    await viewerAgent.post('/api/auth/login').send({ email: VIEWER_EMAIL, password: VIEWER_PASS })

    const res = await viewerAgent.get('/api/admin/users')
    expect(res.status).toBe(403)
  })

  // ── POST /api/admin/users ──────────────────────────────────────────────────

  it('POST /api/admin/users creates a new user with a role assignment', async () => {
    const adminAgent = request.agent(app)
    await adminAgent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASS })

    const res = await adminAgent.post('/api/admin/users').send({
      email: 'newuser-c14@biro.local',
      displayName: 'New User C14',
      role: 'viewer',
      password: 'TempPassword123!',
    })
    expect(res.status).toBe(201)
    expect(res.body.user).toBeDefined()
    expect(res.body.user.email).toBe('newuser-c14@biro.local')
    expect(res.body.user.forcePasswordChange).toBe(true)

    // Verify in DB
    const { rows } = await pool.query(
      `SELECT u.id FROM users u WHERE u.email = 'newuser-c14@biro.local'`,
    )
    expect(rows.length).toBe(1)

    // Clean up
    await pool.query(`DELETE FROM users WHERE email = 'newuser-c14@biro.local'`)
  })

  it('POST /api/admin/users returns 400 for missing required fields', async () => {
    const adminAgent = request.agent(app)
    await adminAgent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASS })

    const res = await adminAgent.post('/api/admin/users').send({ email: 'bad@biro.local' })
    expect(res.status).toBe(400)
  })

  it('POST /api/admin/users returns 409 for duplicate email', async () => {
    const adminAgent = request.agent(app)
    await adminAgent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASS })

    const res = await adminAgent.post('/api/admin/users').send({
      email: ADMIN_EMAIL,
      displayName: 'Duplicate',
      role: 'viewer',
      password: 'TempPassword123!',
    })
    expect(res.status).toBe(409)
  })

  it('POST /api/admin/users returns 403 for non-admin', async () => {
    const viewerAgent = request.agent(app)
    await viewerAgent.post('/api/auth/login').send({ email: VIEWER_EMAIL, password: VIEWER_PASS })

    const res = await viewerAgent.post('/api/admin/users').send({
      email: 'another@biro.local',
      displayName: 'Another',
      role: 'viewer',
      password: 'TempPassword123!',
    })
    expect(res.status).toBe(403)
  })
})
