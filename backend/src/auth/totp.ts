/**
 * TOTP helpers for self-auth mode (C7.4).
 * Uses otplib (RFC 6238 TOTP, SHA-1, 6 digits, 30-second window).
 *
 * Enrollment flow:
 *   1. POST /auth/totp/enroll  → returns { secret, otpauthUri }
 *   2. User scans QR / copies secret into authenticator app
 *   3. POST /auth/totp/activate { code } → verifies code, sets totp_enabled=true
 *
 * Login flow (if totp_enabled):
 *   POST /auth/login { email, password, totpCode }
 *   The SelfAuthProvider checks the code after password verification.
 *
 * Step-up:
 *   POST /secrets/:id/reveal { totpCode } (password optional if TOTP enrolled)
 */

let _authenticator: typeof import('otplib').authenticator | undefined

async function getAuthenticator(): Promise<typeof import('otplib').authenticator> {
  if (!_authenticator) {
    const mod = await import('otplib')
    _authenticator = mod.authenticator
    // Allow 1-step tolerance (±30s) to handle slight clock drift
    _authenticator.options = { window: 1 }
  }
  return _authenticator
}

/** Generate a new Base32 TOTP secret (20 bytes = 32 Base32 characters). */
export async function generateTotpSecret(): Promise<string> {
  const auth = await getAuthenticator()
  return auth.generateSecret(20)
}

/**
 * Build the otpauth:// URI used by authenticator apps (Google Authenticator, Authy, etc.).
 * The frontend can display this as text or render it as a QR code.
 */
export async function buildOtpauthUri(secret: string, email: string, appTitle: string): Promise<string> {
  const auth = await getAuthenticator()
  return auth.keyuri(email, appTitle, secret)
}

/** Verify a 6-digit TOTP code against a stored secret. Returns true on match. */
export async function verifyTotpCode(code: string, secret: string): Promise<boolean> {
  if (!code || !secret) return false
  try {
    const auth = await getAuthenticator()
    return auth.verify({ token: code.replace(/\s/g, ''), secret })
  } catch {
    return false
  }
}
