import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

let app: Express

beforeAll(async () => {
  const { createApp } = await import('../server.ts')
  app = createApp()
})

describe('GET /api/health', () => {
  it('returns 200 with status ok and timestamp', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(typeof res.body.ts).toBe('string')
  })
})

describe('error handler', () => {
  it('returns shaped JSON on thrown error', async () => {
    const express = (await import('express')).default
    const { requestId } = await import('../middleware/requestId.ts')
    const { errorHandler } = await import('../middleware/errorHandler.ts')

    const testApp = express()
    testApp.use(requestId)
    testApp.get('/test-error', (_req, _res, next) => {
      next(new Error('boom'))
    })
    testApp.use(errorHandler)

    const res = await request(testApp).get('/test-error')
    expect(res.status).toBe(500)
    expect(res.body.error).toBeDefined()
  })
})
