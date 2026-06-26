import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../server.ts'
import { runMigrations } from '../db/migrate.ts'
import { createPool } from '../db/pool.ts'
import type { Pool } from 'pg'
import type { Express } from 'express'

const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('C5.1 — Notifications API', () => {
  let pool: Pool
  let app: Express
  let adminCookie: string

  beforeAll(async () => {
    pool = createPool(DB_URL!)
    await runMigrations(DB_URL!)

    // Seed an initialized setup state + admin user if not present
    await pool.query(`
      INSERT INTO setup_state (initialized, auth_mode, initialized_at)
      VALUES (TRUE, 'self', now())
      ON CONFLICT DO NOTHING
    `)
    const { hashPassword } = await import('../auth/self.ts')
    const hash = await hashPassword('Admin1234!')
    const { rows: roleRows } = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE name = 'admin'`)
    const { rows: userRows } = await pool.query<{ id: string }>(
      `INSERT INTO users (auth_mode, email, display_name, password_hash, status, force_password_change)
       VALUES ('self', 'notif-admin@test.local', 'NotifAdmin', $1, 'active', FALSE)
       ON CONFLICT (email) WHERE deleted_at IS NULL
       DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [hash],
    )
    const userId = userRows[0]!.id
    if (roleRows[0]) {
      await pool.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, roleRows[0].id],
      )
    }

    app = createApp({
      pool,
      sessionSecret: 'test-secret-notifications-1234567890',
      adminEmail: 'notif-admin@test.local',
      adminPassword: 'Admin1234!',
      authMode: 'self',
    })

    // Login and capture session cookie
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'notif-admin@test.local', password: 'Admin1234!' })
    adminCookie = loginRes.headers['set-cookie']?.[0] ?? ''
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE email = 'notif-admin@test.local'`)
    await pool.end()
  })

  it('GET /api/notifications — 401 unauthenticated', async () => {
    const res = await request(app).get('/api/notifications')
    expect(res.status).toBe(401)
  })

  it('GET /api/notifications — 200 empty list for authenticated user', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('notifications')
    expect(Array.isArray(res.body.notifications)).toBe(true)
  })

  it('POST /api/notifications — create notification manually', async () => {
    const res = await request(app)
      .post('/api/notifications')
      .set('Cookie', adminCookie)
      .send({
        type: 'system',
        severity: 'warning',
        title: 'Test notification',
        body: 'This is a test',
        targetType: null,
        targetId: null,
      })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('notification')
    expect(res.body.notification.title).toBe('Test notification')
    expect(res.body.notification.severity).toBe('warning')
    expect(res.body.notification.readAt).toBeNull()
  })

  it('GET /api/notifications — newly created notification appears in list', async () => {
    // Create one first
    await request(app)
      .post('/api/notifications')
      .set('Cookie', adminCookie)
      .send({
        type: 'system',
        severity: 'info',
        title: 'Another notification',
        body: 'body text',
      })

    const res = await request(app)
      .get('/api/notifications')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.notifications.length).toBeGreaterThan(0)
  })

  it('PATCH /api/notifications/:id/read — marks notification as read', async () => {
    // Create a notification
    const createRes = await request(app)
      .post('/api/notifications')
      .set('Cookie', adminCookie)
      .send({ type: 'system', severity: 'info', title: 'Read me', body: '' })
    const notifId = createRes.body.notification.id

    const res = await request(app)
      .patch(`/api/notifications/${notifId}/read`)
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // Verify it's now read
    const listRes = await request(app)
      .get('/api/notifications?unread=true')
      .set('Cookie', adminCookie)
    const ids = listRes.body.notifications.map((n: { id: string }) => n.id)
    expect(ids).not.toContain(notifId)
  })

  it('PATCH /api/notifications/read-all — marks all as read', async () => {
    // Create unread notification
    await request(app)
      .post('/api/notifications')
      .set('Cookie', adminCookie)
      .send({ type: 'system', severity: 'info', title: 'Bulk read', body: '' })

    const res = await request(app)
      .patch('/api/notifications/read-all')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // Verify unread count is 0
    const countRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Cookie', adminCookie)
    expect(countRes.status).toBe(200)
    expect(countRes.body.count).toBe(0)
  })

  it('GET /api/notifications/rules — list notification rules', async () => {
    const res = await request(app)
      .get('/api/notifications/rules')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.rules)).toBe(true)
    // Default rules seeded by migration
    const kinds = res.body.rules.map((r: { kind: string }) => r.kind)
    expect(kinds).toContain('expiry')
  })

  it('PATCH /api/notifications/rules/:id — update rule enabled state', async () => {
    const rulesRes = await request(app)
      .get('/api/notifications/rules')
      .set('Cookie', adminCookie)
    const rule = rulesRes.body.rules[0]

    const res = await request(app)
      .patch(`/api/notifications/rules/${rule.id}`)
      .set('Cookie', adminCookie)
      .send({ enabled: false })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // Restore
    await request(app)
      .patch(`/api/notifications/rules/${rule.id}`)
      .set('Cookie', adminCookie)
      .send({ enabled: true })
  })

  it('GET /api/notifications/expiring-soon — returns secrets near expiry', async () => {
    const res = await request(app)
      .get('/api/notifications/expiring-soon')
      .set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.items)).toBe(true)
  })
})
