import { Router } from 'express'
import multer from 'multer'
import { createHash } from 'crypto'
import { createReadStream, mkdirSync } from 'fs'
import { unlink } from 'fs/promises'
import { join, extname } from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { Pool } from 'pg'
import { requireAuth, requirePermission } from '../middleware/rbac.ts'

const ALLOWED_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

const VALID_LINKED_TYPES = new Set(['server', 'app', 'script', 'secret', 'vault'])

export function documentsRouter(pool: Pool, uploadsDir: string): Router {
  mkdirSync(uploadsDir, { recursive: true })

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, _file, cb) => cb(null, `${uuidv4()}${extname(_file.originalname)}`),
  })

  const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIMES.has(file.mimetype)) {
        cb(null, true)
      } else {
        cb(Object.assign(new Error(`MIME type ${file.mimetype} is not allowed`), { code: 'MIME_NOT_ALLOWED' }))
      }
    },
  })

  const router = Router()

  // ── POST /api/documents — upload a file ────────────────────────────────────
  router.post(
    '/documents',
    requireAuth,
    requirePermission('docs.write'),
    (req, res, next) => {
      upload.single('file')(req, res, (err: unknown) => {
        if (!err) return next()

        const multerErr = err as { code?: string; message?: string }
        if (multerErr.code === 'MIME_NOT_ALLOWED') {
          res.status(400).json({ error: multerErr.message ?? 'File type not allowed' })
          return
        }
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'File exceeds 10 MB size limit' })
          return
        }
        next(err)
      })
    },
    async (req, res, next) => {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' })
        return
      }

      const { linkedType, linkedId } = req.body as { linkedType?: string; linkedId?: string }

      if (linkedType && !VALID_LINKED_TYPES.has(linkedType)) {
        await unlink(req.file.path).catch(() => null)
        res.status(400).json({ error: `linkedType must be one of: ${[...VALID_LINKED_TYPES].join(', ')}` })
        return
      }

      try {
        // Compute SHA-256 checksum of the stored file
        const checksum = await computeChecksum(req.file.path)

        const storagePath = req.file.filename

        const result = await pool.query<{
          id: string
          filename: string
          mime: string
          size: number
          checksum: string
          storage_path: string
          linked_type: string | null
          linked_id: string | null
          uploaded_by: string
          uploaded_at: string
        }>(
          `INSERT INTO documents
             (filename, mime, size, checksum, storage_path, linked_type, linked_id, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, filename, mime, size, checksum, storage_path,
                     linked_type, linked_id, uploaded_by, uploaded_at`,
          [
            req.file.originalname,
            req.file.mimetype,
            req.file.size,
            checksum,
            storagePath,
            linkedType ?? null,
            linkedId ?? null,
            req.session.userId,
          ]
        )

        res.status(201).json(result.rows[0])
      } catch (err) {
        await unlink(req.file.path).catch(() => null)
        next(err)
      }
    }
  )

  // ── GET /api/documents — list (with optional entity filter) ────────────────
  router.get('/documents', requireAuth, requirePermission('docs.read'), async (req, res, next) => {
    const { linkedType, linkedId } = req.query as { linkedType?: string; linkedId?: string }
    try {
      let query: string
      let params: (string | null)[]

      if (linkedType && linkedId) {
        query = `SELECT id, filename, mime, size, checksum, storage_path,
                        linked_type, linked_id, uploaded_by, uploaded_at
                 FROM documents
                 WHERE deleted_at IS NULL
                   AND linked_type = $1
                   AND linked_id   = $2
                 ORDER BY uploaded_at DESC`
        params = [linkedType, linkedId]
      } else if (linkedType) {
        query = `SELECT id, filename, mime, size, checksum, storage_path,
                        linked_type, linked_id, uploaded_by, uploaded_at
                 FROM documents
                 WHERE deleted_at IS NULL
                   AND linked_type = $1
                 ORDER BY uploaded_at DESC`
        params = [linkedType]
      } else {
        query = `SELECT id, filename, mime, size, checksum, storage_path,
                        linked_type, linked_id, uploaded_by, uploaded_at
                 FROM documents
                 WHERE deleted_at IS NULL
                 ORDER BY uploaded_at DESC`
        params = []
      }

      const result = await pool.query(query, params)
      res.json(result.rows)
    } catch (err) {
      next(err)
    }
  })

  // ── GET /api/documents/:id — metadata ─────────────────────────────────────
  router.get('/documents/:id', requireAuth, requirePermission('docs.read'), async (req, res, next) => {
    try {
      const result = await pool.query<{
        id: string
        filename: string
        mime: string
        size: number
        checksum: string
        storage_path: string
        linked_type: string | null
        linked_id: string | null
        uploaded_by: string
        uploaded_at: string
      }>(
        `SELECT id, filename, mime, size, checksum, storage_path,
                linked_type, linked_id, uploaded_by, uploaded_at
         FROM documents
         WHERE id = $1 AND deleted_at IS NULL`,
        [req.params['id']]
      )

      if (!result.rows[0]) {
        res.status(404).json({ error: 'Document not found' })
        return
      }
      res.json(result.rows[0])
    } catch (err) {
      next(err)
    }
  })

  // ── GET /api/documents/:id/download — send file as download ───────────────
  router.get('/documents/:id/download', requireAuth, requirePermission('docs.read'), async (req, res, next) => {
    try {
      const result = await pool.query<{ filename: string; mime: string; storage_path: string }>(
        `SELECT filename, mime, storage_path FROM documents WHERE id = $1 AND deleted_at IS NULL`,
        [req.params['id']]
      )
      const doc = result.rows[0]
      if (!doc) {
        res.status(404).json({ error: 'Document not found' })
        return
      }

      const filePath = join(uploadsDir, doc.storage_path)
      res.setHeader('Content-Type', doc.mime)
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.filename)}"`)
      createReadStream(filePath).pipe(res)
    } catch (err) {
      next(err)
    }
  })

  // ── GET /api/documents/:id/view — inline render ────────────────────────────
  // PDF: passthrough (PDF.js handles in frontend)
  // text/markdown: passthrough inline
  // docx: convert to HTML via mammoth (fallback: download)
  // images: passthrough inline
  router.get('/documents/:id/view', requireAuth, requirePermission('docs.read'), async (req, res, next) => {
    try {
      const result = await pool.query<{ filename: string; mime: string; storage_path: string }>(
        `SELECT filename, mime, storage_path FROM documents WHERE id = $1 AND deleted_at IS NULL`,
        [req.params['id']]
      )
      const doc = result.rows[0]
      if (!doc) {
        res.status(404).json({ error: 'Document not found' })
        return
      }

      const filePath = join(uploadsDir, doc.storage_path)

      // docx: convert to HTML via mammoth
      if (
        doc.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        doc.mime === 'application/msword'
      ) {
        try {
          const mammoth = await import('mammoth')
          const mammothResult = await mammoth.convertToHtml({ path: filePath })
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.filename)}"`)
          res.send(mammothResult.value)
          return
        } catch {
          // Fallback: send as download if mammoth fails
          res.setHeader('Content-Type', doc.mime)
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.filename)}"`)
          createReadStream(filePath).pipe(res)
          return
        }
      }

      // All other supported types: stream inline
      res.setHeader('Content-Type', doc.mime)
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.filename)}"`)
      createReadStream(filePath).pipe(res)
    } catch (err) {
      next(err)
    }
  })

  // ── DELETE /api/documents/:id — soft-delete ────────────────────────────────
  router.delete('/documents/:id', requireAuth, requirePermission('docs.write'), async (req, res, next) => {
    try {
      const result = await pool.query(
        `UPDATE documents SET deleted_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id`,
        [req.params['id']]
      )
      if (!result.rows[0]) {
        res.status(404).json({ error: 'Document not found' })
        return
      }
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  return router
}

async function computeChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: Buffer) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}
