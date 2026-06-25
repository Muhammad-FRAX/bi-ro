import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { runner } from 'node-pg-migrate'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations')

export async function runMigrations(databaseUrl: string): Promise<void> {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: (msg: string) => {
      if (!msg.includes('No migrations to run')) {
        process.stdout.write(`[migrate] ${msg}\n`)
      }
    },
  })
}
