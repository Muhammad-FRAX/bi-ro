import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import type { Pool } from 'pg'
import { requestId } from './middleware/requestId.ts'
import { errorHandler } from './middleware/errorHandler.ts'
import { createSessionMiddleware } from './middleware/session.ts'
import healthRouter from './routes/health.ts'
import { authRouter } from './routes/auth.ts'
import { initConfig, getConfig } from './config.ts'
import { runMigrations } from './db/migrate.ts'
import { initPool, getPool } from './db/pool.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface AppOptions {
  pool: Pool
  sessionSecret: string
  secureCookie?: boolean
}

// createApp: accepts optional opts. When omitted (unit tests), auth middleware is skipped.
export function createApp(opts?: AppOptions): express.Express {
  const app = express()

  app.use(helmet())
  app.use(cors())
  app.use(requestId)
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  if (opts) {
    app.use(createSessionMiddleware({ secret: opts.sessionSecret, secure: opts.secureCookie }))
    app.use('/api', authRouter(opts.pool))
  }

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

  const app = createApp({
    pool: getPool(),
    sessionSecret: cfg.sessionSecret,
    secureCookie: cfg.nodeEnv === 'production',
  })

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
