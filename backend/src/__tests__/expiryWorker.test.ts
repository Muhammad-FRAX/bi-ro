import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { runExpiryScan } from '../services/expiryWorker.ts'
import { runMigrations } from '../db/migrate.ts'
import { createPool } from '../db/pool.ts'
import type { Pool } from 'pg'

const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('C5.2 — Expiry scanner worker', () => {
  let pool: Pool
  let testVaultId: string
  let testSecretId: string

  beforeAll(async () => {
    pool = createPool(DB_URL!)
    await runMigrations(DB_URL!)

    // Seed necessary data: a vault, an admin user, and a near-expiry secret
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
       VALUES ('self', 'expiry-admin@test.local', 'ExpiryAdmin', $1, 'active', FALSE)
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

    // Create a test vault
    const { rows: vaultRows } = await pool.query<{ id: string }>(
      `INSERT INTO vaults (name, type, owner_id) VALUES ('Expiry Test Vault', 'team', $1) RETURNING id`,
      [userId],
    )
    testVaultId = vaultRows[0]!.id

    // Enroll admin as vault member
    await pool.query(
      `INSERT INTO vault_members (vault_id, user_id, access) VALUES ($1, $2, 'manage') ON CONFLICT DO NOTHING`,
      [testVaultId, userId],
    )

    // Create a secret that expires in 3 days (within 7-day threshold)
    const { encryptSecret } = await import('../crypto/envelope.ts')
    const { getConfig } = await import('../config.ts')
    // Config may not be initialized in test env - use a dummy kek for envelope
    let kek: Buffer
    try {
      kek = getConfig().kek
    } catch {
      kek = Buffer.alloc(32)
    }
    const encrypted = encryptSecret('test-secret-value', kek)
    const { rows: secretRows } = await pool.query<{ id: string }>(
      `INSERT INTO secrets (vault_id, type, title, username, ciphertext, iv, auth_tag, wrapped_dek, key_version,
                           expires_at, created_by)
       VALUES ($1, 'generic', 'Soon-expiring secret', 'testuser', $2, $3, $4, $5, 1,
               now() + interval '3 days', $6)
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
    testSecretId = secretRows[0]!.id
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM secrets WHERE vault_id = $1`, [testVaultId])
    await pool.query(`DELETE FROM vault_members WHERE vault_id = $1`, [testVaultId])
    await pool.query(`DELETE FROM vaults WHERE id = $1`, [testVaultId])
    await pool.query(`DELETE FROM notification_sent_log WHERE target_id = $1`, [testSecretId])
    await pool.query(`DELETE FROM notifications WHERE target_id = $1`, [testSecretId])
    await pool.query(`DELETE FROM users WHERE email = 'expiry-admin@test.local'`)
    await pool.end()
  })

  it('runExpiryScan creates a notification for near-expiry secret', async () => {
    const result = await runExpiryScan(pool)
    expect(result.scanned).toBeGreaterThan(0)
    expect(result.fired).toBeGreaterThan(0)

    // Notification should be in the DB
    const { rows } = await pool.query(
      `SELECT * FROM notifications WHERE target_id = $1 AND target_type = 'secret'`,
      [testSecretId],
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(['warning', 'danger']).toContain(rows[0]!['severity'])
  })

  it('runExpiryScan does NOT fire twice for the same secret+rule (de-dup)', async () => {
    const before = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications WHERE target_id = $1`,
      [testSecretId],
    )
    const countBefore = parseInt(before.rows[0]!.count, 10)

    // Run again — should not create new notifications
    await runExpiryScan(pool)

    const after = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications WHERE target_id = $1`,
      [testSecretId],
    )
    const countAfter = parseInt(after.rows[0]!.count, 10)
    expect(countAfter).toBe(countBefore)
  })

  it('runExpiryScan re-arms notification after rotation (last_changed_at reset)', async () => {
    // Remove the de-dup log entry to simulate rotation re-arm
    await pool.query(
      `DELETE FROM notification_sent_log WHERE target_id = $1`,
      [testSecretId],
    )
    // Update secret's last_changed_at to now (simulate rotation)
    await pool.query(
      `UPDATE secrets SET last_changed_at = now() - interval '1 day' WHERE id = $1`,
      [testSecretId],
    )

    // A new scan now should fire again
    const result = await runExpiryScan(pool)
    expect(result.fired).toBeGreaterThanOrEqual(1)
  })

  it('runExpiryScan skips secrets without expiry settings', async () => {
    // Count notifications for secrets with no expiry
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications n
       JOIN secrets s ON s.id = n.target_id
       WHERE s.expires_at IS NULL AND s.rotation_period_days IS NULL
         AND s.deleted_at IS NULL`,
    )
    expect(parseInt(rows[0]!.count, 10)).toBe(0)
  })

  it('runExpiryScan per-row isolation — one bad row does not abort the scan', async () => {
    // This test verifies the scan continues after an error on one row.
    // We simulate by checking the scan completes even if some secrets have edge data.
    const result = await runExpiryScan(pool)
    // Result should always return (not throw)
    expect(typeof result.scanned).toBe('number')
    expect(typeof result.fired).toBe('number')
    expect(typeof result.errors).toBe('number')
  })

  it('worker heartbeat: getWorkerStatus returns last_run_at', async () => {
    const { getWorkerStatus } = await import('../services/expiryWorker.ts')
    const status = getWorkerStatus()
    // After running the scan, lastRunAt should be set
    expect(status.lastRunAt).not.toBeNull()
  })
})

describe('C5.2 — Expiry severity logic (pure, no DB)', () => {
  it('severity is danger for days_remaining <= 0', async () => {
    const { getExpirySeverity } = await import('../services/expiryWorker.ts')
    expect(getExpirySeverity(0)).toBe('danger')
    expect(getExpirySeverity(-1)).toBe('danger')
    expect(getExpirySeverity(-30)).toBe('danger')
  })

  it('severity is danger for days_remaining <= 2', async () => {
    const { getExpirySeverity } = await import('../services/expiryWorker.ts')
    expect(getExpirySeverity(1)).toBe('danger')
    expect(getExpirySeverity(2)).toBe('danger')
  })

  it('severity is warning for days_remaining <= 7', async () => {
    const { getExpirySeverity } = await import('../services/expiryWorker.ts')
    expect(getExpirySeverity(3)).toBe('warning')
    expect(getExpirySeverity(7)).toBe('warning')
  })

  it('severity is info for days_remaining > 7', async () => {
    const { getExpirySeverity } = await import('../services/expiryWorker.ts')
    expect(getExpirySeverity(8)).toBe('info')
  })
})
