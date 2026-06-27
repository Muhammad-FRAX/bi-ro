import { createHmac } from 'node:crypto'
import type { Pool } from 'pg'

// Fire webhooks for a given event to all enabled matching endpoints
export async function fireWebhooks(
  pool: Pool,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  // Find enabled endpoints subscribed to this event
  const { rows: endpoints } = await pool.query<{
    id: string
    url: string
    secret: string
  }>(
    `SELECT id, url, secret FROM webhook_endpoints WHERE enabled = TRUE AND events @> $1::jsonb`,
    [JSON.stringify([event])],
  )

  if (endpoints.length === 0) return

  const payload = { event, data, ts: new Date().toISOString() }
  const body = JSON.stringify(payload)

  await Promise.allSettled(
    endpoints.map(async (ep) => {
      const sig = createHmac('sha256', ep.secret).update(body).digest('hex')
      let responseStatus: number | null = null
      let success = false

      try {
        const response = await fetch(ep.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Biro-Signature': `sha256=${sig}`,
          },
          body,
          signal: AbortSignal.timeout(10000),
        })
        responseStatus = response.status
        success = response.ok
      } catch {
        // Delivery failure — logged in webhook_deliveries with success=false
      }

      await pool.query(
        `INSERT INTO webhook_deliveries (endpoint_id, event, payload, response_status, success)
         VALUES ($1, $2, $3, $4, $5)`,
        [ep.id, event, JSON.stringify(payload), responseStatus, success],
      )
    }),
  )
}
