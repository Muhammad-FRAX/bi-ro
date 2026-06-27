import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import type { Pool } from 'pg'
import { requestId } from './middleware/requestId.ts'
import { errorHandler } from './middleware/errorHandler.ts'
import { createSessionMiddleware } from './middleware/session.ts'
import { setupGuard } from './middleware/setupGuard.ts'
import { SelfAuthProvider } from './auth/selfProvider.ts'
import { KeycloakProvider } from './auth/keycloakProvider.ts'
import { LdapProvider } from './auth/ldapProvider.ts'
import healthRouter from './routes/health.ts'
import { authRouter } from './routes/auth.ts'
import { keycloakAuthRouter } from './routes/keycloakAuth.ts'
import { setupRouter } from './routes/setup.ts'
import { adminRouter } from './routes/admin.ts'
import { serversRouter } from './routes/servers.ts'
import { appsRouter } from './routes/apps.ts'
import { connectionsRouter } from './routes/connections.ts'
import { topologyRouter } from './routes/topology.ts'
import { fsRouter } from './routes/fs.ts'
import { vaultRouter } from './routes/vault.ts'
import { revealRouter } from './middleware/stepUp.ts'
import { notificationsRouter } from './routes/notifications.ts'
import { documentsRouter } from './routes/documents.ts'
import { personalVaultRouter } from './routes/personalVault.ts'
import { v1Router } from './routes/v1.ts'
import { searchRouter } from './routes/search.ts'
import { recycleBinRouter } from './routes/recycleBin.ts'
import { backupRouter } from './routes/backup.ts'
import { startExpiryWorker } from './services/expiryWorker.ts'
import { startDigestWorker } from './services/digestWorker.ts'
import { initConfig, getConfig, type KeycloakConfig, type LdapConfig } from './config.ts'
import { runMigrations } from './db/migrate.ts'
import { initPool, getPool } from './db/pool.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface AppOptions {
  pool: Pool
  sessionSecret: string
  secureCookie?: boolean
  adminEmail?: string
  adminPassword?: string
  authMode?: 'self' | 'keycloak' | 'ldap'
  uploadsDir?: string
  keycloak?: KeycloakConfig
  ldap?: LdapConfig
}

// createApp: accepts optional opts. When omitted (unit tests), auth middleware is skipped.
export function createApp(opts?: AppOptions): express.Express {
  const app = express()

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }))
  app.use(cors())
  app.use(requestId)
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  if (opts) {
    // Select AuthProvider based on AUTH_MODE
    let provider: SelfAuthProvider | KeycloakProvider | LdapProvider
    let keycloakProvider: KeycloakProvider | null = null
    if (opts.authMode === 'keycloak') {
      keycloakProvider = new KeycloakProvider(opts.pool, opts.keycloak ?? {
        issuer: undefined, clientId: undefined, clientSecret: undefined,
        redirectUri: undefined, defaultRole: 'viewer',
      })
      provider = keycloakProvider
    } else if (opts.authMode === 'ldap') {
      provider = new LdapProvider(opts.pool, opts.ldap ?? { url: undefined, tlsEnabled: false })
    } else {
      provider = new SelfAuthProvider(opts.pool)
    }

    app.use(createSessionMiddleware({ secret: opts.sessionSecret, secure: opts.secureCookie }))
    // Setup guard blocks all /api routes except /setup/* and /health until initialized
    app.use('/api', setupGuard(opts.pool))
    app.use('/api', setupRouter(opts.pool, {
      adminEmail: opts.adminEmail ?? '',
      adminPassword: opts.adminPassword ?? '',
      authMode: opts.authMode ?? 'self',
    }))
    app.use('/api', authRouter(opts.pool, provider))
    // Keycloak OIDC routes (only wired when AUTH_MODE=keycloak)
    if (keycloakProvider) {
      app.use('/api', keycloakAuthRouter(keycloakProvider))
    }
    app.use('/api', adminRouter(opts.pool))
    app.use('/api', serversRouter(opts.pool))
    app.use('/api', appsRouter(opts.pool))
    app.use('/api', connectionsRouter(opts.pool))
    app.use('/api', topologyRouter(opts.pool))
    app.use('/api', fsRouter(opts.pool))
    app.use('/api', vaultRouter(opts.pool))
    app.use('/api', revealRouter(opts.pool, provider))
    app.use('/api', notificationsRouter(opts.pool))
    app.use('/api', documentsRouter(opts.pool, opts.uploadsDir ?? '/uploads'))
    app.use('/api', personalVaultRouter(opts.pool))
    app.use('/api', v1Router(opts.pool))
    app.use('/api', searchRouter(opts.pool))
    app.use('/api', recycleBinRouter(opts.pool))
    app.use('/api', backupRouter(opts.pool))
  }

  app.use('/api', healthRouter)

  // Static frontend — no-op in dev (dist doesn't exist yet); active in production build.
  // Resolve across layouts: dev (src/server.ts -> ../../frontend/dist) and
  // bundled prod (dist/server.js -> ../frontend/dist, i.e. /app/frontend/dist).
  const frontendDist =
    [
      join(__dirname, '..', '..', 'frontend', 'dist'),
      join(__dirname, '..', 'frontend', 'dist'),
    ].find((p) => existsSync(join(p, 'index.html'))) ??
    join(__dirname, '..', '..', 'frontend', 'dist')
  app.use(express.static(frontendDist))

  // SPA fallback: serve index.html for all non-API, non-file routes (client-side routing)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    const indexPath = join(frontendDist, 'index.html')
    if (existsSync(indexPath)) {
      res.sendFile(indexPath)
    } else {
      next()
    }
  })

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
    secureCookie: cfg.cookieSecure,
    adminEmail: cfg.adminEmail,
    adminPassword: cfg.adminPassword,
    authMode: cfg.authMode,
    uploadsDir: cfg.uploadsDir,
    keycloak: cfg.keycloak,
    ldap: cfg.ldap,
  })

  app.listen(cfg.port, () => {
    process.stdout.write(`[server] listening on :${cfg.port}\n`)
  })

  // Start background workers
  startExpiryWorker(getPool())
  startDigestWorker(getPool())
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: Error) => {
    process.stderr.write(`[fatal] ${err.message}\n`)
    process.exit(1)
  })
}
