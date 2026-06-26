// Client-side password generator using Web Crypto API
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?'
const CONSONANTS = 'bcdfghjklmnpqrstvwxyz'
const VOWELS = 'aeiou'

export interface PasswordOptions {
  length?: number
  charset?: 'alphanumeric' | 'symbols' | 'pronounceable'
}

function randomInt(max: number): number {
  const arr = new Uint32Array(1)
  let value: number
  const limit = Math.floor(0x100000000 / max) * max
  do {
    crypto.getRandomValues(arr)
    value = arr[0]!
  } while (value >= limit)
  return value % max
}

function pickChar(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)]!
}

function shuffle<T>(arr: T[]): T[] {
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

  const required = charset === 'symbols'
    ? [pickChar(LOWER), pickChar(UPPER), pickChar(DIGITS), pickChar(SYMBOLS)]
    : [pickChar(LOWER), pickChar(UPPER), pickChar(DIGITS)]

  const rest = Array.from({ length: length - required.length }, () => pickChar(alphabet))
  return shuffle([...required, ...rest]).join('')
}

function generatePronounceable(length: number): string {
  const chars: string[] = []
  let i = 0
  while (chars.length < length) {
    chars.push(i % 2 === 0 ? pickChar(CONSONANTS) : pickChar(VOWELS))
    if (chars.length % 6 === 5 && chars.length < length) chars.push(pickChar(DIGITS))
    i++
  }
  return chars.slice(0, length).join('')
}
