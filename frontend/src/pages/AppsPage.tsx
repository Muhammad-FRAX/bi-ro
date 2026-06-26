import { useState, useEffect, useCallback, type CSSProperties, type FormEvent } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { api, ApiError } from '../lib/api.ts'

interface App {
  id: string
  name: string
  category: string | null
  vendor: string | null
  version: string | null
  eolDate: string | null
  logoUrl: string | null
  docsUrl: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

interface AppsPageProps {
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

const INPUT_STYLE: CSSProperties = {
  height: 30, padding: '0 8px', background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
}

function EolBadge({ eolDate }: { eolDate: string | null }) {
  if (!eolDate) return <span style={{ color: 'var(--text-subtle)' }}>—</span>
  const ms = new Date(eolDate).getTime() - Date.now()
  const daysLeft = Math.floor(ms / 86_400_000)
  const color = daysLeft < 0 ? 'var(--danger)' : daysLeft < 90 ? 'var(--warning)' : 'var(--text-muted)'
  const label = daysLeft < 0 ? `EOL ${Math.abs(daysLeft)}d ago` : daysLeft < 90 ? `EOL in ${daysLeft}d` : eolDate
  return <span style={{ fontSize: 12, color, fontVariantNumeric: 'tabular-nums' }}>{label}</span>
}

export function AppsPage({ user, appTitle, onNavigate, onLogout }: AppsPageProps) {
  const [apps, setApps] = useState<App[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const canWrite = user.permissions.includes('servers.write')

  const fetchApps = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<{ apps: App[] }>('/apps')
      setApps(data.apps)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load apps')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchApps() }, [fetchApps])

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    setSubmitting(true)
    const fd = new FormData(e.currentTarget)
    try {
      await api.post('/apps', {
        name: (fd.get('name') as string).trim(),
        category: (fd.get('category') as string).trim() || undefined,
        vendor: (fd.get('vendor') as string).trim() || undefined,
        version: (fd.get('version') as string).trim() || undefined,
        eol_date: (fd.get('eol_date') as string).trim() || undefined,
        docs_url: (fd.get('docs_url') as string).trim() || undefined,
      })
      setShowForm(false)
      void fetchApps()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to create app')
    } finally {
      setSubmitting(false)
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'App name',
      render: (a: App) => (
        <span style={{ fontWeight: 500, color: 'var(--text)' }}>
          {a.name}
        </span>
      ),
    },
    { key: 'category', header: 'Category', render: (a: App) => a.category ?? <span style={{ color: 'var(--text-subtle)' }}>—</span> },
    { key: 'vendor', header: 'Vendor', render: (a: App) => a.vendor ?? <span style={{ color: 'var(--text-subtle)' }}>—</span> },
    {
      key: 'version',
      header: 'Version',
      render: (a: App) => a.version
        ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{a.version}</span>
        : <span style={{ color: 'var(--text-subtle)' }}>—</span>,
    },
    {
      key: 'eolDate',
      header: 'EOL date',
      render: (a: App) => <EolBadge eolDate={a.eolDate} />,
    },
    {
      key: 'docsUrl',
      header: 'Docs',
      render: (a: App) =>
        a.docsUrl
          ? <a href={a.docsUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontSize: 12, textDecoration: 'none' }}>↗ link</a>
          : <span style={{ color: 'var(--text-subtle)' }}>—</span>,
    },
  ]

  return (
    <AppShell title={appTitle} currentPath="/apps" onNavigate={onNavigate} user={user} onLogout={onLogout}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Apps catalog</h1>
          {canWrite && (
            <button
              onClick={() => setShowForm((v) => !v)}
              style={{
                height: 30, padding: '0 12px', background: 'var(--accent-soft)',
                border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)',
                color: 'var(--accent)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {showForm ? 'Cancel' : '+ Add app'}
            </button>
          )}
        </div>

        {/* Create form */}
        {showForm && (
          <form
            onSubmit={(e) => { void handleCreate(e) }}
            style={{
              background: 'var(--bg-elev)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: 16,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>New app</p>
            {formError && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{formError}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Name *
                <input name="name" required placeholder="PostgreSQL" style={INPUT_STYLE} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Category
                <input name="category" placeholder="database / automation / monitoring" style={INPUT_STYLE} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Vendor
                <input name="vendor" placeholder="PostgreSQL / n8n.io" style={INPUT_STYLE} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Version
                <input name="version" placeholder="16.1" style={INPUT_STYLE} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                EOL date
                <input name="eol_date" type="date" style={INPUT_STYLE} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Docs URL
                <input name="docs_url" type="url" placeholder="https://…" style={INPUT_STYLE} />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                style={{ height: 30, padding: '0 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{ height: 30, padding: '0 14px', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? 'Creating…' : 'Create app'}
              </button>
            </div>
          </form>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: '10px 14px', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, color: 'var(--danger)' }}>
            {error}
            <button onClick={() => { void fetchApps() }} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', textDecoration: 'underline' }}>Retry</button>
          </div>
        )}

        <DataTable<App>
          columns={columns}
          rows={apps}
          keyField="id"
          loading={loading}
          emptyMessage={
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>No apps in the catalog yet.</p>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>Add an app to track versions, EOL dates, and where it runs.</p>
              {canWrite && (
                <button
                  onClick={() => setShowForm(true)}
                  style={{ height: 30, padding: '0 14px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', color: 'var(--accent)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  + Add app
                </button>
              )}
            </div>
          }
        />
      </div>
    </AppShell>
  )
}
