/**
 * Weekly digest worker — §4.5, §5
 * Builds and (optionally) emails a weekly summary of fleet state + expiring items.
 * Reads ONLY BI-Ro's own database.
 */

import type { Pool } from 'pg'
import { buildSmtpConfig, buildNotificationEmailBody, sendNotificationEmail } from '../integrations/smtp.ts'
import { createNotification } from '../routes/notifications.ts'
import { logger } from '../util/logger.ts'

interface ExpiringItemRow {
  title: string
  vault_name: string
  days_remaining: number | null
  type: string
}

export interface DigestSummary {
  expiringCount: number
  overdueCount: number
  totalServers: number
  items: ExpiringItemRow[]
  text: string
  html: string
}

export async function buildWeeklyDigest(pool: Pool, appTitle: string): Promise<DigestSummary> {
  // Secrets expiring within 7 days (includes overdue)
  const { rows: expiringRows } = await pool.query<ExpiringItemRow>(
    `SELECT s.title, v.name AS vault_name, s.type,
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
       AND (
         (s.expires_at IS NOT NULL AND s.expires_at <= now() + interval '7 days')
         OR
         (s.rotation_period_days IS NOT NULL AND s.last_changed_at IS NOT NULL
          AND s.last_changed_at + (s.rotation_period_days * interval '1 day') <= now() + interval '7 days')
       )
     ORDER BY days_remaining ASC NULLS LAST
     LIMIT 50`,
  )

  const { rows: serverCountRows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM servers WHERE deleted_at IS NULL`,
  )

  const totalServers = parseInt(serverCountRows[0]?.count ?? '0', 10)
  const overdueCount = expiringRows.filter((r) => Number(r.days_remaining ?? 0) <= 0).length
  const expiringCount = expiringRows.filter(
    (r) => Number(r.days_remaining ?? 0) > 0 && Number(r.days_remaining ?? 0) <= 7,
  ).length

  const text = buildDigestText({ appTitle, totalServers, overdueCount, expiringCount, items: expiringRows })
  const html = buildDigestHtml({ appTitle, totalServers, overdueCount, expiringCount, items: expiringRows })

  return { expiringCount, overdueCount, totalServers, items: expiringRows, text, html }
}

function buildDigestText({
  appTitle,
  totalServers,
  overdueCount,
  expiringCount,
  items,
}: {
  appTitle: string
  totalServers: number
  overdueCount: number
  expiringCount: number
  items: ExpiringItemRow[]
}): string {
  const lines: string[] = [
    `${appTitle} — Weekly Digest`,
    '─'.repeat(40),
    `Fleet: ${totalServers} server(s) documented`,
    `Credentials: ${overdueCount} overdue, ${expiringCount} expiring within 7 days`,
    '',
  ]

  if (items.length === 0) {
    lines.push("All credentials are current. Nothing expiring this week.")
  } else {
    lines.push('Items needing attention:')
    for (const item of items) {
      const daysNum = Number(item.days_remaining ?? 0)
      const status = daysNum <= 0 ? 'OVERDUE' : `${Math.round(daysNum)}d remaining`
      lines.push(`  • ${item.title} [${item.vault_name}] — ${status}`)
    }
  }

  return lines.join('\n')
}

function buildDigestHtml({
  appTitle,
  totalServers,
  overdueCount,
  expiringCount,
  items,
}: {
  appTitle: string
  totalServers: number
  overdueCount: number
  expiringCount: number
  items: ExpiringItemRow[]
}): string {
  const rows = items
    .map((item) => {
      const daysNum = Number(item.days_remaining ?? 0)
      const status = daysNum <= 0 ? 'Overdue' : `${Math.round(daysNum)}d remaining`
      const color = daysNum <= 0 ? '#f87171' : daysNum <= 2 ? '#f87171' : '#fbbf24'
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.06);color:#e7e7ee;font-size:13px">${escapeHtml(item.title)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.06);color:#9a9aa8;font-size:13px">${escapeHtml(item.vault_name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:13px;font-weight:600;color:${color}">${status}</td>
      </tr>`
    })
    .join('\n')

  const bodyText = items.length === 0
    ? "All credentials are current. Nothing expiring this week."
    : `${overdueCount} overdue · ${expiringCount} expiring within 7 days`

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#0b0b10;color:#e7e7ee;padding:24px">
  <div style="max-width:600px;margin:0 auto;background:#131320;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:24px">
    <h1 style="margin:0 0 4px;font-size:18px;font-weight:700;color:#e7e7ee">${escapeHtml(appTitle)}</h1>
    <p style="margin:0 0 20px;font-size:12px;color:#6e6e7e">Weekly Fleet Digest</p>

    <div style="display:flex;gap:16px;margin-bottom:24px">
      <div style="background:#1a1a2a;border-radius:8px;padding:12px 16px;flex:1">
        <p style="margin:0 0 2px;font-size:11px;color:#6e6e7e;text-transform:uppercase;letter-spacing:.06em">Servers</p>
        <p style="margin:0;font-size:20px;font-weight:600;color:#e7e7ee">${totalServers}</p>
      </div>
      <div style="background:#1a1a2a;border-radius:8px;padding:12px 16px;flex:1">
        <p style="margin:0 0 2px;font-size:11px;color:#6e6e7e;text-transform:uppercase;letter-spacing:.06em">Overdue</p>
        <p style="margin:0;font-size:20px;font-weight:600;color:${overdueCount > 0 ? '#f87171' : '#34d399'}">${overdueCount}</p>
      </div>
      <div style="background:#1a1a2a;border-radius:8px;padding:12px 16px;flex:1">
        <p style="margin:0 0 2px;font-size:11px;color:#6e6e7e;text-transform:uppercase;letter-spacing:.06em">Expiring ≤7d</p>
        <p style="margin:0;font-size:20px;font-weight:600;color:${expiringCount > 0 ? '#fbbf24' : '#34d399'}">${expiringCount}</p>
      </div>
    </div>

    ${items.length > 0 ? `
    <h2 style="margin:0 0 12px;font-size:14px;font-weight:600;color:#e7e7ee">Items needing attention</h2>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px 8px;font-size:11px;color:#6e6e7e;font-weight:500;text-transform:uppercase;letter-spacing:.04em">Credential</th>
          <th style="text-align:left;padding:6px 8px;font-size:11px;color:#6e6e7e;font-weight:500;text-transform:uppercase;letter-spacing:.04em">Vault</th>
          <th style="text-align:left;padding:6px 8px;font-size:11px;color:#6e6e7e;font-weight:500;text-transform:uppercase;letter-spacing:.04em">Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>` : `<p style="font-size:14px;color:#34d399;font-weight:500">All credentials are current. Nothing expiring this week.</p>`}

    <p style="margin:24px 0 0;font-size:11px;color:#6e6e7e">${bodyText} · Sent by ${escapeHtml(appTitle)}</p>
  </div>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Start the weekly digest cron (Mondays at 09:00) */
