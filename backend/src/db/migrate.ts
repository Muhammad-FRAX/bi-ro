import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { runner } from 'node-pg-migrate'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Resolve the migrations directory across layouts:
//  - dev (tsx):       src/db/migrate.ts  -> ../../migrations  (backend/migrations)
//  - prod (bundled):  dist/server.js     -> ../migrations     (/app/migrations)
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ??
  [
    join(__dirname, '..', '..', 'migrations'),
    join(__dirname, '..', 'migrations'),
    join(process.cwd(), 'migrations'),
  ].find(existsSync) ??
  join(__dirname, '..', '..', 'migrations')

export async function runMigrations(databaseUrl: string): Promise<void> {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: (msg: string) => {
      if (msg.includes('No migrations to run') || msg.includes("Can't determine timestamp")) return
      process.stdout.write(`[migrate] ${msg}\n`)
    },
  })
}
