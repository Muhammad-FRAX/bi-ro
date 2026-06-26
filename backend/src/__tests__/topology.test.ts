import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import supertest from 'supertest'
import { runMigrations } from '../db/migrate.ts'
import { createApp } from '../server.ts'
import { loadConfig } from '../config.ts'

const { Pool } = pg

const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('C3.1 topology API', () => {
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
      BIRO_ADMIN_EMAIL: 'admin-topo@test.local',
      BIRO_ADMIN_PASSWORD: 'AdminPass1!',
    })
    const app = createApp({
      pool,
      sessionSecret: cfg.sessionSecret,
      secureCookie: false,
      adminEmail: 'admin-topo@test.local',
      adminPassword: 'AdminPass1!',
      authMode: 'self',
    })
    request = supertest(app)

    await request.post('/api/setup/initialize').send({})
    const loginRes = await request.post('/api/auth/login').send({
      email: 'admin-topo@test.local', password: 'AdminPass1!',
    })
    adminCookie = loginRes.headers['set-cookie']?.[0] ?? ''

    // Create a server for per-server topology tests
    const srvRes = await request.post('/api/servers').set('Cookie', adminCookie)
      .send({ hostname: 'topo-srv-a', environment: 'prod' })
    serverId = srvRes.body.server.id as string

    // Create an app and instance on that server
    const appRes = await request.post('/api/apps').set('Cookie', adminCookie)
      .send({ name: 'topo-app', category: 'automation' })
    const appId = appRes.body.app.id as string

    const instRes = await request.post('/api/app-instances').set('Cookie', adminCookie)
      .send({ serverId, appId })
    const instanceId = instRes.body.instance.id as string

    // Create a second server + instance to create a connection
    const srvBRes = await request.post('/api/servers').set('Cookie', adminCookie)
      .send({ hostname: 'topo-srv-b', environment: 'staging' })
    const serverBId = srvBRes.body.server.id as string

    const instBRes = await request.post('/api/app-instances').set('Cookie', adminCookie)
      .send({ serverId: serverBId, appId })
    const instanceBId = instBRes.body.instance.id as string

    // Create a connection between the two instances
    await request.post('/api/connections').set('Cookie', adminCookie)
      .send({
        fromAppInstanceId: instanceId,
        toAppInstanceId: instanceBId,
        label: 'sends data to',
        protocol: 'HTTPS',
      })
  }, 60_000)

  afterAll(async () => { await pool.end() })

  it('GET /api/topology returns 200 with nodes and edges when authenticated', async () => {
    const res = await request.get('/api/topology').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.nodes)).toBe(true)
    expect(Array.isArray(res.body.edges)).toBe(true)
    // Should have at least the server node, instance nodes, and an edge
    expect(res.body.nodes.length).toBeGreaterThan(0)
    // Server nodes should have type 'server'
    const serverNodes = res.body.nodes.filter((n: { type: string }) => n.type === 'server')
    expect(serverNodes.length).toBeGreaterThan(0)
    // Instance nodes should have type 'app_instance'
    const instanceNodes = res.body.nodes.filter((n: { type: string }) => n.type === 'app_instance')
    expect(instanceNodes.length).toBeGreaterThan(0)
    // Edge should reference instance nodes
    expect(res.body.edges.length).toBeGreaterThan(0)
    const edge = res.body.edges[0] as { id: string; source: string; target: string }
    expect(edge.id).toMatch(/^conn-/)
    expect(edge.source).toMatch(/^instance-/)
    expect(edge.target).toMatch(/^instance-/)
  })

  it('GET /api/topology returns 401 without auth', async () => {
    const res = await request.get('/api/topology')
    expect(res.status).toBe(401)
  })

  it('GET /api/servers/:id/topology returns 200 with nodes and edges for existing server', async () => {
    const res = await request
      .get(`/api/servers/${serverId}/topology`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.nodes)).toBe(true)
    expect(Array.isArray(res.body.edges)).toBe(true)
    // The requested server itself should be in nodes
    const serverNode = res.body.nodes.find(
      (n: { id: string; type: string }) => n.id === `server-${serverId}` && n.type === 'server',
    )
    expect(serverNode).toBeTruthy()
  })

  it('GET /api/servers/:id/topology returns 404 for unknown server id', async () => {
    const res = await request
      .get('/api/servers/00000000-0000-0000-0000-000000000000/topology')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(404)
  })
})
