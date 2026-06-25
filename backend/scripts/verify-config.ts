import { randomBytes } from 'crypto'
import { loadConfig } from '../src/config.js'

const label = process.argv[2] ?? 'test'

if (label === 'missing') {
  try {
    loadConfig({})
    console.error('FAIL — should have thrown')
    process.exit(1)
  } catch (e) {
    console.log(`OK (missing env throws): ${(e as Error).message.slice(0, 80)}`)
  }
} else if (label === 'present') {
  const kek = randomBytes(32).toString('base64')
  try {
    const cfg = loadConfig({
      AUTH_MODE: 'self',
      BIRO_MASTER_KEK: kek,
      DATABASE_URL: 'postgres://localhost/biro',
    })
    console.log(`OK (valid env succeeds): authMode=${cfg.authMode}, appTitle=${cfg.appTitle}`)
  } catch (e) {
    console.error('FAIL:', e)
    process.exit(1)
  }
}
