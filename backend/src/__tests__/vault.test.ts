import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createPool } from '../db/pool.ts'
import { runMigrations } from '../db/migrate.ts'
import { createApp } from '../server.ts'
import { loadConfig } from '../config.ts'
import type { Pool } from 'pg'

const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('vault API (C4.2)', () => {
  let pool: Pool
  let app: ReturnType<typeof createApp>
  let adminCookie: string
  let viewerCookie: string
  let vaultId: string
  let secretId: string

  const kek = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' // 32 zero-bytes in base64

  beforeAll(async () => {
    const cfg = loadConfig({
      AUTH_MODE: 'self',
      BIRO_MASTER_KEK: kek,
      DATABASE_URL: DB_URL!,
      SESSION_SECRET: 'test-session-secret-32-chars-long-enough',
      NODE_ENV: 'test',
      BIRO_ADMIN_EMAIL: 'vault-admin@test.local',
      BIRO_ADMIN_PASSWORD: 'Admin1234!',
    })
    pool = createPool(cfg.databaseUrl)
    await runMigrations(cfg.databaseUrl)

    app = createApp({
      pool,
      sessionSecret: cfg.sessionSecret,
      adminEmail: cfg.adminEmail,
      adminPassword: cfg.adminPassword,
      authMode: cfg.authMode,
    })

    // Initialize the app (or skip if already done)
    await request(app)
      .post('/api/setup/initialize')
      .send({ title: 'Test', accent: '#a78bfa' })
      .catch(() => {/* already initialized */})

    // Login as admin
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'vault-admin@test.local', password: 'Admin1234!' })
    adminCookie = adminLogin.headers['set-cookie']?.[0]?.split(';')[0] ?? ''

    // Create a viewer user
    await request(app)
      .post('/api/admin/users')
      .set('Cookie', adminCookie)
      .send({
        email: 'vault-viewer@test.local',
        displayName: 'Vault Viewer',
        role: 'viewer',
        tempPassword: 'Viewer1234!',
      })
      .catch(() => {/* already exists */})

    const viewerLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'vault-viewer@test.local', password: 'Viewer1234!' })
    viewerCookie = viewerLogin.headers['set-cookie']?.[0]?.split(';')[0] ?? ''
  })

  afterAll(async () => {
    await pool.end()
  })

  it('admin can create a vault', async () => {
    const res = await request(app)
      .post('/api/vaults')
      .set('Cookie', adminCookie)
      .send({ name: 'Test Vault', type: 'team' })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Test Vault')
    vaultId = res.body.id as string
    expect(vaultId).toBeDefined()
  })

  it('admin can create a secret (value never returned)', async () => {
    const res = await request(app)
      .post('/api/secrets')
      .set('Cookie', adminCookie)
      .send({
        vaultId,
        type: 'server_login',
        title: 'DB Password',
        username: 'postgres',
        value: 'super-secret-value-123',
      })
    expect(res.status).toBe(201)
    expect(res.body.title).toBe('DB Password')
    expect(res.body.ciphertext).toBeUndefined()
    expect(res.body.iv).toBeUndefined()
    expect(res.body.auth_tag).toBeUndefined()
    expect(res.body.wrapped_dek).toBeUndefined()
    secretId = res.body.id as string
    expect(secretId).toBeDefined()
  })

  it('GET /secrets/:id returns metadata only — no crypto fields', async () => {
    const res = await request(app)
      .get(`/api/secrets/${secretId}`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('DB Password')
    expect(res.body.ciphertext).toBeUndefined()
    expect(res.body.iv).toBeUndefined()
    expect(res.body.auth_tag).toBeUndefined()
    expect(res.body.wrapped_dek).toBeUndefined()
    // value field must NOT be present
    expect(res.body.value).toBeUndefined()
  })

  it('GET /vaults/:id/secrets returns metadata only', async () => {
    const res = await request(app)
      .get(`/api/vaults/${vaultId}/secrets`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    const s = res.body.find((x: { id: string }) => x.id === secretId)
    expect(s).toBeDefined()
    expect(s.ciphertext).toBeUndefined()
    expect(s.value).toBeUndefined()
  })

  it('viewer without vault membership gets 403 on GET /secrets/:id (IDOR check)', async () => {
    const res = await request(app)
      .get(`/api/secrets/${secretId}`)
      .set('Cookie', viewerCookie)
    expect(res.status).toBe(403)
  })

  it('unauthenticated request gets 401', async () => {
    const res = await request(app).get(`/api/secrets/${secretId}`)
    expect(res.status).toBe(401)
  })

  it('non-member cannot list vault secrets', async () => {
    const res = await request(app)
      .get(`/api/vaults/${vaultId}/secrets`)
      .set('Cookie', viewerCookie)
    expect(res.status).toBe(403)
  })

  it('missing title returns 400', async () => {
    const res = await request(app)
      .post('/api/secrets')
      .set('Cookie', adminCookie)
      .send({ vaultId, value: 'x' })
    expect(res.status).toBe(400)
  })

  it('missing value returns 400', async () => {
    const res = await request(app)
      .post('/api/secrets')
      .set('Cookie', adminCookie)
      .send({ vaultId, title: 'No Value' })
    expect(res.status).toBe(400)
  })
})
