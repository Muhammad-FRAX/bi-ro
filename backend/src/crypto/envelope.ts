import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

export interface EncryptedPayload {
  ciphertext: Buffer
  iv: Buffer
  authTag: Buffer
  // 60-byte blob: iv(12) || authTag(16) || encrypted_dek(32)
  wrappedDek: Buffer
  keyVersion: string
}

function aesGcmEncrypt(
  plaintext: Buffer,
  key: Buffer,
): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return { ciphertext, iv, authTag }
}

function aesGcmDecrypt(ciphertext: Buffer, key: Buffer, iv: Buffer, authTag: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function packWrappedDek(iv: Buffer, authTag: Buffer, encryptedDek: Buffer): Buffer {
  return Buffer.concat([iv, authTag, encryptedDek])
}

function unpackWrappedDek(
  wrappedDek: Buffer,
): { iv: Buffer; authTag: Buffer; encryptedDek: Buffer } {
  if (wrappedDek.length !== 60) {
    throw new Error(`Invalid wrappedDek length: expected 60 bytes, got ${wrappedDek.length}`)
  }
  return {
    iv: wrappedDek.subarray(0, 12),
    authTag: wrappedDek.subarray(12, 28),
    encryptedDek: wrappedDek.subarray(28),
  }
}

function wrapDekWithKek(dek: Buffer, kek: Buffer): Buffer {
  const { ciphertext, iv, authTag } = aesGcmEncrypt(dek, kek)
  return packWrappedDek(iv, authTag, ciphertext)
}

function unwrapDekWithKek(wrappedDek: Buffer, kek: Buffer): Buffer {
  const { iv, authTag, encryptedDek } = unpackWrappedDek(wrappedDek)
  return aesGcmDecrypt(encryptedDek, kek, iv, authTag)
}

// Encrypt a plaintext string using envelope encryption (KEK wraps DEK, DEK encrypts value)
export function encryptSecret(value: string, kek: Buffer, keyVersion: string): EncryptedPayload {
  const dek = randomBytes(32)
  const plaintext = Buffer.from(value, 'utf8')
  const { ciphertext, iv, authTag } = aesGcmEncrypt(plaintext, dek)
  const wrappedDek = wrapDekWithKek(dek, kek)
  return { ciphertext, iv, authTag, wrappedDek, keyVersion }
}

// Decrypt a stored EncryptedPayload back to plaintext
export function decryptSecret(payload: EncryptedPayload, kek: Buffer): string {
  const dek = unwrapDekWithKek(payload.wrappedDek, kek)
  const plaintext = aesGcmDecrypt(payload.ciphertext, dek, payload.iv, payload.authTag)
  return plaintext.toString('utf8')
}

// Re-wrap the DEK under a new KEK for key rotation — payload ciphertext is untouched
export function rewrapPayload(
  payload: EncryptedPayload,
  oldKek: Buffer,
  newKek: Buffer,
  newKeyVersion: string,
): EncryptedPayload {
  const dek = unwrapDekWithKek(payload.wrappedDek, oldKek)
  const newWrappedDek = wrapDekWithKek(dek, newKek)
  return { ...payload, wrappedDek: newWrappedDek, keyVersion: newKeyVersion }
}

// Generate a random personal vault key — completely independent of the KEK
export function generatePersonalVaultKey(): Buffer {
  return randomBytes(32)
}

// Encrypt for personal vault using a per-user key (not the team KEK)
export function encryptPersonalSecret(
  value: string,
  personalKey: Buffer,
): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
  const plaintext = Buffer.from(value, 'utf8')
  return aesGcmEncrypt(plaintext, personalKey)
}

// Decrypt a personal vault secret using a per-user key
export function decryptPersonalSecret(
  ciphertext: Buffer,
  iv: Buffer,
  authTag: Buffer,
  personalKey: Buffer,
): string {
  const plaintext = aesGcmDecrypt(ciphertext, personalKey, iv, authTag)
  return plaintext.toString('utf8')
}
