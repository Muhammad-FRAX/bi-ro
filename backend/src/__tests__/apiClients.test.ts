import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createPool } from '../db/pool.ts'
import { runMigrations } from '../db/migrate.ts'
import { createApp } from '../server.ts'
import { loadConfig } from '../config.ts'
import { hashApiKey, timingSafeHashCompare } from '../middleware/apiKey.ts'
import type { Pool } from 'pg'

const DB_URL = process.env['DATABASE_URL']

// ── Pure unit tests for timingSafeHashCompare (no DB needed) ─────────────────
describe('timingSafeHashCompare (unit)', () => {
  it('returns true for matching hex strings', () => {
    const hash = hashApiKey('my-test-key')
    expect(timingSafeHashCompare(hash, hash)).toBe(true)
  })

  it('returns false for mismatched hex strings', () => {
    const a = hashApiKey('key-one')
    const b = hashApiKey('key-two')
    expect(timingSafeHashCompare(a, b)).toBe(false)
  })

  it('returns false when strings have different lengths', () => {
    const hash = hashApiKey('some-key')
    expect(timingSafeHashCompare(hash, hash.slice(0, 10))).toBe(false)
  })
})

// ── Integration tests (DB-gated) ─────────────────────────────────────────────
describe.skipIf(!DB_URL)('API clients (C8.2)', () => {
  let pool: Pool
  let app: ReturnType<typeof createApp>
  let adminCookie: string
  let viewerCookie: string
  let createdClientId: string
  let rawApiKey: string

  const kek = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

  beforeAll(async () => {
    const cfg = loadConfig({
      AUTH_MODE: 'self',
      BIRO_MASTER_KEK: kek,
      DATABASE_URL: DB_URL!,
      SESSION_SECRET: 'apiclient-test-session-secret-32-chars-long',
      NODE_ENV: 'test',
      BIRO_ADMIN_EMAIL: 'apiclient-admin@test.local',
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
      .send({ email: 'apiclient-admin@test.local', password: 'Admin1234!' })
    adminCookie = adminLogin.headers['set-cookie']?.[0]?.split(';')[0] ?? ''

    // Create a viewer user
    await request(app)
      .post('/api/admin/users')
      .set('Cookie', adminCookie)
      .send({
        email: 'apiclient-viewer@test.local',
        displayName: 'API Viewer',
        role: 'viewer',
        password: 'Viewer1234!',
      })
      .catch(() => { /* already exists */ })

    const viewerLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'apiclient-viewer@test.local', password: 'Viewer1234!' })
    viewerCookie = viewerLogin.headers['set-cookie']?.[0]?.split(';')[0] ?? ''
  })

  afterAll(async () => {
    await pool.end()
  })

  it('POST /admin/api-clients creates client and returns raw key (shown once)', async () => {
    const res = await request(app)
      .post('/api/admin/api-clients')
      .set('Cookie', adminCookie)
      .send({ name: 'CI Pipeline', scopes: ['servers.read'] })
    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.key).toBeDefined()
    // key_hash must NOT be exposed
    expect(res.body.key_hash).toBeUndefined()
    expect(res.body.keyHash).toBeUndefined()
    createdClientId = res.body.id as string
    rawApiKey = res.body.key as string
  })

  it('GET /admin/api-clients lists clients without exposing key_hash', async () => {
    const res = await request(app)
      .get('/api/admin/api-clients')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.clients)).toBe(true)
    const client = res.body.clients.find((c: { id: string }) => c.id === createdClientId)
    expect(client).toBeDefined()
    expect(client.name).toBe('CI Pipeline')
    // key_hash must NOT be exposed
    expect(client.key_hash).toBeUndefined()
    expect(client.keyHash).toBeUndefined()
    // raw key must NOT be exposed in list
    expect(client.key).toBeUndefined()
  })

  it('API key authenticates correctly on GET /api/v1/servers', async () => {
    const res = await request(app)
      .get('/api/v1/servers')
      .set('X-API-Key', rawApiKey)
    expect(res.status).toBe(200)
    expect(res.body.servers).toBeDefined()
  })

  it('missing API key on GET /api/v1/servers returns 401', async () => {
    const res = await request(app).get('/api/v1/servers')
    expect(res.status).toBe(401)
  })

  it('invalid API key returns 401', async () => {
    const res = await request(app)
      .get('/api/v1/servers')
      .set('X-API-Key', 'invalid-key-that-does-not-exist')
    expect(res.status).toBe(401)
  })

  it('API key with wrong scope returns 403', async () => {
    // Create a key with a different scope
    const createRes = await request(app)
      .post('/api/admin/api-clients')
      .set('Cookie', adminCookie)
      .send({ name: 'Wrong Scope Key', scopes: ['other.scope'] })
    expect(createRes.status).toBe(201)
    const wrongScopeKey = createRes.body.key as string

    const res = await request(app)
      .get('/api/v1/servers')
      .set('X-API-Key', wrongScopeKey)
    expect(res.status).toBe(403)
  })

  it('DELETE /admin/api-clients/:id revokes client (revoked key returns 401)', async () => {
    const res = await request(app)
      .delete(`/api/admin/api-clients/${createdClientId}`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // Revoked key should now return 401
    const apiRes = await request(app)
      .get('/api/v1/servers')
      .set('X-API-Key', rawApiKey)
    expect(apiRes.status).toBe(401)
  })

  it('non-admin cannot create API clients (403)', async () => {
    const res = await request(app)
      .post('/api/admin/api-clients')
      .set('Cookie', viewerCookie)
      .send({ name: 'Unauthorized', scopes: ['servers.read'] })
    expect(res.status).toBe(403)
  })
})
