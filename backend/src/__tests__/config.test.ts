import { describe, it, expect, afterEach } from 'vitest'
import { loadConfig, initConfig, getConfig, _resetConfigForTesting } from '../config.js'

const A_VALID_KEK = Buffer.alloc(32).toString('base64') // all-zero bytes, fine for config unit tests
const validEnv = {
  AUTH_MODE: 'self',
  BIRO_MASTER_KEK: A_VALID_KEK,
  DATABASE_URL: 'postgres://user:pass@localhost:5432/biro',
  SESSION_SECRET: 'a-sufficiently-long-session-secret-at-least-32-chars-ok',
}

describe('loadConfig', () => {
  it('returns a frozen config when all required vars are present', () => {
    const cfg = loadConfig(validEnv)
    expect(cfg.authMode).toBe('self')
    expect(cfg.databaseUrl).toBe(validEnv.DATABASE_URL)
    expect(Object.isFrozen(cfg)).toBe(true)
  })

  it('stores the KEK as a decoded Buffer (not the raw base64 string)', () => {
    const cfg = loadConfig(validEnv)
    expect(Buffer.isBuffer(cfg.kek)).toBe(true)
    expect(cfg.kek.length).toBe(32)
  })

  it('defaults appTitle to "BI Root" when APP_TITLE is not set', () => {
    const cfg = loadConfig(validEnv)
    expect(cfg.appTitle).toBe('BI Root')
  })

  it('uses APP_TITLE from env when provided', () => {
    const cfg = loadConfig({ ...validEnv, APP_TITLE: 'My BI' })
    expect(cfg.appTitle).toBe('My BI')
  })

  it('defaults port to 5000 when PORT is not set', () => {
    const cfg = loadConfig(validEnv)
    expect(cfg.port).toBe(5000)
  })

  it('throws when PORT is not a valid integer', () => {
    expect(() => loadConfig({ ...validEnv, PORT: 'abc' })).toThrow(/PORT/)
  })

  it('throws when BIRO_MASTER_KEK is missing', () => {
    const env = { ...validEnv }
    delete (env as Record<string, string>)['BIRO_MASTER_KEK']
    expect(() => loadConfig(env)).toThrow(/BIRO_MASTER_KEK/)
  })

  it('throws when BIRO_MASTER_KEK decodes to fewer than 32 bytes', () => {
    const env = { ...validEnv, BIRO_MASTER_KEK: Buffer.alloc(16).toString('base64') }
    expect(() => loadConfig(env)).toThrow(/BIRO_MASTER_KEK/)
  })

  it('throws when AUTH_MODE is missing', () => {
    const env = { ...validEnv }
    delete (env as Record<string, string>)['AUTH_MODE']
    expect(() => loadConfig(env)).toThrow(/AUTH_MODE/)
  })

  it('throws when AUTH_MODE is an invalid value', () => {
    expect(() => loadConfig({ ...validEnv, AUTH_MODE: 'password' })).toThrow(/AUTH_MODE/)
  })

  it('throws when DATABASE_URL is missing', () => {
    const env = { ...validEnv }
    delete (env as Record<string, string>)['DATABASE_URL']
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/)
  })

  it('throws when SESSION_SECRET is missing', () => {
    const env = { ...validEnv }
    delete (env as Record<string, string>)['SESSION_SECRET']
    expect(() => loadConfig(env)).toThrow(/SESSION_SECRET/)
  })

  it('redacts KEK, sessionSecret, and databaseUrl password in toJSON output', () => {
    const cfg = loadConfig(validEnv)
    const json = JSON.stringify(cfg)
    const parsed = JSON.parse(json)
    expect(parsed.kek).toBe('[REDACTED]')
    expect(parsed.sessionSecret).toBe('[REDACTED]')
    expect(parsed.authMode).toBe('self')
    expect(parsed.databaseUrl).not.toContain('pass')
    expect(parsed.databaseUrl).toContain('***')
  })
})

describe('initConfig / getConfig singleton', () => {
  afterEach(() => {
    _resetConfigForTesting()
  })

  it('getConfig throws before initConfig is called', () => {
    expect(() => getConfig()).toThrow(/not initialized/)
  })

  it('returns the config after initConfig', () => {
    initConfig(validEnv)
    expect(getConfig().authMode).toBe('self')
  })

  it('initConfig throws if called a second time without reset', () => {
    initConfig(validEnv)
    expect(() => initConfig(validEnv)).toThrow(/already called/)
  })
})
