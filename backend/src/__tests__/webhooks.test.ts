import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createPool } from '../db/pool.ts'
import { runMigrations } from '../db/migrate.ts'
import { createApp } from '../server.ts'
import { loadConfig } from '../config.ts'
import type { Pool } from 'pg'

const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('webhooks + GET /api/v1/servers (C8.3)', () => {
  let pool: Pool
  let app: ReturnType<typeof createApp>
  let adminCookie: string
  let viewerCookie: string
  let serversReadKey: string

  const kek = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

  beforeAll(async () => {
    const cfg = loadConfig({
      AUTH_MODE: 'self',
      BIRO_MASTER_KEK: kek,
      DATABASE_URL: DB_URL!,
      SESSION_SECRET: 'webhook-test-session-secret-32-chars-long',
      NODE_ENV: 'test',
      BIRO_ADMIN_EMAIL: 'webhook-admin@test.local',
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

    // Initialize app (idempotent)
    await request(app)
      .post('/api/setup/initialize')
      .send({ title: 'Test', accent: '#a78bfa' })
      .catch(() => { /* already initialized */ })

    // Login as admin
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'webhook-admin@test.local', password: 'Admin1234!' })
    adminCookie = adminLogin.headers['set-cookie']?.[0]?.split(';')[0] ?? ''

    // Create a viewer user for RBAC tests
    await request(app)
      .post('/api/admin/users')
      .set('Cookie', adminCookie)
      .send({
        email: 'webhook-viewer@test.local',
        displayName: 'Webhook Viewer',
        role: 'viewer',
        password: 'Viewer1234!',
      })
      .catch(() => { /* already exists */ })

    const viewerLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'webhook-viewer@test.local', password: 'Viewer1234!' })
    viewerCookie = viewerLogin.headers['set-cookie']?.[0]?.split(';')[0] ?? ''

    // Create a server for listing tests
    await request(app)
      .post('/api/servers')
      .set('Cookie', adminCookie)
      .send({ hostname: 'wh-test-server.local', environment: 'dev' })
      .catch(() => { /* already exists */ })

    // Create an API client with servers.read scope
    const clientRes = await request(app)
      .post('/api/admin/api-clients')
      .set('Cookie', adminCookie)
      .send({ name: 'Webhook Test Client', scopes: ['servers.read'] })
    serversReadKey = clientRes.body.key as string
  })

  afterAll(async () => {
    await pool.end()
  })

  // ── GET /api/v1/servers ─────────────────────────────────────────────────────

  it('GET /api/v1/servers with valid API key returns 200 list', async () => {
    const res = await request(app)
      .get('/api/v1/servers')
      .set('X-API-Key', serversReadKey)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.servers)).toBe(true)
  })

  it('GET /api/v1/servers?tag=nonexistent returns empty list', async () => {
    const res = await request(app)
      .get('/api/v1/servers?tag=nonexistent-tag-xyz')
      .set('X-API-Key', serversReadKey)
    expect(res.status).toBe(200)
    expect(res.body.servers).toHaveLength(0)
  })

  it('GET /api/v1/servers with no API key returns 401', async () => {
    const res = await request(app).get('/api/v1/servers')
    expect(res.status).toBe(401)
  })

  it('GET /api/v1/servers response never contains crypto or secret fields', async () => {
    const res = await request(app)
      .get('/api/v1/servers')
      .set('X-API-Key', serversReadKey)
    expect(res.status).toBe(200)
    const responseText = JSON.stringify(res.body)
    // None of these field names should appear in any server object
    expect(responseText).not.toContain('"ciphertext"')
    expect(responseText).not.toContain('"iv"')
    expect(responseText).not.toContain('"auth_tag"')
    expect(responseText).not.toContain('"wrapped_dek"')
    expect(responseText).not.toContain('"key_hash"')
    expect(responseText).not.toContain('"password_hash"')
    expect(responseText).not.toContain('"secret"')
  })

  // ── Webhook admin routes ────────────────────────────────────────────────────

  it('POST /admin/webhook-endpoints creates endpoint (admin only)', async () => {
    const res = await request(app)
      .post('/api/admin/webhook-endpoints')
      .set('Cookie', adminCookie)
      .send({
        name: 'Test Webhook',
        url: 'https://example.com/hooks/biro',
        secret: 'my-webhook-secret',
        events: ['secret.expiring'],
      })
    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.name).toBe('Test Webhook')
    // secret must NOT be echoed back
    expect(res.body.secret).toBeUndefined()
  })

  it('GET /admin/webhook-endpoints lists endpoints (admin only)', async () => {
    const res = await request(app)
      .get('/api/admin/webhook-endpoints')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.endpoints)).toBe(true)
    expect(res.body.endpoints.length).toBeGreaterThanOrEqual(1)
    const ep = res.body.endpoints[0] as { secret?: string }
    // secret must NOT be exposed in list
    expect(ep.secret).toBeUndefined()
  })

  it('non-admin blocked on POST /admin/webhook-endpoints (403)', async () => {
    const res = await request(app)
      .post('/api/admin/webhook-endpoints')
      .set('Cookie', viewerCookie)
      .send({ name: 'Bad', url: 'https://evil.com', secret: 'x', events: [] })
    expect(res.status).toBe(403)
  })

  it('non-admin blocked on GET /admin/webhook-endpoints (403)', async () => {
    const res = await request(app)
      .get('/api/admin/webhook-endpoints')
      .set('Cookie', viewerCookie)
    expect(res.status).toBe(403)
  })

  it('unauthenticated request to webhook admin returns 401', async () => {
    const res = await request(app).get('/api/admin/webhook-endpoints')
    expect(res.status).toBe(401)
  })
})
