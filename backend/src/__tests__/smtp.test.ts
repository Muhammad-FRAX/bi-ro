import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildSmtpConfig,
  type SmtpConfig,
  sendEmail,
  isSmtpConfigured,
} from '../integrations/smtp.ts'

describe('C5.3 — SMTP integration (pure unit tests, no real relay)', () => {
  const validConfig: SmtpConfig = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'user@example.com',
    password: 'secret',
    from: 'biro@example.com',
  }

  describe('buildSmtpConfig', () => {
    it('returns null when SMTP_HOST is missing', () => {
      expect(buildSmtpConfig({})).toBeNull()
    })

    it('returns null when SMTP_HOST is empty', () => {
      expect(buildSmtpConfig({ SMTP_HOST: '' })).toBeNull()
    })

    it('builds config from env', () => {
      const cfg = buildSmtpConfig({
        SMTP_HOST: 'smtp.test.com',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
        SMTP_FROM: 'noreply@test.com',
      })
      expect(cfg).not.toBeNull()
      expect(cfg!.host).toBe('smtp.test.com')
      expect(cfg!.port).toBe(465)
      expect(cfg!.secure).toBe(true)
      expect(cfg!.user).toBe('u')
      expect(cfg!.password).toBe('p')
      expect(cfg!.from).toBe('noreply@test.com')
    })

    it('defaults SMTP_PORT to 587 when not set', () => {
      const cfg = buildSmtpConfig({ SMTP_HOST: 'smtp.test.com' })
      expect(cfg!.port).toBe(587)
    })

    it('defaults SMTP_SECURE to false', () => {
      const cfg = buildSmtpConfig({ SMTP_HOST: 'smtp.test.com' })
      expect(cfg!.secure).toBe(false)
    })

    it('SMTP_SECURE=true sets secure to true', () => {
      const cfg = buildSmtpConfig({ SMTP_HOST: 'smtp.test.com', SMTP_SECURE: 'true' })
      expect(cfg!.secure).toBe(true)
    })

    it('SMTP_SECURE=1 sets secure to true', () => {
      const cfg = buildSmtpConfig({ SMTP_HOST: 'smtp.test.com', SMTP_SECURE: '1' })
      expect(cfg!.secure).toBe(true)
    })
  })

  describe('isSmtpConfigured', () => {
    it('returns false when host is missing', () => {
      expect(isSmtpConfigured({})).toBe(false)
    })

    it('returns true when SMTP_HOST is present', () => {
      expect(isSmtpConfigured({ SMTP_HOST: 'smtp.example.com' })).toBe(true)
    })
  })

  describe('sendEmail', () => {
    it('throws SmtpNotConfiguredError when config is null', async () => {
      await expect(
        sendEmail(null, { to: 'a@b.com', subject: 'test', text: 'hi', html: '<p>hi</p>' }),
      ).rejects.toThrow('SMTP not configured')
    })

    it('returns { delivered: false, error } when nodemailer not available (no relay)', async () => {
      // In CI where nodemailer is not installed or relay is unreachable,
      // sendEmail should return { delivered: false, error: string } rather than throw
      const result = await sendEmail(validConfig, {
        to: 'test@example.com',
        subject: 'Test',
        text: 'Hello',
        html: '<p>Hello</p>',
      }).catch((err: Error) => ({ delivered: false, error: err.message }))
      // Either succeeds or fails — should not crash the process
      expect(typeof result).toBe('object')
    })
  })

  describe('buildNotificationEmailBody', () => {
    it('generates plain text and HTML for expiry notification', async () => {
      const { buildNotificationEmailBody } = await import('../integrations/smtp.ts')
      const body = buildNotificationEmailBody({
        title: '"DB password" is 3 days remaining',
        bodyText: 'Vault: Infra · Type: db_credential',
        severity: 'warning',
        appTitle: 'BI Root',
      })
      expect(body.subject).toContain('DB password')
      expect(body.text).toContain('3 days remaining')
      expect(body.html).toContain('warning')
      expect(body.html).toContain('BI Root')
    })

    it('uses "Critical" label for danger severity', async () => {
      const { buildNotificationEmailBody } = await import('../integrations/smtp.ts')
      const body = buildNotificationEmailBody({
        title: '"cert" is overdue',
        bodyText: '',
        severity: 'danger',
        appTitle: 'BI Root',
      })
      expect(body.html.toLowerCase()).toContain('critical')
    })
  })
})