export function startDigestWorker(pool: Pool): void {
  import('node-cron').then(({ default: cron }) => {
    cron.schedule('0 9 * * 1', async () => {
      try {
        // Load config from DB settings
        const { rows: smtpRows } = await pool.query<{ value: Record<string, string | number | boolean> }>(
          `SELECT value FROM settings WHERE key = 'smtp'`,
        )
        const smtpCfg = smtpRows[0]?.value
        const { rows: titleRows } = await pool.query<{ value: string }>(
          `SELECT value FROM settings WHERE key = 'appTitle'`,
        )
        const appTitle = String(titleRows[0]?.value ?? '"BI Root"').replace(/^"|"$/g, '')
        const { rows: digestRecipientRows } = await pool.query<{ email: string }>(
          `SELECT u.email FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
           WHERE r.name = 'admin' AND u.status = 'active' AND u.deleted_at IS NULL`,
        )

        const digest = await buildWeeklyDigest(pool, appTitle)

        // Create in-app notification
        const notifId = await createNotification(pool, {
          type: 'system',
          severity: digest.overdueCount > 0 ? 'warning' : 'info',
          title: `Weekly digest: ${digest.overdueCount} overdue, ${digest.expiringCount} expiring`,
          body: `${digest.totalServers} servers documented.`,
        })

        // Send email to all admins if SMTP configured
        if (smtpCfg && smtpCfg['host']) {
          const config = buildSmtpConfig({
            SMTP_HOST: String(smtpCfg['host'] ?? ''),
            SMTP_PORT: String(smtpCfg['port'] ?? '587'),
            SMTP_SECURE: smtpCfg['secure'] ? '1' : '0',
            SMTP_USER: smtpCfg['user'] != null ? String(smtpCfg['user']) : undefined,
            SMTP_PASS: smtpCfg['password'] != null ? String(smtpCfg['password']) : undefined,
            SMTP_FROM: smtpCfg['from'] != null ? String(smtpCfg['from']) : undefined,
          })
          for (const admin of digestRecipientRows) {
            await sendNotificationEmail(pool, config, {
              notificationId: notifId,
              title: `Weekly digest — ${appTitle}`,
              body: digest.text,
              severity: digest.overdueCount > 0 ? 'warning' : 'info',
              recipient: admin.email,
              appTitle,
            })
          }
        }

        logger.info({ expiringCount: digest.expiringCount, overdueCount: digest.overdueCount }, 'digest worker: sent')
      } catch (err) {
        logger.error({ err }, 'digest worker: failed')
      }
    })
    logger.info('digest worker: scheduled (0 9 * * 1)')
  }).catch((err: unknown) => {
    logger.warn({ err }, 'digest worker: node-cron not available; digest not started')
  })
}
