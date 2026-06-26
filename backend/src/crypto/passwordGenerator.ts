import { randomBytes } from 'node:crypto'

const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?'

// Pronounceable syllables for the 'pronounceable' mode
const CONSONANTS = 'bcdfghjklmnpqrstvwxyz'
const VOWELS = 'aeiou'

export interface PasswordOptions {
  length?: number
  charset?: 'alphanumeric' | 'symbols' | 'pronounceable'
}

// Returns a cryptographically random integer in [0, max)
function randomInt(max: number): number {
  if (max <= 0) throw new Error('max must be > 0')
  // Rejection sampling to avoid bias
  const byteCount = Math.ceil(Math.log2(max) / 8) + 1
  const limit = Math.floor(256 ** byteCount / max) * max
  let value: number
  do {
    const bytes = randomBytes(byteCount)
    value = 0
    for (const b of bytes) value = value * 256 + b
  } while (value >= limit)
  return value % max
}

function pickChar(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)]!
}

function shuffle(arr: string[]): string[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr
}

export function generatePassword(opts: PasswordOptions = {}): string {
  const length = Math.max(8, Math.min(128, opts.length ?? 20))
  const charset = opts.charset ?? 'symbols'

  if (charset === 'pronounceable') {
    return generatePronounceable(length)
  }

  const alphabet = charset === 'symbols'
    ? LOWER + UPPER + DIGITS + SYMBOLS
    : LOWER + UPPER + DIGITS

  // Guarantee at least one of each required category
  const required = charset === 'symbols'
    ? [
        pickChar(LOWER),
        pickChar(UPPER),
        pickChar(DIGITS),
        pickChar(SYMBOLS),
      ]
    : [pickChar(LOWER), pickChar(UPPER), pickChar(DIGITS)]

  const rest = Array.from({ length: length - required.length }, () => pickChar(alphabet))
  return shuffle([...required, ...rest]).join('')
}

function generatePronounceable(length: number): string {
  // Alternating consonant-vowel pairs with occasional digits
  const chars: string[] = []
  let i = 0
  while (chars.length < length) {
    if (i % 2 === 0) {
      chars.push(pickChar(CONSONANTS))
    } else {
      chars.push(pickChar(VOWELS))
    }
    // Insert a digit every ~6 chars
    if (chars.length % 6 === 5 && chars.length < length) {
      chars.push(pickChar(DIGITS))
    }
    i++
  }
  return chars.slice(0, length).join('')
}
