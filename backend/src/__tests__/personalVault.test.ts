import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createPool } from '../db/pool.ts'
import { runMigrations } from '../db/migrate.ts'
import { createApp } from '../server.ts'
import { loadConfig } from '../config.ts'
import type { Pool } from 'pg'

const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('personal vault API (C8.1)', () => {
  let pool: Pool
  let app: ReturnType<typeof createApp>
  let adminCookie: string
  let otherCookie: string
  let entryId: string

  const kek = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
  const vaultPassword = 'MyVaultPass123!'
  const wrongPassword = 'WrongPass999!'

  beforeAll(async () => {
    const cfg = loadConfig({
      AUTH_MODE: 'self',
      BIRO_MASTER_KEK: kek,
      DATABASE_URL: DB_URL!,
      SESSION_SECRET: 'pv-test-session-secret-32-chars-long-enough',
      NODE_ENV: 'test',
      BIRO_ADMIN_EMAIL: 'pv-admin@test.local',
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
      .send({ email: 'pv-admin@test.local', password: 'Admin1234!' })
    adminCookie = adminLogin.headers['set-cookie']?.[0]?.split(';')[0] ?? ''

    // Create a second user for IDOR testing
    await request(app)
      .post('/api/admin/users')
      .set('Cookie', adminCookie)
      .send({
        email: 'pv-other@test.local',
        displayName: 'PV Other',
        role: 'viewer',
        password: 'Other1234!',
      })
      .catch(() => { /* already exists */ })

    const otherLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'pv-other@test.local', password: 'Other1234!' })
    otherCookie = otherLogin.headers['set-cookie']?.[0]?.split(';')[0] ?? ''
  })

  afterAll(async () => {
    await pool.end()
  })

  it('GET /personal-vault/status before init returns { initialized: false }', async () => {
    const res = await request(app)
      .get('/api/personal-vault/status')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.initialized).toBe(false)
  })

  it('POST /personal-vault/initialize with password returns 200 ok', async () => {
    const res = await request(app)
      .post('/api/personal-vault/initialize')
      .set('Cookie', adminCookie)
      .send({ password: vaultPassword })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('GET /personal-vault/status after init returns { initialized: true }', async () => {
    const res = await request(app)
      .get('/api/personal-vault/status')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.initialized).toBe(true)
  })

  it('POST /personal-vault/initialize again returns 409', async () => {
    const res = await request(app)
      .post('/api/personal-vault/initialize')
      .set('Cookie', adminCookie)
      .send({ password: vaultPassword })
    expect(res.status).toBe(409)
  })

  it('POST /personal-vault/entries creates entry — returns metadata, no ciphertext', async () => {
    const res = await request(app)
      .post('/api/personal-vault/entries')
      .set('Cookie', adminCookie)
      .send({
        title: 'My GitHub',
        url: 'https://github.com',
        username: 'mygithubuser',
        value: 'gh_secret_token_123',
        password: vaultPassword,
      })
    expect(res.status).toBe(201)
    expect(res.body.entry.id).toBeDefined()
    expect(res.body.entry.title).toBe('My GitHub')
    expect(res.body.entry.url).toBe('https://github.com')
    expect(res.body.entry.username).toBe('mygithubuser')
    // Must NOT expose crypto fields
    expect(res.body.entry.ciphertext).toBeUndefined()
    expect(res.body.entry.iv).toBeUndefined()
    expect(res.body.entry.auth_tag).toBeUndefined()
    expect(res.body.entry.value).toBeUndefined()
    entryId = res.body.entry.id as string
  })

  it('POST /personal-vault/entries with logo_url stores it', async () => {
    const res = await request(app)
      .post('/api/personal-vault/entries')
      .set('Cookie', adminCookie)
      .send({
        title: 'AWS Console',
        url: 'https://console.aws.amazon.com',
        username: 'aws-user',
        logo_url: 'https://example.com/aws.png',
        value: 'aws-secret-key',
        password: vaultPassword,
      })
    expect(res.status).toBe(201)
    expect(res.body.entry.logoUrl).toBe('https://example.com/aws.png')
  })

  it('GET /personal-vault/entries lists metadata only — no ciphertext', async () => {
    const res = await request(app)
      .get('/api/personal-vault/entries')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.entries)).toBe(true)
    expect(res.body.entries.length).toBeGreaterThanOrEqual(1)
    const entry = res.body.entries.find((e: { id: string }) => e.id === entryId)
    expect(entry).toBeDefined()
    expect(entry.ciphertext).toBeUndefined()
    expect(entry.iv).toBeUndefined()
    expect(entry.auth_tag).toBeUndefined()
    expect(entry.value).toBeUndefined()
  })

  it('IDOR: other user sees only their own entries (not admin entries)', async () => {
    // Other user has no entries (vault not even initialized)
    const res = await request(app)
      .get('/api/personal-vault/entries')
      .set('Cookie', otherCookie)
    expect(res.status).toBe(200)
    // Admin's entries must NOT appear
    const ids = (res.body.entries as Array<{ id: string }>).map((e) => e.id)
    expect(ids).not.toContain(entryId)
  })

  it('POST /personal-vault/entries/:id/reveal with correct password returns value', async () => {
    const res = await request(app)
      .post(`/api/personal-vault/entries/${entryId}/reveal`)
      .set('Cookie', adminCookie)
      .send({ password: vaultPassword })
    expect(res.status).toBe(200)
    expect(res.body.value).toBe('gh_secret_token_123')
  })

  it('POST /personal-vault/entries/:id/reveal with wrong password returns 401', async () => {
    const res = await request(app)
      .post(`/api/personal-vault/entries/${entryId}/reveal`)
      .set('Cookie', adminCookie)
      .send({ password: wrongPassword })
    expect(res.status).toBe(401)
    expect(res.body.value).toBeUndefined()
  })

  it('PATCH /personal-vault/entries/:id updates metadata', async () => {
    const res = await request(app)
      .patch(`/api/personal-vault/entries/${entryId}`)
      .set('Cookie', adminCookie)
      .send({ title: 'My GitHub (updated)', url: 'https://github.com/updated' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // Verify the change
    const getRes = await request(app)
      .get(`/api/personal-vault/entries/${entryId}`)
      .set('Cookie', adminCookie)
    expect(getRes.status).toBe(200)
    expect(getRes.body.entry.title).toBe('My GitHub (updated)')
    expect(getRes.body.entry.url).toBe('https://github.com/updated')
  })

  it('DELETE /personal-vault/entries/:id soft-deletes (404 after)', async () => {
    const res = await request(app)
      .delete(`/api/personal-vault/entries/${entryId}`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // Should be 404 now
    const getRes = await request(app)
      .get(`/api/personal-vault/entries/${entryId}`)
      .set('Cookie', adminCookie)
    expect(getRes.status).toBe(404)
  })

  it('unauthenticated request to personal vault returns 401', async () => {
    const res = await request(app).get('/api/personal-vault/status')
    expect(res.status).toBe(401)
  })
})
