export interface KeycloakConfig {
  readonly issuer?: string
  readonly clientId?: string
  readonly clientSecret?: string
  readonly redirectUri?: string
  readonly defaultRole: string
}

export interface LdapConfig {
  readonly url?: string
  readonly bindTemplate?: string // e.g. "{username}@company.local" — if set, replaces plain email as bind DN
  readonly tlsEnabled: boolean
}

export interface Config {
  readonly authMode: 'self' | 'keycloak' | 'ldap'
  readonly kek: Buffer
  readonly databaseUrl: string
  readonly sessionSecret: string
  readonly port: number
  readonly nodeEnv: string
  // Whether the session cookie carries the Secure flag (HTTPS-only). Default false
  // so a plain-HTTP `docker compose up` is usable; set COOKIE_SECURE=true in
  // production behind a TLS-terminating reverse proxy (§13).
  readonly cookieSecure: boolean
  readonly appTitle: string
  readonly appAccent: string
  readonly adminEmail: string | undefined
  readonly adminPassword: string | undefined
  readonly uploadsDir: string
  readonly keycloak: KeycloakConfig
  readonly ldap: LdapConfig
}

const VALID_AUTH_MODES = ['self', 'keycloak', 'ldap'] as const

export function loadConfig(env: Record<string, string | undefined>): Config {
  const authMode = env['AUTH_MODE']
  if (!authMode || !(VALID_AUTH_MODES as readonly string[]).includes(authMode)) {
    throw new Error(
      `AUTH_MODE must be one of ${VALID_AUTH_MODES.join('|')}; got: ${JSON.stringify(authMode)}`
    )
  }

  const rawKek = env['BIRO_MASTER_KEK']
  if (!rawKek) {
    throw new Error(
      'BIRO_MASTER_KEK is required. Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    )
  }
  const kekBytes = Buffer.from(rawKek, 'base64')
  if (kekBytes.length < 32) {
    throw new Error(
      'BIRO_MASTER_KEK must be a base64-encoded key of at least 256 bits (32 bytes)'
    )
  }

  const databaseUrl = env['DATABASE_URL']
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required (e.g. postgres://user:pass@host:5432/biro)')
  }

  const sessionSecret = env['SESSION_SECRET']
  if (!sessionSecret) {
    throw new Error(
      'SESSION_SECRET is required. Generate: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"'
    )
  }

  const rawPort = env['PORT'] ?? '5000'
  const port = parseInt(rawPort, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer in 1–65535; got: ${JSON.stringify(rawPort)}`)
  }

  const nodeEnv = env['NODE_ENV'] ?? 'development'
  const cookieSecure = env['COOKIE_SECURE'] === 'true'
  const appTitle = env['APP_TITLE'] ?? 'BI Root'
  const appAccent = env['APP_ACCENT'] ?? '#a78bfa'
  const adminEmail = env['BIRO_ADMIN_EMAIL']
  const adminPassword = env['BIRO_ADMIN_PASSWORD']
  const uploadsDir = env['UPLOADS_DIR'] ?? '/uploads'

  const keycloak: KeycloakConfig = {
    issuer: env['KEYCLOAK_ISSUER'] ?? env['KEYCLOAK_ISSUER_URL'],
    clientId: env['KEYCLOAK_CLIENT_ID'],
    clientSecret: env['KEYCLOAK_CLIENT_SECRET'],
    redirectUri: env['KEYCLOAK_REDIRECT_URI'],
    defaultRole: env['KEYCLOAK_DEFAULT_ROLE'] ?? 'viewer',
  }

  const ldap: LdapConfig = {
    url: env['LDAP_URL'] ?? (env['LDAP_HOST']
      ? `ldap://${env['LDAP_HOST']}:${env['LDAP_PORT'] ?? '389'}`
      : undefined),
    bindTemplate: env['LDAP_BIND_TEMPLATE'],
    tlsEnabled: env['LDAP_TLS'] === 'true' || (env['LDAP_URL'] ?? '').startsWith('ldaps://'),
  }

  const cfg = {
    authMode: authMode as 'self' | 'keycloak' | 'ldap',
    kek: kekBytes,
    databaseUrl,
    sessionSecret,
    port,
    nodeEnv,
    cookieSecure,
    appTitle,
    appAccent,
    adminEmail,
    adminPassword,
    uploadsDir,
    keycloak,
    ldap,
    toJSON() {
      return {
        authMode: this.authMode,
        databaseUrl: this.databaseUrl.replace(/:([^:@]+)@/, ':***@'),
        port: this.port,
        nodeEnv: this.nodeEnv,
        appTitle: this.appTitle,
        appAccent: this.appAccent,
        adminEmail: this.adminEmail,
        kek: '[REDACTED]',
        sessionSecret: '[REDACTED]',
        adminPassword: this.adminPassword != null ? '[REDACTED]' : undefined,
        uploadsDir: this.uploadsDir,
        keycloak: {
          ...this.keycloak,
          clientSecret: this.keycloak.clientSecret != null ? '[REDACTED]' : undefined,
        },
        ldap: this.ldap,
      }
    },
  }

  return Object.freeze(cfg) as Config
}

let _config: Config | undefined

export function initConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): Config {
  if (_config) {
    throw new Error(
      'initConfig() already called. Call _resetConfigForTesting() in test teardown if this is intentional.'
    )
  }
  _config = loadConfig(env)
  return _config
}

export function getConfig(): Config {
  if (!_config) {
    throw new Error('Config not initialized — call initConfig() at server startup before getConfig()')
  }
  return _config
}

export function _resetConfigForTesting(): void {
  _config = undefined
}
