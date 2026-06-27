import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createPool } from '../db/pool.ts'
import { runMigrations } from '../db/migrate.ts'
import { createApp } from '../server.ts'
import { loadConfig } from '../config.ts'
import type { Pool } from 'pg'

const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('backup/restore/kek-rotation API (C9.4)', () => {
  let pool: Pool
  let app: ReturnType<typeof createApp>
  let adminCookie: string

  const kek = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' // 32 zero-bytes in base64

  beforeAll(async () => {
    process.env['BIRO_MASTER_KEK'] = kek

    const cfg = loadConfig({
      AUTH_MODE: 'self',
      BIRO_MASTER_KEK: kek,
      DATABASE_URL: DB_URL!,
      SESSION_SECRET: 'test-session-secret-32-chars-long-enough',
      NODE_ENV: 'test',
      BIRO_ADMIN_EMAIL: 'backup-admin@test.local',
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

    // Initialize the app (no-op if already done)
    await request(app)
      .post('/api/setup/initialize')
      .send({ title: 'Test', accent: '#a78bfa' })
      .catch(() => {/* already initialized */})

    // Login as admin
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'backup-admin@test.local', password: 'Admin1234!' })
    adminCookie = adminLogin.headers['set-cookie']?.[0]?.split(';')[0] ?? ''
  })

  afterAll(async () => {
    await pool.end()
  })

  // ── Backup ──────────────────────────────────────────────────────────────────

  it('POST /api/admin/backup without auth → 401', async () => {
    const res = await request(app).post('/api/admin/backup')
    expect(res.status).toBe(401)
  })

  it('POST /api/admin/backup as admin → 200 with base64 backup string', async () => {
    const res = await request(app)
      .post('/api/admin/backup')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('backup')
    expect(typeof res.body.backup).toBe('string')
    // Should be non-empty base64
    expect(res.body.backup.length).toBeGreaterThan(0)
  })

  // ── KEK Rotation ────────────────────────────────────────────────────────────

  it('POST /api/admin/kek-rotation without auth → 401', async () => {
    const res = await request(app).post('/api/admin/kek-rotation')
    expect(res.status).toBe(401)
  })

  it('POST /api/admin/kek-rotation with bad newKek (not valid 32-byte base64) → 400', async () => {
    const res = await request(app)
      .post('/api/admin/kek-rotation')
      .set('Cookie', adminCookie)
      .send({ newKek: 'not-a-valid-32-byte-base64-key' })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  it('POST /api/admin/kek-rotation with valid newKek → 200 with rotated count', async () => {
    // A fresh 32-byte key (all 0x01 bytes)
    const newKek = Buffer.alloc(32, 0x01).toString('base64')
    const res = await request(app)
      .post('/api/admin/kek-rotation')
      .set('Cookie', adminCookie)
      .send({ newKek })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('ok', true)
    expect(res.body).toHaveProperty('rotated')
    expect(typeof res.body.rotated).toBe('number')
  })
})
