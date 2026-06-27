import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import supertest from 'supertest'
import { runMigrations } from '../db/migrate.ts'
import { createApp } from '../server.ts'
import { loadConfig } from '../config.ts'

const { Pool } = pg

const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('C9.1 search API', () => {
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
      BIRO_ADMIN_EMAIL: 'search-admin@test.local',
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
      email: 'search-admin@test.local',
      password: 'Admin1234!',
    })
    adminCookie = adminLogin.headers['set-cookie']?.[0] ?? ''

    // Create a server with a known searchable hostname
    await request
      .post('/api/servers')
      .set('Cookie', adminCookie)
      .send({
        hostname: 'searchable-host-xyz',
        environment: 'prod',
        notes: 'Search test server',
      })
  }, 60_000)

  afterAll(async () => {
    await pool.end()
  })

  it('GET /api/search?q=searchable-host returns server results', async () => {
    const res = await request
      .get('/api/search?q=searchable-host')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.results)).toBe(true)
    const serverResults = (res.body.results as Array<{ type: string; title: string }>).filter(
      (r) => r.type === 'server',
    )
    expect(serverResults.length).toBeGreaterThan(0)
    expect(serverResults.some((r) => r.title === 'searchable-host-xyz')).toBe(true)
  })

  it('GET /api/search?q= (empty) returns empty results', async () => {
    const res = await request
      .get('/api/search?q=')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([])
  })

  it('GET /api/search without auth returns 401', async () => {
    const res = await request.get('/api/search?q=searchable-host')
    expect(res.status).toBe(401)
  })

  it('results never contain ciphertext or value fields', async () => {
    const res = await request
      .get('/api/search?q=searchable-host')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    for (const result of res.body.results as Array<Record<string, unknown>>) {
      expect(result).not.toHaveProperty('ciphertext')
      expect(result).not.toHaveProperty('value')
      expect(result).not.toHaveProperty('iv')
      expect(result).not.toHaveProperty('auth_tag')
      expect(result).not.toHaveProperty('wrapped_dek')
    }
  })
})
