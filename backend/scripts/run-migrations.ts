import { runMigrations } from '../src/db/migrate.js'

const databaseUrl = process.env['DATABASE_URL'] ?? 'postgres://biro:biro_password@localhost:5433/biro'

console.log('[run-migrations] Running migrations...')
runMigrations(databaseUrl)
  .then(() => {
    console.log('[run-migrations] Done.')
    process.exit(0)
  })
  .catch((err) => {
    console.error('[run-migrations] Failed:', err.message)
    process.exit(1)
  })
