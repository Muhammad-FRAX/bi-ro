import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { runMigrations } from '../db/migrate.ts'

const { Pool } = pg

const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('C1.1 identity schema', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL })
    pool.on('error', () => {}) // suppress unhandled pool errors in tests
    await runMigrations(DB_URL!)
  }, 30_000)

  afterAll(async () => {
    await pool.end()
  })

  // --- table existence ---

  const EXPECTED_TABLES = [
    'users',
    'roles',
    'role_permissions',
    'user_roles',
    'user_permission_overrides',
    'settings',
    'setup_state',
  ]

  for (const table of EXPECTED_TABLES) {
    it(`table "${table}" exists`, async () => {
      const { rows } = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = $1
         ) AS exists`,
        [table],
      )
      expect(rows[0]!.exists).toBe(true)
    })
  }

  // --- users table structure ---

  it('users table has required columns', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users'`,
    )
    const cols = rows.map((r) => r.column_name)
    for (const col of ['id', 'auth_mode', 'email', 'display_name', 'password_hash', 'status', 'created_at']) {
      expect(cols, `missing column: ${col}`).toContain(col)
    }
  })

  // --- setup_state columns ---

  it('setup_state has initialized and auth_mode columns', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'setup_state'`,
    )
    const cols = rows.map((r) => r.column_name)
    expect(cols).toContain('initialized')
    expect(cols).toContain('auth_mode')
  })

  // --- built-in roles ---

  const BUILTIN_ROLES = ['admin', 'editor', 'viewer_secrets', 'viewer'] as const

  for (const role of BUILTIN_ROLES) {
    it(`built-in role "${role}" exists with is_builtin=true`, async () => {
      const { rows } = await pool.query<{ is_builtin: boolean }>(
        `SELECT is_builtin FROM roles WHERE name = $1`,
        [role],
      )
      expect(rows.length, `role "${role}" not found`).toBe(1)
      expect(rows[0]!.is_builtin).toBe(true)
    })
  }

  // --- admin role has ALL permission flags ---

  const ALL_PERMISSIONS = [
    'infra.read',
    'servers.write',
    'scripts.write',
    'docs.read',
    'docs.write',
    'secrets.view',
    'secrets.reveal',
    'secrets.create',
    'secrets.edit',
    'secrets.delete',
    'vault.manage_access',
    'users.manage',
    'roles.manage',
    'settings.manage',
    'api_keys.manage',
    'audit.read',
  ] as const

  it('admin role has all 16 permission flags', async () => {
    const { rows } = await pool.query<{ permission: string }>(
      `SELECT rp.permission
       FROM roles r JOIN role_permissions rp ON r.id = rp.role_id
       WHERE r.name = 'admin'`,
    )
    const perms = rows.map((r) => r.permission)
    expect(perms.length).toBe(ALL_PERMISSIONS.length)
    for (const perm of ALL_PERMISSIONS) {
      expect(perms, `admin missing: ${perm}`).toContain(perm)
    }
  })

  it('viewer role has only infra.read and docs.read', async () => {
    const { rows } = await pool.query<{ permission: string }>(
      `SELECT rp.permission
       FROM roles r JOIN role_permissions rp ON r.id = rp.role_id
       WHERE r.name = 'viewer'`,
    )
    const perms = rows.map((r) => r.permission)
    expect(perms.sort()).toEqual(['docs.read', 'infra.read'].sort())
  })

  it('viewer_secrets role has infra.read, docs.read, secrets.view, secrets.reveal', async () => {
    const { rows } = await pool.query<{ permission: string }>(
      `SELECT rp.permission
       FROM roles r JOIN role_permissions rp ON r.id = rp.role_id
       WHERE r.name = 'viewer_secrets'`,
    )
    const perms = rows.map((r) => r.permission)
    expect(perms.sort()).toEqual(
      ['docs.read', 'infra.read', 'secrets.reveal', 'secrets.view'].sort(),
    )
  })

  it('editor role has the correct permission set (no admin powers)', async () => {
    const { rows } = await pool.query<{ permission: string }>(
      `SELECT rp.permission
       FROM roles r JOIN role_permissions rp ON r.id = rp.role_id
       WHERE r.name = 'editor'`,
    )
    const perms = rows.map((r) => r.permission)
    // Editor CAN do these
    for (const p of [
      'infra.read',
      'servers.write',
      'scripts.write',
      'docs.read',
      'docs.write',
      'secrets.view',
      'secrets.reveal',
      'secrets.create',
      'secrets.edit',
      'secrets.delete',
    ]) {
      expect(perms, `editor missing: ${p}`).toContain(p)
    }
    // Editor CANNOT do these
    for (const p of [
      'users.manage', 'roles.manage', 'settings.manage',
      'api_keys.manage', 'vault.manage_access', 'audit.read',
    ]) {
      expect(perms, `editor should NOT have: ${p}`).not.toContain(p)
    }
  })
})
