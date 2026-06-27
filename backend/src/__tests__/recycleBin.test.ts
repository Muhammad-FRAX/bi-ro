import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import supertest from 'supertest'
import { runMigrations } from '../db/migrate.ts'
import { createApp } from '../server.ts'
import { loadConfig } from '../config.ts'

const { Pool } = pg

const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('C9.2 recycle bin API', () => {
  let pool: pg.Pool
  let request: ReturnType<typeof supertest>
  let adminCookie: string

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
      BIRO_ADMIN_EMAIL: 'recycle-admin@test.local',
      BIRO_ADMIN_PASSWORD: 'Admin1234!',
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
      email: 'recycle-admin@test.local',
      password: 'Admin1234!',
    })
    adminCookie = adminLogin.headers['set-cookie']?.[0] ?? ''
  }, 60_000)

  afterAll(async () => {
    await pool.end()
  })

  // ── Auth guard ─────────────────────────────────────────────────────────────

  it('GET /api/recycle-bin?type=servers without auth → 401', async () => {
    const res = await request.get('/api/recycle-bin?type=servers')
    expect(res.status).toBe(401)
  })

  // ── Validation ─────────────────────────────────────────────────────────────

  it('GET /api/recycle-bin?type=invalid → 400', async () => {
    const res = await request
      .get('/api/recycle-bin?type=invalid')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(400)
  })

  it('GET /api/recycle-bin without type → 400', async () => {
    const res = await request
      .get('/api/recycle-bin')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(400)
  })

  // ── Servers recycle bin ────────────────────────────────────────────────────

  it('soft-deleted server appears in recycle bin and can be restored', async () => {
    // Create a server
    const createRes = await request
      .post('/api/servers')
      .set('Cookie', adminCookie)
      .send({
        hostname: 'recycle-test-01',
        environment: 'dev',
        os: 'Ubuntu 22.04',
        location: 'DC1',
        notes: 'Server for recycle bin test',
        ips: ['10.0.1.99'],
        aliases: [],
      })
    expect(createRes.status).toBe(201)
    const serverId: string = createRes.body.server.id

    // Soft-delete directly in DB
    await pool.query(`UPDATE servers SET deleted_at = NOW() WHERE id = $1`, [serverId])

    // Server should appear in recycle bin
    const listRes = await request
      .get('/api/recycle-bin?type=servers')
      .set('Cookie', adminCookie)
    expect(listRes.status).toBe(200)
    expect(Array.isArray(listRes.body.items)).toBe(true)
    const found = listRes.body.items.find((item: { id: string }) => item.id === serverId)
    expect(found).toBeDefined()
    expect(found.type).toBe('servers')
    expect(found.label).toBe('recycle-test-01')
    expect(found.deletedAt).toBeTruthy()

    // Restore the server
    const restoreRes = await request
      .post(`/api/recycle-bin/servers/${serverId}/restore`)
      .set('Cookie', adminCookie)
    expect(restoreRes.status).toBe(200)
    expect(restoreRes.body.ok).toBe(true)

    // Server should no longer appear in recycle bin
    const listAfterRes = await request
      .get('/api/recycle-bin?type=servers')
      .set('Cookie', adminCookie)
    expect(listAfterRes.status).toBe(200)
    const notFound = listAfterRes.body.items.find((item: { id: string }) => item.id === serverId)
    expect(notFound).toBeUndefined()
  })

  // ── Restore 404 ────────────────────────────────────────────────────────────

  it('POST restore non-existent id → 404', async () => {
    const res = await request
      .post('/api/recycle-bin/servers/00000000-0000-0000-0000-000000000000/restore')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(404)
  })

  it('POST restore invalid type → 400', async () => {
    const res = await request
      .post('/api/recycle-bin/widgets/00000000-0000-0000-0000-000000000000/restore')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(400)
  })
})
