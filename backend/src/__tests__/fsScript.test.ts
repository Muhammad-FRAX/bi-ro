import { describe, it, expect } from 'vitest'
import { generateBashScript, generatePs1Script, validateFsTreeSchema } from '../util/fsScript.ts'
import type { FsTreeDoc } from '../util/fsScript.ts'

// Pure unit tests — no DB required

describe('C3.2 fsScript utilities', () => {
  describe('generateBashScript', () => {
    it('returns a string containing bi-ro.fstree.v1', () => {
      const script = generateBashScript('/home/user', 3, 'etl-01')
      expect(typeof script).toBe('string')
      expect(script).toContain('bi-ro.fstree.v1')
    })

    it('includes the root path baked in', () => {
      const script = generateBashScript('/data/apps', 3, 'etl-01')
      expect(script).toContain('/data/apps')
    })

    it('includes the maxDepth baked in', () => {
      const script = generateBashScript('/home/user', 5, 'etl-01')
      expect(script).toContain('5')
    })

    it('includes the host baked in', () => {
      const script = generateBashScript('/home/user', 3, 'my-server-hostname')
      expect(script).toContain('my-server-hostname')
    })

    it('starts with a bash shebang', () => {
      const script = generateBashScript('/home/user', 3, 'etl-01')
      expect(script.startsWith('#!/usr/bin/env bash')).toBe(true)
    })

    it('uses python3 for JSON building', () => {
      const script = generateBashScript('/home/user', 3, 'etl-01')
      expect(script).toContain('python3')
    })
  })

  describe('generatePs1Script', () => {
    it('returns a string containing bi-ro.fstree.v1', () => {
      const script = generatePs1Script('C:\\Users\\Admin', 3, 'win-server')
      expect(typeof script).toBe('string')
      expect(script).toContain('bi-ro.fstree.v1')
    })

    it('includes the root path baked in', () => {
      const script = generatePs1Script('C:\\data\\apps', 3, 'win-server')
      expect(script).toContain('C:\\data\\apps')
    })

    it('includes the maxDepth baked in', () => {
      const script = generatePs1Script('C:\\data\\apps', 7, 'win-server')
      expect(script).toContain('7')
    })

    it('includes the host baked in', () => {
      const script = generatePs1Script('C:\\data\\apps', 3, 'my-win-hostname')
      expect(script).toContain('my-win-hostname')
    })

    it('uses ConvertTo-Json', () => {
      const script = generatePs1Script('C:\\data\\apps', 3, 'win-server')
      expect(script).toContain('ConvertTo-Json')
    })
  })

  describe('validateFsTreeSchema', () => {
    const validDoc: FsTreeDoc = {
      schema: 'bi-ro.fstree.v1',
      root: '/home/user',
      host: 'etl-01',
      generated_at: '2026-06-25T10:00:00Z',
      max_depth: 3,
      nodes: [
        { path: '/home/user/etl', type: 'dir', size: null, mtime: '2026-01-01T00:00:00Z' },
        { path: '/home/user/etl/run.sh', type: 'file', size: 2048, mtime: '2026-01-01T00:00:00Z' },
      ],
    }

    it('validates a correct bi-ro.fstree.v1 document', () => {
      const result = validateFsTreeSchema(validDoc)
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('rejects wrong schema version', () => {
      const doc = { ...validDoc, schema: 'bi-ro.fstree.v2' }
      const result = validateFsTreeSchema(doc)
      expect(result.valid).toBe(false)
      expect(result.error).toBeTruthy()
    })

    it('rejects missing root', () => {
      const { root: _r, ...doc } = validDoc
      const result = validateFsTreeSchema(doc)
      expect(result.valid).toBe(false)
    })

    it('rejects missing host', () => {
      const { host: _h, ...doc } = validDoc
      const result = validateFsTreeSchema(doc)
      expect(result.valid).toBe(false)
    })

    it('rejects missing generated_at', () => {
      const { generated_at: _g, ...doc } = validDoc
      const result = validateFsTreeSchema(doc)
      expect(result.valid).toBe(false)
    })

    it('rejects max_depth out of range (0)', () => {
      const doc = { ...validDoc, max_depth: 0 }
      const result = validateFsTreeSchema(doc)
      expect(result.valid).toBe(false)
    })

    it('rejects max_depth out of range (21)', () => {
      const doc = { ...validDoc, max_depth: 21 }
      const result = validateFsTreeSchema(doc)
      expect(result.valid).toBe(false)
    })

    it('rejects missing nodes array', () => {
      const { nodes: _n, ...doc } = validDoc
      const result = validateFsTreeSchema(doc)
      expect(result.valid).toBe(false)
    })

    it('rejects node with invalid type', () => {
      const doc = {
        ...validDoc,
        nodes: [{ path: '/foo', type: 'symlink', size: null, mtime: '2026-01-01T00:00:00Z' }],
      }
      const result = validateFsTreeSchema(doc)
      expect(result.valid).toBe(false)
    })

    it('rejects node with missing path', () => {
      const doc = {
        ...validDoc,
        nodes: [{ type: 'file', size: 100, mtime: '2026-01-01T00:00:00Z' }],
      }
      const result = validateFsTreeSchema(doc)
      expect(result.valid).toBe(false)
    })

    it('accepts empty nodes array', () => {
      const doc = { ...validDoc, nodes: [] }
      const result = validateFsTreeSchema(doc)
      expect(result.valid).toBe(true)
    })
  })
})
