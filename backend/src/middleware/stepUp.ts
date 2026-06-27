import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import type { Pool } from 'pg'
import type { AuthProvider } from '../auth/types.ts'
import { decryptSecret } from '../crypto/envelope.ts'
import { getConfig } from '../config.ts'
import { requireAuth, requirePermission } from './rbac.ts'

// Rate limiter for step-up / reveal: 5 attempts per 15 min per IP+user combo
// §20 F3.1 — brute-force guard ships with P4
export const stepUpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${req.ip ?? 'unknown'}-${req.session.userId ?? 'anon'}`,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many step-up attempts. Please wait 15 minutes and try again.',
    })
  },
  standardHeaders: true,
  legacyHeaders: false,
})

export function revealRouter(pool: Pool, provider: AuthProvider): Router {
  const router = Router()

  // POST /secrets/:id/reveal
  // §6.4 order: step-up → authz (role + membership) → AUDIT COMMIT → decrypt → return
  // §20 F2.1 — write-ahead audit, fail-closed: audit row committed BEFORE plaintext returned
  router.post(
    '/secrets/:id/reveal',
    requireAuth,
    requirePermission('secrets.reveal'),
    stepUpRateLimiter,
    async (req, res, next) => {
      const userId = req.session.userId!
      const secretId = req.params['id']!
      const ip = req.ip ?? req.socket.remoteAddress ?? null
      const ua = req.headers['user-agent'] ?? null

      try {
        // 1. Step-up authentication — delegated to AuthProvider (mode-agnostic)
        const { password } = req.body as { password?: string }
        if (!password) {
          return void res.status(400).json({ error: 'password is required for step-up' })
        }

        const stepUpOk = await provider.stepUp(
          { userId, email: req.session.email! },
          { password },
        )
        if (!stepUpOk) {
          // Audit the denied attempt before returning
          await writeAudit(pool, {
            actorId: userId,
            action: 'reveal',
            targetType: 'secret',
            targetId: secretId,
            ip,
            ua,
            result: 'denied',
            detail: { reason: 'step-up auth failed' },
          })
          return void res.status(401).json({ error: 'Re-authentication failed' })
        }

        // 2. Fetch the secret (existence + vault_id for membership check)
        const { rows: secretRows } = await pool.query(
          `SELECT s.id, s.vault_id, s.ciphertext, s.iv, s.auth_tag, s.wrapped_dek, s.key_version
           FROM secrets s
           WHERE s.id = $1 AND s.deleted_at IS NULL`,
          [secretId],
        )
        if (!secretRows[0]) {
          return void res.status(404).json({ error: 'Secret not found' })
        }

        // 3. Vault membership check — member with reveal access
        const { rows: memberRows } = await pool.query(
          `SELECT access FROM vault_members WHERE vault_id = $1 AND user_id = $2`,
          [secretRows[0].vault_id, userId],
        )
        const isAdmin = (req.session.permissions ?? []).includes('users.manage')
        const ACCESS_ORDER: Record<string, number> = { view: 0, reveal: 1, manage: 2 }
        const hasRevealAccess =
          isAdmin ||
          (memberRows[0] && ACCESS_ORDER[memberRows[0].access as string] >= ACCESS_ORDER['reveal']!)
        if (!hasRevealAccess) {
          await writeAudit(pool, {
            actorId: userId,
            action: 'reveal',
            targetType: 'secret',
            targetId: secretId,
            ip,
            ua,
            result: 'denied',
            detail: { reason: 'insufficient vault membership' },
          })
          return void res.status(403).json({ error: 'Not authorized to reveal this secret' })
        }

        // 4. WRITE-AHEAD AUDIT — committed BEFORE plaintext is returned (§20 F2.1, fail-closed)
        try {
          await writeAudit(pool, {
            actorId: userId,
            action: 'reveal',
            targetType: 'secret',
            targetId: secretId,
            ip,
            ua,
            result: 'ok',
            detail: null,
          })
        } catch (_auditErr) {
          // Audit write failed — reveal is BLOCKED (fail-closed per §20 F2.1)
          return void res
            .status(500)
            .json({ error: 'Could not record access; try again' })
        }

        // 5. Decrypt — AFTER audit is committed
        const secret = secretRows[0]
        const kek = getConfig().kek
        let plaintext: string
        try {
          plaintext = decryptSecret(
            {
              ciphertext: secret.ciphertext as Buffer,
              iv: secret.iv as Buffer,
              authTag: secret.auth_tag as Buffer,
              wrappedDek: secret.wrapped_dek as Buffer,
              keyVersion: secret.key_version as string,
            },
            kek,
          )
        } catch (_decryptErr) {
          // Log the tamper/key error but don't expose details
          return void res.status(500).json({ error: 'Unable to decrypt — possible tamper or key mismatch' })
        }

        // 6. Return plaintext value — THIS IS THE ONLY ENDPOINT THAT DOES THIS
        res.json({ value: plaintext })
      } catch (err) {
        next(err)
      }
    },
  )

  // GET /admin/audit — read-only audit log (admin only)
  router.get(
    '/admin/audit',
    requireAuth,
    requirePermission('audit.read'),
    async (req, res, next) => {
      try {
        const limit = Math.min(Number(req.query['limit'] ?? 100), 500)
        const offset = Number(req.query['offset'] ?? 0)
        const { action, targetType, actorId } = req.query as Record<string, string | undefined>

        let whereClause = ''
        const params: unknown[] = []
        const conditions: string[] = []

        if (action) {
          params.push(action)
          conditions.push(`a.action = $${params.length}`)
        }
        if (targetType) {
          params.push(targetType)
          conditions.push(`a.target_type = $${params.length}`)
        }
        if (actorId) {
          params.push(actorId)
          conditions.push(`a.actor_id = $${params.length}`)
        }
        if (conditions.length) whereClause = `WHERE ${conditions.join(' AND ')}`

        params.push(limit, offset)
        const { rows } = await pool.query(
          `SELECT a.id, a.actor_id, a.action, a.target_type, a.target_id,
                  a.ip, a.result, a.ts, a.detail,
                  u.email AS actor_email
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.actor_id
           ${whereClause}
           ORDER BY a.ts DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        )
        res.json(rows)
      } catch (err) {
        next(err)
      }
    },
  )

  return router
}

// ── Audit writer ─────────────────────────────────────────────────────────────

interface AuditEntry {
  actorId: string
  action: string
  targetType: string
  targetId: string
  ip: string | null
  ua: string | null
  result: 'ok' | 'denied' | 'error'
  detail: Record<string, unknown> | null
}

export async function writeAudit(pool: Pool, entry: AuditEntry): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, ip, user_agent, result, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.actorId,
      entry.action,
      entry.targetType,
      entry.targetId,
      entry.ip,
      entry.ua,
      entry.result,
      entry.detail ? JSON.stringify(entry.detail) : null,
    ],
  )
}
