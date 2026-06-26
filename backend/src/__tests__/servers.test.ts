import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import supertest from 'supertest'
import { runMigrations } from '../db/migrate.ts'
import { createApp } from '../server.ts'
import { loadConfig } from '../config.ts'

const { Pool } = pg

const DB_URL = process.env['DATABASE_URL']

// Shared setup for DB-dependent API tests
describe.skipIf(!DB_URL)('C2.2 servers + tags API', () => {
  let pool: pg.Pool
  let request: ReturnType<typeof supertest>
  let adminCookie: string
  let viewerCookie: string

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL })
    pool.on('error', () => {})
    await runMigrations(DB_URL!)

    const cfg = loadConfig({
      ...process.env,
      AUTH_MODE: 'self',
      BIRO_MASTER_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      DATABASE_URL: DB_URL,
      SESSION_SECRET: 'test-secret-32-chars-or-more!!!',
      BIRO_ADMIN_EMAIL: 'admin@test.local',
      BIRO_ADMIN_PASSWORD: 'AdminPass1!',
    })

    const app = createApp({
      pool,
      sessionSecret: cfg.sessionSecret,
      secureCookie: false,
      adminEmail: cfg.adminEmail,
      adminPassword: cfg.adminPassword,
      authMode: 'self',
    })
    request = supertest(app)

    // Initialize app
    await request.post('/api/setup/initialize').send({})

    // Login as admin
    const adminLogin = await request.post('/api/auth/login').send({
      email: 'admin@test.local',
      password: 'AdminPass1!',
    })
    adminCookie = adminLogin.headers['set-cookie']?.[0] ?? ''

    // Create viewer user and login
    await request
      .post('/api/admin/users')
      .set('Cookie', adminCookie)
      .send({ email: 'viewer@test.local', displayName: 'Viewer', role: 'viewer', password: 'ViewerPass1!' })

    const viewerLogin = await request.post('/api/auth/login').send({
      email: 'viewer@test.local',
      password: 'ViewerPass1!',
    })
    viewerCookie = viewerLogin.headers['set-cookie']?.[0] ?? ''
  }, 60_000)

  afterAll(async () => {
    await pool.end()
  })

  // ── Tags ──────────────────────────────────────────────────────────────────

  it('POST /api/tags creates a tag (admin)', async () => {
    const res = await request
      .post('/api/tags')
      .set('Cookie', adminCookie)
      .send({ name: 'etl', color: '#f87171' })
    expect(res.status).toBe(201)
    expect(res.body.tag.name).toBe('etl')
    expect(res.body.tag.color).toBe('#f87171')
  })

  it('GET /api/tags returns tag list', async () => {
    const res = await request.get('/api/tags').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.tags)).toBe(true)
  })

  it('POST /api/tags 409 on duplicate name', async () => {
    const res = await request
      .post('/api/tags')
      .set('Cookie', adminCookie)
      .send({ name: 'etl', color: '#fff' })
    expect(res.status).toBe(409)
  })

  it('POST /api/tags 401 without auth', async () => {
    const res = await request.post('/api/tags').send({ name: 'nope', color: '#fff' })
    expect(res.status).toBe(401)
  })

  // ── Servers ────────────────────────────────────────────────────────────────

  it('POST /api/servers creates a server (admin)', async () => {
    const res = await request
      .post('/api/servers')
      .set('Cookie', adminCookie)
      .send({
        hostname: 'etl-01',
        environment: 'prod',
        os: 'Ubuntu 22.04',
        location: 'DC1',
        notes: 'Primary ETL server',
        ips: ['10.0.0.1'],
        aliases: ['etl01.internal'],
      })
    expect(res.status).toBe(201)
    expect(res.body.server.hostname).toBe('etl-01')
    expect(res.body.server.environment).toBe('prod')
  })

  it('GET /api/servers returns list', async () => {
    const res = await request.get('/api/servers').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.servers)).toBe(true)
    expect(res.body.servers.length).toBeGreaterThan(0)
  })

  it('GET /api/servers filters by environment', async () => {
    const res = await request.get('/api/servers?environment=prod').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    for (const s of res.body.servers as Array<{ environment: string }>) {
      expect(s.environment).toBe('prod')
    }
  })

  it('GET /api/servers filters by status', async () => {
    await request
      .post('/api/servers')
      .set('Cookie', adminCookie)
      .send({ hostname: 'old-01', environment: 'dev', status: 'decommissioned' })

    const res = await request.get('/api/servers?status=decommissioned').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.servers.some((s: { hostname: string }) => s.hostname === 'old-01')).toBe(true)
  })

  it('GET /api/servers/:id returns server detail', async () => {
    const list = await request.get('/api/servers').set('Cookie', adminCookie)
    const id = (list.body.servers as Array<{ id: string }>)[0]!.id
    const res = await request.get(`/api/servers/${id}`).set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.server.id).toBe(id)
    expect(Array.isArray(res.body.server.tags)).toBe(true)
  })

  it('PATCH /api/servers/:id updates server', async () => {
    const list = await request.get('/api/servers').set('Cookie', adminCookie)
    const id = (list.body.servers as Array<{ id: string }>)[0]!.id
    const res = await request
      .patch(`/api/servers/${id}`)
      .set('Cookie', adminCookie)
      .send({ notes: 'Updated notes', status: 'maintenance' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('viewer can GET /api/servers (infra.read)', async () => {
    const res = await request.get('/api/servers').set('Cookie', viewerCookie)
    expect(res.status).toBe(200)
  })

  it('viewer cannot POST /api/servers (no servers.write)', async () => {
    const res = await request
      .post('/api/servers')
      .set('Cookie', viewerCookie)
      .send({ hostname: 'blocked', environment: 'dev' })
    expect(res.status).toBe(403)
  })

  it('POST /api/servers 400 on missing hostname', async () => {
    const res = await request
      .post('/api/servers')
      .set('Cookie', adminCookie)
      .send({ environment: 'dev' })
    expect(res.status).toBe(400)
  })

  it('POST /api/servers 400 on invalid environment', async () => {
    const res = await request
      .post('/api/servers')
      .set('Cookie', adminCookie)
      .send({ hostname: 'bad', environment: 'invalid' })
    expect(res.status).toBe(400)
  })

  it('DELETE /api/servers/:id soft-deletes (sets deleted_at)', async () => {
    const createRes = await request
      .post('/api/servers')
      .set('Cookie', adminCookie)
      .send({ hostname: 'to-delete', environment: 'dev' })
    const id = createRes.body.server.id as string
    const delRes = await request.delete(`/api/servers/${id}`).set('Cookie', adminCookie)
    expect(delRes.status).toBe(200)
    // Verify it doesn't appear in list
    const listRes = await request.get('/api/servers').set('Cookie', adminCookie)
    expect(listRes.body.servers.some((s: { id: string }) => s.id === id)).toBe(false)
  })

  // ── Server tags ────────────────────────────────────────────────────────────

  it('POST /api/servers/:id/tags adds a tag', async () => {
    const srvRes = await request
      .post('/api/servers')
      .set('Cookie', adminCookie)
      .send({ hostname: 'tagged-srv', environment: 'dev' })
    const srvId = srvRes.body.server.id as string

    const tagRes = await request
      .post('/api/tags')
      .set('Cookie', adminCookie)
      .send({ name: 'reporting', color: '#34d399' })
    const tagId = tagRes.body.tag.id as string

    const addRes = await request
      .post(`/api/servers/${srvId}/tags`)
      .set('Cookie', adminCookie)
      .send({ tagId })
    expect(addRes.status).toBe(200)

    // Verify tag appears in detail
    const detail = await request.get(`/api/servers/${srvId}`).set('Cookie', adminCookie)
    expect(detail.body.server.tags.some((t: { id: string }) => t.id === tagId)).toBe(true)
  })

  it('DELETE /api/servers/:id/tags/:tagId removes tag', async () => {
    const list = await request.get('/api/servers?hostname=tagged-srv').set('Cookie', adminCookie)
    const srvId = (list.body.servers as Array<{ id: string }>)[0]?.id
    if (!srvId) return // idempotent if not found

    const detail = await request.get(`/api/servers/${srvId}`).set('Cookie', adminCookie)
    const tagId = (detail.body.server.tags as Array<{ id: string }>)[0]?.id
    if (!tagId) return

    const res = await request
      .delete(`/api/servers/${srvId}/tags/${tagId}`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
  })
})
