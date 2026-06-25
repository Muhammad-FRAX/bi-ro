import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { requestId } from './middleware/requestId.ts'
import { errorHandler } from './middleware/errorHandler.ts'
import healthRouter from './routes/health.ts'
import { initConfig, getConfig } from './config.ts'
import { runMigrations } from './db/migrate.ts'
import { initPool } from './db/pool.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export function createApp(): express.Express {
  const app = express()

  app.use(helmet())
  app.use(cors())
  app.use(requestId)
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  app.use('/api', healthRouter)

  // Static frontend — no-op in dev (dist doesn't exist yet); active in production build
  const frontendDist = join(__dirname, '..', '..', 'frontend', 'dist')
  app.use(express.static(frontendDist))

  app.use(errorHandler)

  return app
}

async function main(): Promise<void> {
  dotenv.config()
  initConfig()
  const cfg = getConfig()

  await runMigrations(cfg.databaseUrl)
  initPool(cfg.databaseUrl)

  const app = createApp()
  app.listen(cfg.port, () => {
    process.stdout.write(`[server] listening on :${cfg.port}\n`)
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: Error) => {
    process.stderr.write(`[fatal] ${err.message}\n`)
    process.exit(1)
  })
}
