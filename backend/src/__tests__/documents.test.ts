import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createPool } from '../db/pool.ts'
import { runMigrations } from '../db/migrate.ts'
import { createApp } from '../server.ts'
import { loadConfig } from '../config.ts'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { Pool } from 'pg'

const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('documents API (C6.1 + C6.2)', () => {
  let pool: Pool
  let app: ReturnType<typeof createApp>
  let adminCookie: string
  let viewerCookie: string
  let uploadsDir: string
  let documentId: string

  beforeAll(async () => {
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biro-docs-test-'))

    const cfg = loadConfig({
      AUTH_MODE: 'self',
      BIRO_MASTER_KEK: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      DATABASE_URL: DB_URL!,
      SESSION_SECRET: 'test-session-secret-32-chars-long-enough',
      NODE_ENV: 'test',
      BIRO_ADMIN_EMAIL: 'docs-admin@test.local',
      BIRO_ADMIN_PASSWORD: 'Admin1234!',
      UPLOADS_DIR: uploadsDir,
    })
    pool = createPool(cfg.databaseUrl)
    await runMigrations(cfg.databaseUrl)

    app = createApp({
      pool,
      sessionSecret: cfg.sessionSecret,
      adminEmail: cfg.adminEmail,
      adminPassword: cfg.adminPassword,
      authMode: cfg.authMode,
      uploadsDir,
    })

    await request(app)
      .post('/api/setup/initialize')
      .send({ title: 'Test', accent: '#a78bfa' })
      .catch(() => {/* already initialized */})

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'docs-admin@test.local', password: 'Admin1234!' })
    adminCookie = adminLogin.headers['set-cookie']?.[0]?.split(';')[0] ?? ''

    await request(app)
      .post('/api/admin/users')
      .set('Cookie', adminCookie)
      .send({
        email: 'docs-viewer@test.local',
        displayName: 'Docs Viewer',
        role: 'viewer',
        tempPassword: 'Viewer1234!',
      })
      .catch(() => {/* already exists */})

    const viewerLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'docs-viewer@test.local', password: 'Viewer1234!' })
    viewerCookie = viewerLogin.headers['set-cookie']?.[0]?.split(';')[0] ?? ''
  })

  afterAll(async () => {
    await pool.end()
    fs.rmSync(uploadsDir, { recursive: true, force: true })
  })

  // ── C6.1: Upload ─────────────────────────────────────────────────────────

  it('unauthenticated upload returns 401', async () => {
    const res = await request(app)
      .post('/api/documents')
      .attach('file', Buffer.from('hello'), { filename: 'test.txt', contentType: 'text/plain' })
    expect(res.status).toBe(401)
  })

  it('viewer without docs.write cannot upload (403)', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set('Cookie', viewerCookie)
      .attach('file', Buffer.from('hello viewer'), { filename: 'viewer.txt', contentType: 'text/plain' })
    expect(res.status).toBe(403)
  })

  it('admin can upload a text file', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('Hello world document'), { filename: 'readme.txt', contentType: 'text/plain' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.filename).toBe('readme.txt')
    expect(res.body.mime).toBe('text/plain')
    expect(res.body.size).toBeGreaterThan(0)
    expect(res.body.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(res.body.storage_path).toBeDefined()
    expect(res.body.uploaded_at).toBeDefined()
    // Crypto fields must never appear
    expect(res.body.ciphertext).toBeUndefined()
    documentId = res.body.id as string
  })

  it('upload stores file on disk in uploadsDir', async () => {
    const files = fs.readdirSync(uploadsDir)
    expect(files.length).toBeGreaterThan(0)
  })

  it('disallowed mime type returns 400', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('exec content'), { filename: 'exploit.exe', contentType: 'application/x-msdownload' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not allowed/i)
  })

  it('oversize file returns 413', async () => {
    const bigBuffer = Buffer.alloc(11 * 1024 * 1024, 'x') // 11 MB > 10 MB limit
    const res = await request(app)
      .post('/api/documents')
      .set('Cookie', adminCookie)
      .attach('file', bigBuffer, { filename: 'big.txt', contentType: 'text/plain' })
    expect(res.status).toBe(413)
  })

  it('GET /api/documents/:id returns metadata', async () => {
    const res = await request(app)
      .get(`/api/documents/${documentId}`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(documentId)
    expect(res.body.filename).toBe('readme.txt')
    expect(res.body.mime).toBe('text/plain')
    expect(res.body.size).toBeGreaterThan(0)
  })

  it('GET /api/documents/:id unauthenticated returns 401', async () => {
    const res = await request(app).get(`/api/documents/${documentId}`)
    expect(res.status).toBe(401)
  })

  it('viewer with docs.read can GET document metadata', async () => {
    const res = await request(app)
      .get(`/api/documents/${documentId}`)
      .set('Cookie', viewerCookie)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(documentId)
  })

  it('admin can upload a PDF', async () => {
    // Minimal valid PDF header
    const minimalPdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\nxref\n%%EOF')
    const res = await request(app)
      .post('/api/documents')
      .set('Cookie', adminCookie)
      .attach('file', minimalPdf, { filename: 'runbook.pdf', contentType: 'application/pdf' })
    expect(res.status).toBe(201)
    expect(res.body.mime).toBe('application/pdf')
  })

  it('admin can attach document to a linked entity', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set('Cookie', adminCookie)
      .field('linkedType', 'server')
      .field('linkedId', '00000000-0000-0000-0000-000000000001')
      .attach('file', Buffer.from('server runbook'), { filename: 'server-runbook.txt', contentType: 'text/plain' })
    expect(res.status).toBe(201)
    expect(res.body.linked_type).toBe('server')
    expect(res.body.linked_id).toBe('00000000-0000-0000-0000-000000000001')
  })

  it('GET /api/documents lists documents', async () => {
    const res = await request(app)
      .get('/api/documents')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
  })

  it('GET /api/documents?linkedType=server&linkedId=... filters by entity', async () => {
    const res = await request(app)
      .get('/api/documents?linkedType=server&linkedId=00000000-0000-0000-0000-000000000001')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    const found = res.body.find((d: { linked_type: string; linked_id: string }) =>
      d.linked_type === 'server' && d.linked_id === '00000000-0000-0000-0000-000000000001'
    )
    expect(found).toBeDefined()
  })

  // ── C6.2: Download + View ─────────────────────────────────────────────────

  it('GET /api/documents/:id/download returns file contents', async () => {
    const res = await request(app)
      .get(`/api/documents/${documentId}/download`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(res.headers['content-disposition']).toMatch(/attachment/)
    expect(res.text).toBe('Hello world document')
  })

  it('GET /api/documents/:id/download unauthenticated returns 401', async () => {
    const res = await request(app).get(`/api/documents/${documentId}/download`)
    expect(res.status).toBe(401)
  })

  it('GET /api/documents/:id/view returns text inline for text/plain', async () => {
    const res = await request(app)
      .get(`/api/documents/${documentId}/view`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/inline/)
    expect(res.text).toBe('Hello world document')
  })

  it('DELETE /api/documents/:id soft-deletes the document', async () => {
    const uploadRes = await request(app)
      .post('/api/documents')
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('delete me'), { filename: 'delete.txt', contentType: 'text/plain' })
    expect(uploadRes.status).toBe(201)
    const docId = uploadRes.body.id as string

    const del = await request(app)
      .delete(`/api/documents/${docId}`)
      .set('Cookie', adminCookie)
    expect(del.status).toBe(200)

    // After soft-delete, GET returns 404
    const get = await request(app)
      .get(`/api/documents/${docId}`)
      .set('Cookie', adminCookie)
    expect(get.status).toBe(404)
  })

  it('viewer without docs.write cannot delete (403)', async () => {
    const del = await request(app)
      .delete(`/api/documents/${documentId}`)
      .set('Cookie', viewerCookie)
    expect(del.status).toBe(403)
  })
})
