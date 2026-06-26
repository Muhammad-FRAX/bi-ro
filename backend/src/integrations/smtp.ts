/**
 * SMTP integration — §4.5
 * Wraps nodemailer with a typed interface.
 * nodemailer is dynamically imported so the server boots even if not installed.
 */

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user?: string
  password?: string
  from: string
}

export interface EmailPayload {
  to: string
  subject: string
  text: string
  html: string
}

export interface SendResult {
  delivered: boolean
  error?: string
  messageId?: string
}

export class SmtpNotConfiguredError extends Error {
  constructor() {
    super('SMTP not configured')
    this.name = 'SmtpNotConfiguredError'
  }
}

export function buildSmtpConfig(env: Record<string, string | undefined>): SmtpConfig | null {
  const host = env['SMTP_HOST']
  if (!host || !host.trim()) return null

  const port = parseInt(env['SMTP_PORT'] ?? '587', 10)
  const secureRaw = env['SMTP_SECURE'] ?? ''
  const secure = secureRaw === 'true' || secureRaw === '1'
  const user = env['SMTP_USER']
  const password = env['SMTP_PASS']
  const from = env['SMTP_FROM'] ?? (user ?? `noreply@${host}`)

  return { host: host.trim(), port, secure, user, password, from }
}

export function isSmtpConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean(env['SMTP_HOST']?.trim())
}

export async function sendEmail(
  config: SmtpConfig | null,
  payload: EmailPayload,
): Promise<SendResult> {
  if (!config) throw new SmtpNotConfiguredError()

  try {
    // Dynamic import — graceful failure if nodemailer not installed
    const nodemailer = await import('nodemailer').catch(() => null)
    if (!nodemailer) {
      return { delivered: false, error: 'nodemailer not installed' }
    }

    const transporter = nodemailer.default.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user
        ? { user: config.user, pass: config.password }
        : undefined,
    })

    const info = await transporter.sendMail({
      from: config.from,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    })

    return { delivered: true, messageId: String(info.messageId) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { delivered: false, error: message }
  }
}

export function buildNotificationEmailBody({
  title,
  bodyText,
  severity,
  appTitle,
}: {
  title: string
  bodyText: string
  severity: 'info' | 'warning' | 'danger'
  appTitle: string
}): { subject: string; text: string; html: string } {
  const severityLabel =
    severity === 'danger' ? 'Critical' : severity === 'warning' ? 'Warning' : 'Info'
  const accentColor =
    severity === 'danger' ? '#f87171' : severity === 'warning' ? '#fbbf24' : '#a78bfa'

  const subject = `[${appTitle}] ${severityLabel}: ${title}`
  const text = `${severityLabel}: ${title}\n\n${bodyText}\n\nThis notification was sent by ${appTitle}.`
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#0b0b10;color:#e7e7ee;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#131320;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:24px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${accentColor}"></span>
      <span style="font-size:11px;font-weight:600;color:${accentColor};text-transform:uppercase;letter-spacing:0.06em">${severityLabel}</span>
    </div>
    <h2 style="margin:0 0 8px;font-size:16px;font-weight:600;color:#e7e7ee">${escapeHtml(title)}</h2>
    ${bodyText ? `<p style="margin:0 0 16px;font-size:13px;color:#9a9aa8">${escapeHtml(bodyText)}</p>` : ''}
    <p style="margin:0;font-size:11px;color:#6e6e7e">Sent by ${escapeHtml(appTitle)}</p>
  </div>
</body>
</html>`

  return { subject, text, html }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Send email notification for a fired notification.
 * Records delivery in notification_deliveries table.
 */
export async function sendNotificationEmail(
  pool: import('pg').Pool,
  config: SmtpConfig | null,
  {
    notificationId,
    title,
    body,
    severity,
    recipient,
    appTitle,
  }: {
    notificationId: string
    title: string
    body: string
    severity: 'info' | 'warning' | 'danger'
    recipient: string
    appTitle: string
  },
): Promise<void> {
  const emailBody = buildNotificationEmailBody({ title, bodyText: body, severity, appTitle })

  const result = await sendEmail(config, {
    to: recipient,
    subject: emailBody.subject,
    text: emailBody.text,
    html: emailBody.html,
  }).catch((err: Error) => ({ delivered: false, error: err.message }))

  await pool.query(
    `INSERT INTO notification_deliveries (notification_id, channel, recipient, status, error, sent_at)
     VALUES ($1, 'email', $2, $3, $4, $5)`,
    [
      notificationId,
      recipient,
      result.delivered ? 'sent' : 'failed',
      result.delivered ? null : (result.error ?? 'unknown error'),
      result.delivered ? new Date() : null,
    ],
  )
}
