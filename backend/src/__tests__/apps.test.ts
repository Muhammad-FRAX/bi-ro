import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import supertest from 'supertest'
import { runMigrations } from '../db/migrate.ts'
import { createApp } from '../server.ts'
import { loadConfig } from '../config.ts'

const { Pool } = pg

const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('C2.3 apps + ports API', () => {
  let pool: pg.Pool
  let request: ReturnType<typeof supertest>
  let adminCookie: string
  let serverId: string

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
      BIRO_ADMIN_EMAIL: 'admin2@test.local',
      BIRO_ADMIN_PASSWORD: 'AdminPass1!',
    })
    const app = createApp({
      pool,
      sessionSecret: cfg.sessionSecret,
      secureCookie: false,
      adminEmail: 'admin2@test.local',
      adminPassword: 'AdminPass1!',
      authMode: 'self',
    })
    request = supertest(app)

    await request.post('/api/setup/initialize').send({})
    const loginRes = await request.post('/api/auth/login').send({
      email: 'admin2@test.local', password: 'AdminPass1!',
    })
    adminCookie = loginRes.headers['set-cookie']?.[0] ?? ''

    // Create a server to test ports against
    const srvRes = await request
      .post('/api/servers')
      .set('Cookie', adminCookie)
      .send({ hostname: 'apps-test-srv', environment: 'dev' })
    serverId = srvRes.body.server.id as string
  }, 60_000)

  afterAll(async () => { await pool.end() })

  // ── Apps ──────────────────────────────────────────────────────────────────

  it('POST /api/apps creates an app', async () => {
    const res = await request
      .post('/api/apps')
      .set('Cookie', adminCookie)
      .send({ name: 'PostgreSQL', category: 'database', vendor: 'PostgreSQL', version: '16' })
    expect(res.status).toBe(201)
    expect(res.body.app.name).toBe('PostgreSQL')
  })

  it('GET /api/apps returns list', async () => {
    const res = await request.get('/api/apps').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.apps)).toBe(true)
    expect(res.body.apps.length).toBeGreaterThan(0)
  })

  it('GET /api/apps/:id returns app detail', async () => {
    const list = await request.get('/api/apps').set('Cookie', adminCookie)
    const id = (list.body.apps as Array<{ id: string }>)[0]!.id
    const res = await request.get(`/api/apps/${id}`).set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.app.id).toBe(id)
  })

  it('PATCH /api/apps/:id updates app', async () => {
    const list = await request.get('/api/apps').set('Cookie', adminCookie)
    const id = (list.body.apps as Array<{ id: string }>)[0]!.id
    const res = await request
      .patch(`/api/apps/${id}`)
      .set('Cookie', adminCookie)
      .send({ version: '16.1' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('POST /api/apps 400 on missing name', async () => {
    const res = await request.post('/api/apps').set('Cookie', adminCookie).send({ category: 'db' })
    expect(res.status).toBe(400)
  })

  it('POST /api/apps 401 without auth', async () => {
    const res = await request.post('/api/apps').send({ name: 'nope' })
    expect(res.status).toBe(401)
  })

  // ── App instances ──────────────────────────────────────────────────────────

  it('POST /api/app-instances creates an instance binding', async () => {
    const appList = await request.get('/api/apps').set('Cookie', adminCookie)
    const appId = (appList.body.apps as Array<{ id: string }>)[0]!.id

    const res = await request
      .post('/api/app-instances')
      .set('Cookie', adminCookie)
      .send({ serverId, appId, version: '16.0', notes: 'Primary DB' })
    expect(res.status).toBe(201)
    expect(res.body.instance.serverId).toBe(serverId)
    expect(res.body.instance.appId).toBe(appId)
  })

  it('GET /api/servers/:id/app-instances returns instances', async () => {
    const res = await request
      .get(`/api/servers/${serverId}/app-instances`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.instances)).toBe(true)
    expect(res.body.instances.length).toBeGreaterThan(0)
  })

  // ── Ports ──────────────────────────────────────────────────────────────────

  it('POST /api/servers/:id/ports creates a port', async () => {
    const res = await request
      .post(`/api/servers/${serverId}/ports`)
      .set('Cookie', adminCookie)
      .send({ number: 5432, protocol: 'tcp', appLabel: 'PostgreSQL', exposure: 'internal', description: 'PG main' })
    expect(res.status).toBe(201)
    expect(res.body.port.number).toBe(5432)
  })

  it('GET /api/servers/:id/ports returns port list', async () => {
    const res = await request
      .get(`/api/servers/${serverId}/ports`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.ports)).toBe(true)
    expect(res.body.ports.some((p: { number: number }) => p.number === 5432)).toBe(true)
  })

  it('POST /api/servers/:id/ports 409 on duplicate (server, number, protocol)', async () => {
    const res = await request
      .post(`/api/servers/${serverId}/ports`)
      .set('Cookie', adminCookie)
      .send({ number: 5432, protocol: 'tcp', appLabel: 'Dup', exposure: 'internal' })
    expect(res.status).toBe(409)
  })

  it('PATCH /api/ports/:id updates a port', async () => {
    const list = await request.get(`/api/servers/${serverId}/ports`).set('Cookie', adminCookie)
    const portId = (list.body.ports as Array<{ id: string }>)[0]!.id
    const res = await request
      .patch(`/api/ports/${portId}`)
      .set('Cookie', adminCookie)
      .send({ description: 'Updated' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('DELETE /api/ports/:id deletes a port', async () => {
    // Create a throwaway port
    const createRes = await request
      .post(`/api/servers/${serverId}/ports`)
      .set('Cookie', adminCookie)
      .send({ number: 9999, protocol: 'tcp', exposure: 'localhost' })
    const portId = createRes.body.port.id as string
    const delRes = await request.delete(`/api/ports/${portId}`).set('Cookie', adminCookie)
    expect(delRes.status).toBe(200)
  })

  it('POST /api/servers/:id/ports 400 on bad exposure', async () => {
    const res = await request
      .post(`/api/servers/${serverId}/ports`)
      .set('Cookie', adminCookie)
      .send({ number: 1234, protocol: 'tcp', exposure: 'invalid' })
    expect(res.status).toBe(400)
  })
})
