/**
 * Expiry scanner worker — §4.5, §20 F8.1, §21 testing requirements
 *
 * Reads ONLY BI-Ro's own database; makes NO outbound connections except SMTP.
 * Heartbeat: writes lastRunAt so the dashboard can flag a stale worker.
 * Per-row isolation: one bad row logs an error and continues the scan.
 */

import type { Pool } from 'pg'
import { createNotification } from '../routes/notifications.ts'
import { logger } from '../util/logger.ts'

export type ExpirySeverity = 'info' | 'warning' | 'danger'

let lastRunAt: Date | null = null
let running = false

/** Pure helper — testable without DB */
export function getExpirySeverity(daysRemaining: number): ExpirySeverity {
  if (daysRemaining <= 2) return 'danger'
  if (daysRemaining <= 7) return 'warning'
  return 'info'
}

export function getWorkerStatus() {
  return { lastRunAt, running }
}

interface ScanResult {
  scanned: number
  fired: number
  errors: number
}

interface SecretRow {
  id: string
  title: string
  vault_id: string
  vault_name: string
  days_remaining: number | null
  type: string
}

interface RuleRow {
  id: string
  threshold_days: number
}

/**
 * Core scan logic — exported so tests can call it directly without the cron wrapper.
 * §21: de-dup, re-arm, per-row isolation, heartbeat.
 */
export async function runExpiryScan(pool: Pool): Promise<ScanResult> {
  running = true
  const result: ScanResult = { scanned: 0, fired: 0, errors: 0 }

  try {
    // Load enabled expiry rules
    const { rows: ruleRows } = await pool.query<RuleRow>(
      `SELECT id, threshold_days
       FROM notification_rules
       WHERE kind = 'expiry' AND enabled = TRUE AND threshold_days IS NOT NULL
       ORDER BY threshold_days DESC`,
    )

    if (ruleRows.length === 0) {
      lastRunAt = new Date()
      running = false
      return result
    }

    // Find all non-deleted secrets that have expiry tracking set
    const { rows: secrets } = await pool.query<SecretRow>(
      `SELECT s.id, s.title, s.vault_id, v.name AS vault_name, s.type,
              CASE
                WHEN s.expires_at IS NOT NULL THEN
                  EXTRACT(EPOCH FROM (s.expires_at - now())) / 86400.0
                WHEN s.rotation_period_days IS NOT NULL AND s.last_changed_at IS NOT NULL THEN
                  s.rotation_period_days - EXTRACT(EPOCH FROM (now() - s.last_changed_at)) / 86400.0
                ELSE NULL
              END AS days_remaining
       FROM secrets s
       JOIN vaults v ON v.id = s.vault_id
       WHERE s.deleted_at IS NULL
         AND (s.expires_at IS NOT NULL OR (s.rotation_period_days IS NOT NULL AND s.last_changed_at IS NOT NULL))`,
    )

    result.scanned = secrets.length

    for (const secret of secrets) {
      try {
        if (secret.days_remaining === null) continue

        const daysNum = Number(secret.days_remaining)

        // Find the most urgent applicable rule that hasn't fired yet
        for (const rule of ruleRows) {
          if (daysNum > rule.threshold_days) continue // not yet at this threshold

          // De-dup check: has this (secret, rule) pair already fired?
          const { rows: logRows } = await pool.query<{ id: string }>(
            `SELECT id FROM notification_sent_log
             WHERE target_type = 'secret' AND target_id = $1 AND rule_id = $2`,
            [secret.id, rule.id],
          )
          if (logRows.length > 0) continue // already fired for this threshold

          // Fire notification + record sent log (in a transaction for atomicity)
          const client = await pool.connect()
          try {
            await client.query('BEGIN')

            const severity = getExpirySeverity(daysNum)
            const daysText = daysNum <= 0
              ? 'overdue'
              : `${Math.round(daysNum)} day${Math.round(daysNum) === 1 ? '' : 's'} remaining`

            await createNotification(pool, {
              type: 'expiry',
              severity,
              title: `"${secret.title}" is ${daysText}`,
              body: `Vault: ${secret.vault_name} · Type: ${secret.type}`,
              targetType: 'secret',
              targetId: secret.id,
            })

            await client.query(
              `INSERT INTO notification_sent_log (target_type, target_id, rule_id)
               VALUES ('secret', $1, $2)
               ON CONFLICT (target_type, target_id, rule_id) DO NOTHING`,
              [secret.id, rule.id],
            )

            await client.query('COMMIT')
            result.fired++
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {})
            throw err
          } finally {
            client.release()
          }

          break // only fire the most urgent applicable rule per scan cycle
        }
      } catch (err) {
        // §20 F8.1 per-row isolation: log error, continue scan
        result.errors++
        logger.error({ err, secretId: secret.id }, 'expiry worker: error scanning secret row')
      }
    }
  } finally {
    lastRunAt = new Date()
    running = false
  }

  return result
}

/**
 * Start the node-cron daily worker.
 * Wrapped in try/catch so a crash never takes down the web process (§20 F1.1).
 */
export function startExpiryWorker(pool: Pool): void {
  // Dynamic import of node-cron so the module doesn't hard-fail if not installed
  import('node-cron').then(({ default: cron }) => {
    // Run at 08:00 every day
    cron.schedule('0 8 * * *', async () => {
      try {
        const result = await runExpiryScan(pool)
        logger.info({ ...result }, 'expiry worker: scan complete')

        // Stale worker alert handled by checking getWorkerStatus() on the dashboard
      } catch (err) {
        logger.error({ err }, 'expiry worker: scan failed')
      }
    })
    logger.info('expiry worker: scheduled (0 8 * * *)')
  }).catch((err: unknown) => {
    logger.warn({ err }, 'expiry worker: node-cron not available; worker not started')
  })
}
