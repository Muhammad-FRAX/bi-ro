import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import supertest from 'supertest'
import { runMigrations } from '../db/migrate.ts'
import { createApp } from '../server.ts'
import { loadConfig } from '../config.ts'

const { Pool } = pg

const DB_URL = process.env['DATABASE_URL']

// Build a minimal valid fstree document for import tests
function makeValidFsTree(nodeCount = 2) {
  return JSON.stringify({
    schema: 'bi-ro.fstree.v1',
    root: '/home/user',
    host: 'etl-01',
    generated_at: '2026-06-25T10:00:00Z',
    max_depth: 3,
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      path: `/home/user/file${i}`,
      type: 'file',
      size: 1024,
      mtime: '2026-01-01T00:00:00Z',
    })),
  })
}

describe.skipIf(!DB_URL)('C3.2 + C3.3 filesystem API', () => {
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
      BIRO_ADMIN_EMAIL: 'admin-fs@test.local',
      BIRO_ADMIN_PASSWORD: 'AdminPass1!',
    })
    const app = createApp({
      pool,
      sessionSecret: cfg.sessionSecret,
      secureCookie: false,
      adminEmail: 'admin-fs@test.local',
      adminPassword: 'AdminPass1!',
      authMode: 'self',
    })
    request = supertest(app)

    await request.post('/api/setup/initialize').send({})
    const loginRes = await request.post('/api/auth/login').send({
      email: 'admin-fs@test.local', password: 'AdminPass1!',
    })
    adminCookie = loginRes.headers['set-cookie']?.[0] ?? ''

    // Create a server to test with
    const srvRes = await request.post('/api/servers').set('Cookie', adminCookie)
      .send({ hostname: 'fs-test-server', environment: 'prod' })
    serverId = srvRes.body.server.id as string
  }, 60_000)

  afterAll(async () => { await pool.end() })

  // ── C3.2 generate-script ────────────────────────────────────────────────────

  it('POST /api/servers/:id/fs/generate-script returns bash and ps1', async () => {
    const res = await request
      .post(`/api/servers/${serverId}/fs/generate-script`)
      .set('Cookie', adminCookie)
      .send({ root: '/home/user', maxDepth: 3 })
    expect(res.status).toBe(200)
    expect(typeof res.body.bash).toBe('string')
    expect(typeof res.body.ps1).toBe('string')
    expect(res.body.bash).toContain('bi-ro.fstree.v1')
    expect(res.body.ps1).toContain('bi-ro.fstree.v1')
  })

  it('POST /api/servers/:id/fs/generate-script 404 for unknown server', async () => {
    const res = await request
      .post('/api/servers/00000000-0000-0000-0000-000000000000/fs/generate-script')
      .set('Cookie', adminCookie)
      .send({ root: '/home/user', maxDepth: 3 })
    expect(res.status).toBe(404)
  })

  it('POST /api/servers/:id/fs/generate-script 400 for missing root', async () => {
    const res = await request
      .post(`/api/servers/${serverId}/fs/generate-script`)
      .set('Cookie', adminCookie)
      .send({ maxDepth: 3 })
    expect(res.status).toBe(400)
  })

  it('POST /api/servers/:id/fs/generate-script 400 for invalid maxDepth', async () => {
    const res = await request
      .post(`/api/servers/${serverId}/fs/generate-script`)
      .set('Cookie', adminCookie)
      .send({ root: '/home/user', maxDepth: 25 })
    expect(res.status).toBe(400)
  })

  it('POST /api/servers/:id/fs/generate-script 401 without auth', async () => {
    const res = await request
      .post(`/api/servers/${serverId}/fs/generate-script`)
      .send({ root: '/home/user', maxDepth: 3 })
    expect(res.status).toBe(401)
  })

  // ── C3.3 import ─────────────────────────────────────────────────────────────

  it('POST /api/servers/:id/fs/import 201 stores a valid snapshot', async () => {
    const res = await request
      .post(`/api/servers/${serverId}/fs/import`)
      .set('Cookie', adminCookie)
      .send({ json: makeValidFsTree(5) })
    expect(res.status).toBe(201)
    expect(res.body.snapshot.id).toBeTruthy()
    expect(res.body.snapshot.serverId).toBe(serverId)
    expect(res.body.snapshot.nodeCount).toBe(5)
    expect(typeof res.body.snapshot.rootPath).toBe('string')
  })

  it('POST /api/servers/:id/fs/import 422 for malformed JSON', async () => {
    const res = await request
      .post(`/api/servers/${serverId}/fs/import`)
      .set('Cookie', adminCookie)
      .send({ json: '{ invalid json !!!' })
    expect(res.status).toBe(422)
  })

  it('POST /api/servers/:id/fs/import 422 for wrong schema version', async () => {
    const doc = JSON.stringify({
      schema: 'bi-ro.fstree.v99',
      root: '/home/user',
      host: 'etl-01',
      generated_at: '2026-06-25T10:00:00Z',
      max_depth: 3,
      nodes: [],
    })
    const res = await request
      .post(`/api/servers/${serverId}/fs/import`)
      .set('Cookie', adminCookie)
      .send({ json: doc })
    expect(res.status).toBe(422)
  })

  it('POST /api/servers/:id/fs/import 422 for too many nodes', async () => {
    const doc = JSON.stringify({
      schema: 'bi-ro.fstree.v1',
      root: '/home/user',
      host: 'etl-01',
      generated_at: '2026-06-25T10:00:00Z',
      max_depth: 3,
      nodes: Array.from({ length: 50001 }, (_, i) => ({
        path: `/home/user/file${i}`,
        type: 'file',
        size: 1,
        mtime: '2026-01-01T00:00:00Z',
      })),
    })
    const res = await request
      .post(`/api/servers/${serverId}/fs/import`)
      .set('Cookie', adminCookie)
      .send({ json: doc })
    expect(res.status).toBe(422)
  })

  it('POST /api/servers/:id/fs/import 422 for max_depth exceeding limit', async () => {
    const doc = JSON.stringify({
      schema: 'bi-ro.fstree.v1',
      root: '/home/user',
      host: 'etl-01',
      generated_at: '2026-06-25T10:00:00Z',
      max_depth: 25,
      nodes: [],
    })
    const res = await request
      .post(`/api/servers/${serverId}/fs/import`)
      .set('Cookie', adminCookie)
      .send({ json: doc })
    expect(res.status).toBe(422)
  })

  it('POST /api/servers/:id/fs/import 404 for unknown server', async () => {
    const res = await request
      .post('/api/servers/00000000-0000-0000-0000-000000000000/fs/import')
      .set('Cookie', adminCookie)
      .send({ json: makeValidFsTree(1) })
    expect(res.status).toBe(404)
  })

  // ── C3.3 snapshots list ──────────────────────────────────────────────────────

  it('GET /api/servers/:id/fs/snapshots returns list of snapshots', async () => {
    // Import first to ensure there's at least one snapshot
    await request
      .post(`/api/servers/${serverId}/fs/import`)
      .set('Cookie', adminCookie)
      .send({ json: makeValidFsTree(2) })

    const res = await request
      .get(`/api/servers/${serverId}/fs/snapshots`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.snapshots)).toBe(true)
    expect(res.body.snapshots.length).toBeGreaterThan(0)
    const snap = res.body.snapshots[0] as Record<string, unknown>
    expect(snap['id']).toBeTruthy()
    expect(snap['serverId']).toBe(serverId)
    expect(typeof snap['nodeCount']).toBe('number')
  })

  it('GET /api/servers/:id/fs/snapshots 401 without auth', async () => {
    const res = await request.get(`/api/servers/${serverId}/fs/snapshots`)
    expect(res.status).toBe(401)
  })

  // ── C3.3 snapshot detail ─────────────────────────────────────────────────────

  it('GET /api/servers/:id/fs/snapshots/:snapshotId returns snapshot with nodes', async () => {
    // Import a snapshot to get an id
    const importRes = await request
      .post(`/api/servers/${serverId}/fs/import`)
      .set('Cookie', adminCookie)
      .send({ json: makeValidFsTree(3) })
    const snapshotId = importRes.body.snapshot.id as string

    const res = await request
      .get(`/api/servers/${serverId}/fs/snapshots/${snapshotId}`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.snapshot.id).toBe(snapshotId)
    expect(Array.isArray(res.body.nodes)).toBe(true)
    expect(res.body.nodes.length).toBe(3)
  })

  it('GET /api/servers/:id/fs/snapshots/:snapshotId 404 for snapshot belonging to different server', async () => {
    // Create a second server
    const srv2Res = await request.post('/api/servers').set('Cookie', adminCookie)
      .send({ hostname: 'fs-test-server-2', environment: 'staging' })
    const serverId2 = srv2Res.body.server.id as string

    // Import a snapshot on server 2
    const importRes = await request
      .post(`/api/servers/${serverId2}/fs/import`)
      .set('Cookie', adminCookie)
      .send({ json: makeValidFsTree(1) })
    const snapshotId = importRes.body.snapshot.id as string

    // Try to retrieve it under server 1 — should 404
    const res = await request
      .get(`/api/servers/${serverId}/fs/snapshots/${snapshotId}`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(404)
  })

  it('GET /api/servers/:id/fs/snapshots/:snapshotId 404 for non-existent snapshot', async () => {
    const res = await request
      .get(`/api/servers/${serverId}/fs/snapshots/00000000-0000-0000-0000-000000000000`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(404)
  })
})
