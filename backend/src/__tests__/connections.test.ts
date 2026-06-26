import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import supertest from 'supertest'
import { runMigrations } from '../db/migrate.ts'
import { createApp } from '../server.ts'
import { loadConfig } from '../config.ts'

const { Pool } = pg

const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('C2.4 connections API', () => {
  let pool: pg.Pool
  let request: ReturnType<typeof supertest>
  let adminCookie: string
  let instanceA: string
  let instanceB: string

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
      BIRO_ADMIN_EMAIL: 'admin3@test.local',
      BIRO_ADMIN_PASSWORD: 'AdminPass1!',
    })
    const app = createApp({
      pool,
      sessionSecret: cfg.sessionSecret,
      secureCookie: false,
      adminEmail: 'admin3@test.local',
      adminPassword: 'AdminPass1!',
      authMode: 'self',
    })
    request = supertest(app)

    await request.post('/api/setup/initialize').send({})
    const loginRes = await request.post('/api/auth/login').send({
      email: 'admin3@test.local', password: 'AdminPass1!',
    })
    adminCookie = loginRes.headers['set-cookie']?.[0] ?? ''

    // Create two servers
    const srvA = await request.post('/api/servers').set('Cookie', adminCookie)
      .send({ hostname: 'conn-srv-a', environment: 'prod' })
    const srvB = await request.post('/api/servers').set('Cookie', adminCookie)
      .send({ hostname: 'conn-srv-b', environment: 'prod' })

    // Create an app
    const appRes = await request.post('/api/apps').set('Cookie', adminCookie)
      .send({ name: 'n8n', category: 'automation' })
    const appId = appRes.body.app.id as string

    // Create two app instances (on different servers)
    const instA = await request.post('/api/app-instances').set('Cookie', adminCookie)
      .send({ serverId: srvA.body.server.id, appId })
    const instB = await request.post('/api/app-instances').set('Cookie', adminCookie)
      .send({ serverId: srvB.body.server.id, appId })

    instanceA = instA.body.instance.id as string
    instanceB = instB.body.instance.id as string
  }, 60_000)

  afterAll(async () => { await pool.end() })

  it('POST /api/connections creates a connection between app instances', async () => {
    const res = await request
      .post('/api/connections')
      .set('Cookie', adminCookie)
      .send({
        fromAppInstanceId: instanceA,
        toAppInstanceId: instanceB,
        label: 'reads from',
        protocol: 'HTTPS',
        notes: 'Nightly ETL',
      })
    expect(res.status).toBe(201)
    expect(res.body.connection.id).toBeTruthy()
  })

  it('GET /api/connections returns list', async () => {
    const res = await request.get('/api/connections').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.connections)).toBe(true)
    expect(res.body.connections.length).toBeGreaterThan(0)
  })

  it('GET /api/connections appears under both app-instance endpoints', async () => {
    const fromRes = await request
      .get(`/api/app-instances/${instanceA}/connections`)
      .set('Cookie', adminCookie)
    expect(fromRes.status).toBe(200)
    expect(fromRes.body.connections.some(
      (c: { fromAppInstanceId: string }) => c.fromAppInstanceId === instanceA,
    )).toBe(true)

    const toRes = await request
      .get(`/api/app-instances/${instanceB}/connections`)
      .set('Cookie', adminCookie)
    expect(toRes.status).toBe(200)
    expect(toRes.body.connections.some(
      (c: { toAppInstanceId: string }) => c.toAppInstanceId === instanceB,
    )).toBe(true)
  })

  it('PATCH /api/connections/:id updates a connection', async () => {
    const list = await request.get('/api/connections').set('Cookie', adminCookie)
    const id = (list.body.connections as Array<{ id: string }>)[0]!.id
    const res = await request
      .patch(`/api/connections/${id}`)
      .set('Cookie', adminCookie)
      .send({ label: 'writes to', notes: 'Updated' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('DELETE /api/connections/:id deletes a connection', async () => {
    // Create a throwaway connection
    const createRes = await request
      .post('/api/connections')
      .set('Cookie', adminCookie)
      .send({ fromAppInstanceId: instanceB, toAppInstanceId: instanceA, label: 'temp' })
    const id = createRes.body.connection.id as string
    const delRes = await request.delete(`/api/connections/${id}`).set('Cookie', adminCookie)
    expect(delRes.status).toBe(200)
  })

  it('POST /api/connections 400 missing fromAppInstanceId', async () => {
    const res = await request
      .post('/api/connections')
      .set('Cookie', adminCookie)
      .send({ toAppInstanceId: instanceB })
    expect(res.status).toBe(400)
  })

  it('POST /api/connections 401 without auth', async () => {
    const res = await request
      .post('/api/connections')
      .send({ fromAppInstanceId: instanceA, toAppInstanceId: instanceB })
    expect(res.status).toBe(401)
  })
})
