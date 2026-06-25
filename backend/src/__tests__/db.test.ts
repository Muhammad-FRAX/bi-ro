import { describe, it, expect, afterEach } from 'vitest'
import { createPool, initPool, getPool, _resetPoolForTesting } from '../db/pool.js'
import { runMigrations } from '../db/migrate.js'

describe('db/pool', () => {
  it('createPool returns a pool with query and end methods', () => {
    const pool = createPool('postgres://user:pass@localhost:5432/test')
    expect(typeof pool.query).toBe('function')
    expect(typeof pool.end).toBe('function')
    pool.end().catch(() => {})
  })

  describe('initPool / getPool singleton', () => {
    afterEach(async () => {
      await _resetPoolForTesting()
    })

    it('getPool throws before initPool is called', () => {
      expect(() => getPool()).toThrow(/not initialized/)
    })

    it('returns the pool after initPool', () => {
      initPool('postgres://user:pass@localhost:5432/test')
      const pool = getPool()
      expect(typeof pool.query).toBe('function')
    })

    it('initPool throws if called a second time', () => {
      initPool('postgres://user:pass@localhost:5432/test')
      expect(() => initPool('postgres://user:pass@localhost:5432/test')).toThrow(/already initialized/)
    })
  })
})

describe('db/migrate', () => {
  it('runMigrations is a function', () => {
    expect(typeof runMigrations).toBe('function')
  })
})
