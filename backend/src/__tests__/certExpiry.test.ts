import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { runExpiryScan } from '../services/expiryWorker.ts'
import { buildWeeklyDigest } from '../services/digestWorker.ts'
import { createPool } from '../db/pool.ts'
import { runMigrations } from '../db/migrate.ts'
import type { Pool } from 'pg'

const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('C5.4 — Certificate expiry tracking', () => {
  let pool: Pool
  let testVaultId: string
  let certSecretId: string

  beforeAll(async () => {
    pool = createPool(DB_URL!)
    await runMigrations(DB_URL!)

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
       VALUES ('self', 'cert-admin@test.local', 'CertAdmin', $1, 'active', FALSE)
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

    // Vault for cert test
    const { rows: vaultRows } = await pool.query<{ id: string }>(
      `INSERT INTO vaults (name, type, owner_id) VALUES ('Cert Test Vault', 'team', $1) RETURNING id`,
      [userId],
    )
    testVaultId = vaultRows[0]!.id
    await pool.query(
      `INSERT INTO vault_members (vault_id, user_id, access) VALUES ($1, $2, 'manage') ON CONFLICT DO NOTHING`,
      [testVaultId, userId],
    )

    // Certificate-type secret expiring in 5 days
    const { encryptSecret } = await import('../crypto/envelope.ts')
    let kek: Buffer
    try {
      const { getConfig } = await import('../config.ts')
      kek = getConfig().kek
    } catch {
      kek = Buffer.alloc(32)
    }
    const encrypted = encryptSecret('cert-value', kek)
    const { rows: certRows } = await pool.query<{ id: string }>(
      `INSERT INTO secrets (vault_id, type, title, username, ciphertext, iv, auth_tag, wrapped_dek, key_version,
                           expires_at, created_by)
       VALUES ($1, 'certificate', 'TLS cert for api.example.com', 'system', $2, $3, $4, $5, 1,
               now() + interval '5 days', $6)
       RETURNING id`,
      [
        testVaultId,
        encrypted.ciphertext.toString('base64'),
        encrypted.iv.toString('base64'),
        encrypted.authTag.toString('base64'),
        encrypted.wrappedDek.toString('base64'),
        userId,
      ],
    )
    certSecretId = certRows[0]!.id
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM notification_sent_log WHERE target_id = $1`, [certSecretId])
    await pool.query(`DELETE FROM notifications WHERE target_id = $1`, [certSecretId])
    await pool.query(`DELETE FROM secrets WHERE vault_id = $1`, [testVaultId])
    await pool.query(`DELETE FROM vault_members WHERE vault_id = $1`, [testVaultId])
    await pool.query(`DELETE FROM vaults WHERE id = $1`, [testVaultId])
    await pool.query(`DELETE FROM users WHERE email = 'cert-admin@test.local'`)
    await pool.end()
  })

  it('certificate near expiry produces notification', async () => {
    const result = await runExpiryScan(pool)
    expect(result.fired).toBeGreaterThan(0)

    const { rows } = await pool.query(
      `SELECT * FROM notifications WHERE target_id = $1`,
      [certSecretId],
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]!['type']).toBe('expiry')
  })
})

describe('C5.4 — Weekly digest builder (pure unit test)', () => {
  it('buildWeeklyDigest returns structured digest object', async () => {
    // Pure unit test — no DB needed. Just checks the function exists and has the right shape.
    const mockPool = {
      query: async (sql: string) => {
        if (sql.includes('secrets')) {
          return { rows: [
            { title: 'DB password', vault_name: 'Infra', days_remaining: -2, type: 'db_credential' },
            { title: 'API key', vault_name: 'Services', days_remaining: 5, type: 'api_key' },
          ] }
        }
        if (sql.includes('servers')) {
          return { rows: [{ count: '3' }] }
        }
        return { rows: [] }
      },
    } as unknown as import('pg').Pool

    const digest = await buildWeeklyDigest(mockPool, 'BI Root')
    expect(digest).toHaveProperty('expiringCount')
    expect(digest).toHaveProperty('overdueCount')
    expect(digest).toHaveProperty('totalServers')
    expect(digest.overdueCount).toBe(1)
    expect(digest.expiringCount).toBe(1) // 5 days remaining = expiring within 7
  })

  it('buildWeeklyDigest html contains overdue items', async () => {
    const mockPool = {
      query: async (sql: string) => {
        if (sql.includes('secrets')) {
          return { rows: [
            { title: 'My cert', vault_name: 'Certs', days_remaining: -10, type: 'certificate' },
          ] }
        }
        return { rows: [{ count: '0' }] }
      },
    } as unknown as import('pg').Pool

    const digest = await buildWeeklyDigest(mockPool, 'BI Root')
    expect(digest.html).toContain('My cert')
    expect(digest.html.toLowerCase()).toContain('overdue')
  })
})
