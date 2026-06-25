import pg from 'pg'

const { Pool } = pg

export type DbPool = pg.Pool

export function createPool(databaseUrl: string): pg.Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })

  pool.on('error', (err) => {
    process.stderr.write(`[pool] idle client error: ${err.message}\n`)
  })

  return pool
}

let _pool: pg.Pool | undefined

export function initPool(databaseUrl: string): pg.Pool {
  if (_pool) {
    throw new Error('DB pool already initialized')
  }
  _pool = createPool(databaseUrl)
  return _pool
}

export function getPool(): pg.Pool {
  if (!_pool) {
    throw new Error('DB pool not initialized — call initPool() at server startup')
  }
  return _pool
}

export async function _resetPoolForTesting(): Promise<void> {
  if (_pool) {
    await _pool.end()
  }
  _pool = undefined
}
