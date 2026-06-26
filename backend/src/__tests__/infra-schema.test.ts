import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { runMigrations } from '../db/migrate.ts'

const { Pool } = pg

const DB_URL = process.env['DATABASE_URL']

describe.skipIf(!DB_URL)('C2.1 infra schema', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL })
    pool.on('error', () => {})
    await runMigrations(DB_URL!)
  }, 30_000)

  afterAll(async () => {
    await pool.end()
  })

  const EXPECTED_TABLES = [
    'servers',
    'tags',
    'server_tags',
    'apps',
    'app_instances',
    'ports',
    'connections',
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

  it('servers has required columns with correct constraints', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'servers'`,
    )
    const cols = rows.map((r) => r.column_name)
    for (const col of [
      'id', 'hostname', 'aliases', 'ips', 'environment',
      'os', 'location', 'owner_id', 'status', 'notes',
      'created_at', 'updated_at', 'deleted_at',
    ]) {
      expect(cols, `servers missing column: ${col}`).toContain(col)
    }
  })

  it('servers environment CHECK enforces enum values', async () => {
    await expect(
      pool.query(`INSERT INTO servers (hostname, environment) VALUES ('test-bad-env', 'invalid')`),
    ).rejects.toThrow()
  })

  it('servers status CHECK enforces enum values', async () => {
    await expect(
      pool.query(`INSERT INTO servers (hostname, environment, status) VALUES ('test-bad-status', 'prod', 'gone')`),
    ).rejects.toThrow()
  })

  it('tags has id, name, color columns', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tags'`,
    )
    const cols = rows.map((r) => r.column_name)
    for (const col of ['id', 'name', 'color']) {
      expect(cols, `tags missing: ${col}`).toContain(col)
    }
  })

  it('tags name is unique', async () => {
    await pool.query(`INSERT INTO tags (name, color) VALUES ('uniquetag-test', '#fff')`)
    await expect(
      pool.query(`INSERT INTO tags (name, color) VALUES ('uniquetag-test', '#000')`),
    ).rejects.toThrow()
    await pool.query(`DELETE FROM tags WHERE name = 'uniquetag-test'`)
  })

  it('apps has required columns', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'apps'`,
    )
    const cols = rows.map((r) => r.column_name)
    for (const col of ['id', 'name', 'category', 'vendor', 'version', 'eol_date', 'logo_url', 'docs_url']) {
      expect(cols, `apps missing: ${col}`).toContain(col)
    }
  })

  it('app_instances references servers and apps', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'app_instances'`,
    )
    const cols = rows.map((r) => r.column_name)
    expect(cols).toContain('server_id')
    expect(cols).toContain('app_id')
  })

  it('ports references servers and app_instances', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ports'`,
    )
    const cols = rows.map((r) => r.column_name)
    expect(cols).toContain('server_id')
    expect(cols).toContain('app_instance_id')
    expect(cols).toContain('number')
    expect(cols).toContain('protocol')
    expect(cols).toContain('exposure')
  })

  it('ports exposure CHECK enforces enum values', async () => {
    const { rows: srv } = await pool.query<{ id: string }>(
      `INSERT INTO servers (hostname, environment) VALUES ('port-check-srv', 'dev') RETURNING id`,
    )
    const serverId = srv[0]!.id
    await expect(
      pool.query(
        `INSERT INTO ports (server_id, number, protocol, exposure) VALUES ($1, 8080, 'tcp', 'bad-exposure')`,
        [serverId],
      ),
    ).rejects.toThrow()
    await pool.query(`DELETE FROM servers WHERE id = $1`, [serverId])
  })

  it('connections references app_instances on both ends', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'connections'`,
    )
    const cols = rows.map((r) => r.column_name)
    expect(cols).toContain('from_app_instance_id')
    expect(cols).toContain('to_app_instance_id')
    expect(cols).toContain('label')
    expect(cols).toContain('protocol')
  })

  it('server_tags links servers and tags', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'server_tags'`,
    )
    const cols = rows.map((r) => r.column_name)
    expect(cols).toContain('server_id')
    expect(cols).toContain('tag_id')
  })
})
