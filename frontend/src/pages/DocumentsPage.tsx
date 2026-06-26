import { useState, useEffect, useRef, type FormEvent, type CSSProperties } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { Button } from '../components/ui/Button.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { api, ApiError } from '../lib/api.ts'

interface Document {
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
}

interface Props {
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

const BADGE: CSSProperties = {
  display: 'inline-block', padding: '2px 7px', borderRadius: 99,
  fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
}

const ALLOWED_MIME_LABELS: Record<string, string> = {
  'text/plain': 'TXT',
  'text/markdown': 'MD',
  'text/x-markdown': 'MD',
  'application/pdf': 'PDF',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'image/gif': 'GIF',
  'image/webp': 'WEBP',
  'image/svg+xml': 'SVG',
}

function MimeBadge({ mime }: { mime: string }) {
  const label = ALLOWED_MIME_LABELS[mime] ?? mime.split('/')[1]?.toUpperCase() ?? '?'
  const isDoc = mime === 'application/pdf' || mime.includes('word')
  const isImage = mime.startsWith('image/')
  const color = isDoc ? 'var(--accent)' : isImage ? 'var(--success)' : 'var(--text-muted)'
  return (
    <span style={{ ...BADGE, color, background: `color-mix(in srgb, ${color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 25%, transparent)` }}>
      {label}
    </span>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// DocumentViewer — inline viewer for text, markdown, PDF, images, docx-html
function DocumentViewer({ doc, onClose }: { doc: Document; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setError(null); setContent(null)
    const url = `/api/documents/${doc.id}/view`

    if (doc.mime === 'application/pdf' || doc.mime.startsWith('image/')) {
      // These are embedded directly via iframe/img — no fetch needed
      setLoading(false)
      return
    }

    fetch(url, { credentials: 'same-origin' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      })
      .then(text => { setContent(text); setLoading(false) })
      .catch(err => { setError((err as Error).message); setLoading(false) })
  }, [doc.id, doc.mime])

  const viewUrl = `/api/documents/${doc.id}/view`
  const downloadUrl = `/api/documents/${doc.id}/download`

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', flexDirection: 'column',
      padding: 32,
    }}>
      <div style={{
        background: 'var(--bg-elev)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        maxWidth: 960, width: '100%', margin: '0 auto',
        maxHeight: '90vh', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <MimeBadge mime={doc.mime} />
          <span style={{ fontWeight: 600, flex: 1, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {doc.filename}
          </span>
          <a href={downloadUrl} download={doc.filename}
            style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', marginRight: 8 }}>
            ↓ Download
          </a>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
            aria-label="Close viewer">
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 0 }}>
          {loading && (
            <div style={{ padding: 32, color: 'var(--text-muted)', textAlign: 'center' }}>Loading…</div>
          )}
          {error && (
            <div style={{ padding: 32, color: 'var(--danger)', textAlign: 'center' }}>
              Failed to load preview. <a href={downloadUrl} download={doc.filename} style={{ color: 'var(--accent)' }}>Download instead</a>
            </div>
          )}
          {!loading && !error && doc.mime === 'application/pdf' && (
            <iframe
              src={viewUrl}
              title={doc.filename}
              style={{ width: '100%', height: '70vh', border: 'none', background: '#fff' }}
            />
          )}
          {!loading && !error && doc.mime.startsWith('image/') && (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <img
                src={viewUrl}
                alt={doc.filename}
                style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain', borderRadius: 'var(--radius)' }}
              />
            </div>
          )}
          {/* HTML content (from mammoth docx conversion) */}
          {!loading && !error && content !== null &&
            (doc.mime.includes('word') || doc.mime === 'application/msword') && (
            <div
              style={{ padding: '16px 24px', color: 'var(--text)', fontSize: 13, lineHeight: 1.7 }}
              dangerouslySetInnerHTML={{ __html: content }}
            />
          )}
          {/* Plain text / markdown */}
          {!loading && !error && content !== null &&
            (doc.mime === 'text/plain' || doc.mime === 'text/markdown' || doc.mime === 'text/x-markdown') && (
            <pre style={{
              padding: '16px 24px', margin: 0,
              color: 'var(--text)', fontSize: 12, lineHeight: 1.65,
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              overflow: 'auto',
            }}>
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

export function DocumentsPage({ user, appTitle, onNavigate, onLogout }: Props) {
  const [docs, setDocs] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const canWrite = user.permissions.includes('docs.write')

  async function load() {
    setLoading(true); setError(null)
    try {
      const data = await api.get<Document[]>('/documents')
      setDocs(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function handleUpload(e: FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) { setUploadError('Select a file first'); return }
    setUploading(true); setUploadError(null)

    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/documents', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setShowUpload(false)
      if (fileRef.current) fileRef.current.value = ''
      await load()
    } catch (err) {
      setUploadError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(id: string, filename: string) {
    if (!confirm(`Delete "${filename}"?`)) return
    try {
      await api.delete(`/documents/${id}`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    }
  }

  const columns = [
    {
      key: 'filename' as const,
      header: 'Filename',
      render: (doc: Document) => (
        <button
          onClick={() => setViewingDoc(doc)}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'left', padding: 0 }}
        >
          {doc.filename}
        </button>
      ),
    },
    {
      key: 'mime' as const,
      header: 'Type',
      render: (doc: Document) => <MimeBadge mime={doc.mime} />,
    },
    {
      key: 'size' as const,
      header: 'Size',
      render: (doc: Document) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--text-muted)' }}>
          {formatBytes(doc.size)}
        </span>
      ),
    },
    {
      key: 'linked_type' as const,
      header: 'Attached to',
      render: (doc: Document) =>
        doc.linked_type ? (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {doc.linked_type} <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-soft)' }}>{doc.linked_id?.slice(0, 8)}</span>
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>standalone</span>
        ),
    },
    {
      key: 'uploaded_at' as const,
      header: 'Uploaded',
      render: (doc: Document) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--text-muted)' }}>
          {formatDate(doc.uploaded_at)}
        </span>
      ),
    },
    ...(canWrite ? [{
      key: 'id' as const,
      header: '',
      render: (doc: Document) => (
        <button
          onClick={() => void handleDelete(doc.id, doc.filename)}
          style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, padding: '2px 6px' }}
        >
          Delete
        </button>
      ),
    }] : []),
  ]

