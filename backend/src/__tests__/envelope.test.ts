import { randomBytes } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import {
  encryptSecret,
  decryptSecret,
  rewrapPayload,
  generatePersonalVaultKey,
  encryptPersonalSecret,
  decryptPersonalSecret,
} from '../crypto/envelope.ts'

const KEY_VERSION = 'v1'

describe('envelope crypto (C4.1)', () => {
  it('round-trips a secret value through encrypt→decrypt', () => {
    const kek = randomBytes(32)
    const plaintext = 'super-secret-p@ssw0rd!'
    const payload = encryptSecret(plaintext, kek, KEY_VERSION)
    expect(payload.keyVersion).toBe(KEY_VERSION)
    expect(payload.ciphertext).toBeInstanceOf(Buffer)
    expect(payload.wrappedDek).toHaveLength(60)
    const decrypted = decryptSecret(payload, kek)
    expect(decrypted).toBe(plaintext)
  })

  it('round-trips empty string and unicode', () => {
    const kek = randomBytes(32)
    for (const value of ['', 'café ☕', '🔒 secret', 'a'.repeat(1000)]) {
      expect(decryptSecret(encryptSecret(value, kek, KEY_VERSION), kek)).toBe(value)
    }
  })

  it('wrong KEK fails on DEK unwrap (auth-tag mismatch)', () => {
    const kek = randomBytes(32)
    const wrongKek = randomBytes(32)
    const payload = encryptSecret('secret', kek, KEY_VERSION)
    expect(() => decryptSecret(payload, wrongKek)).toThrow()
  })

  it('tampered ciphertext fails auth-tag verification', () => {
    const kek = randomBytes(32)
    const payload = encryptSecret('secret', kek, KEY_VERSION)
    const tampered = { ...payload, ciphertext: Buffer.from(payload.ciphertext) }
    tampered.ciphertext[0] ^= 0xff // flip a bit
    expect(() => decryptSecret(tampered, kek)).toThrow()
  })

  it('tampered authTag fails verification', () => {
    const kek = randomBytes(32)
    const payload = encryptSecret('secret', kek, KEY_VERSION)
    const tampered = { ...payload, authTag: Buffer.from(payload.authTag) }
    tampered.authTag[0] ^= 0xff
    expect(() => decryptSecret(tampered, kek)).toThrow()
  })

  it('KEK re-wrap leaves payload ciphertext and iv unchanged', () => {
    const oldKek = randomBytes(32)
    const newKek = randomBytes(32)
    const plaintext = 'rotate me'
    const payload = encryptSecret(plaintext, oldKek, KEY_VERSION)
    const rotated = rewrapPayload(payload, oldKek, newKek, 'v2')
    // Payload ciphertext and iv are byte-identical
    expect(rotated.ciphertext.equals(payload.ciphertext)).toBe(true)
    expect(rotated.iv.equals(payload.iv)).toBe(true)
    expect(rotated.authTag.equals(payload.authTag)).toBe(true)
    // But wrappedDek is different (new KEK)
    expect(rotated.wrappedDek.equals(payload.wrappedDek)).toBe(false)
    expect(rotated.keyVersion).toBe('v2')
    // New KEK can still decrypt
    expect(decryptSecret(rotated, newKek)).toBe(plaintext)
    // Old KEK no longer works on the rotated payload
    expect(() => decryptSecret(rotated, oldKek)).toThrow()
  })

  it('personal vault key is independent — cannot decrypt with team KEK', () => {
    const teamKek = randomBytes(32)
    const personalKey = generatePersonalVaultKey()
    // Ensure the keys are different
    expect(personalKey.equals(teamKek)).toBe(false)

    const value = 'my-personal-secret'
    const { ciphertext, iv, authTag } = encryptPersonalSecret(value, personalKey)

    // Correct personal key decrypts fine
    expect(decryptPersonalSecret(ciphertext, iv, authTag, personalKey)).toBe(value)

    // Team KEK cannot decrypt the personal-vault ciphertext
    expect(() => decryptPersonalSecret(ciphertext, iv, authTag, teamKek)).toThrow()
  })

  it('personal vault round-trip: encrypt and decrypt with personal key', () => {
    const personalKey = generatePersonalVaultKey()
    const value = 'personal credential 123'
    const { ciphertext, iv, authTag } = encryptPersonalSecret(value, personalKey)
    expect(decryptPersonalSecret(ciphertext, iv, authTag, personalKey)).toBe(value)
  })

  it('generates unique DEKs per encryption (no key reuse)', () => {
    const kek = randomBytes(32)
    const p1 = encryptSecret('same', kek, KEY_VERSION)
    const p2 = encryptSecret('same', kek, KEY_VERSION)
    // Different DEKs → different wrappedDeks
    expect(p1.wrappedDek.equals(p2.wrappedDek)).toBe(false)
    // Different IVs
    expect(p1.iv.equals(p2.iv)).toBe(false)
  })
})