  return (
    <AppShell currentPath="/documents" onNavigate={onNavigate} user={user} onLogout={onLogout} appTitle={appTitle}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 32px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Documents</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Runbooks, PDFs, and reference files attached to your infrastructure.
            </p>
          </div>
          {canWrite && (
            <Button intent="primary" onClick={() => setShowUpload(v => !v)}>
              {showUpload ? 'Cancel' : '+ Upload'}
            </Button>
          )}
        </div>

        {/* Upload form */}
        {showUpload && canWrite && (
          <form onSubmit={e => void handleUpload(e)}
            style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.svg"
                style={{ color: 'var(--text)', fontSize: 13 }}
              />
              <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-subtle)' }}>
                Allowed: txt, md, pdf, doc, docx, png, jpg, gif, webp, svg · Max 10 MB
              </p>
            </div>
            <Button type="submit" intent="primary" disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
            {uploadError && (
              <p style={{ width: '100%', margin: '4px 0 0', fontSize: 12, color: 'var(--danger)' }}>{uploadError}</p>
            )}
          </form>
        )}

        {/* Error / loading / table */}
        {error && (
          <div style={{ padding: 16, background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: 'var(--radius)', marginBottom: 16, color: 'var(--danger)', fontSize: 13 }}>
            {error} <button onClick={() => void load()} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13 }}>Retry</button>
          </div>
        )}

        <DataTable
          columns={columns}
          data={docs}
          loading={loading}
          emptyMessage={
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>No documents attached.</div>
              {canWrite && (
                <Button intent="primary" size="sm" onClick={() => setShowUpload(true)}>Upload a document</Button>
              )}
            </div>
          }
        />

        {/* Inline viewer */}
        {viewingDoc && (
          <DocumentViewer doc={viewingDoc} onClose={() => setViewingDoc(null)} />
        )}
      </div>
    </AppShell>
  )
}
