import { useState, useEffect, useCallback, type CSSProperties, type FormEvent } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { api, ApiError } from '../lib/api.ts'

interface Tag { id: string; name: string; color: string }
interface Server {
  id: string
  hostname: string
  environment: string
  os: string | null
  location: string | null
  status: string
  ips: string[]
  notes: string | null
  tags: Tag[]
  createdAt: string
}

interface ServersPageProps {
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

const ENV_OPTIONS = ['', 'prod', 'staging', 'dev', 'other'] as const
const STATUS_OPTIONS = ['', 'active', 'decommissioned', 'maintenance'] as const

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'active' ? 'var(--success)' :
    status === 'decommissioned' ? 'var(--text-subtle)' :
    'var(--warning)'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 7px',
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.02em',
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      <span
        aria-hidden
        style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }}
      />
      {status}
    </span>
  )
}

function EnvBadge({ env }: { env: string }) {
  const color =
    env === 'prod' ? 'var(--danger)' :
    env === 'staging' ? 'var(--warning)' :
    env === 'dev' ? 'var(--success)' :
    'var(--text-subtle)'

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 7px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        color,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
        textTransform: 'uppercase',
      }}
    >
      {env}
    </span>
  )
}

function TagPill({ tag }: { tag: Tag }) {
  return (
    <span
      key={tag.id}
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 4,
        fontSize: 11,
        color: tag.color,
        background: `color-mix(in srgb, ${tag.color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tag.color} 30%, transparent)`,
        marginRight: 3,
      }}
    >
      {tag.name}
    </span>
  )
}

const SELECT_STYLE: CSSProperties = {
  height: 30,
  padding: '0 8px',
  background: 'var(--bg-elev-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const INPUT_STYLE: CSSProperties = {
  height: 30,
  padding: '0 8px',
  background: 'var(--bg-elev-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  flex: 1,
  minWidth: 0,
}

export function ServersPage({ user, appTitle, onNavigate, onLogout }: ServersPageProps) {
  const [servers, setServers] = useState<Server[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [envFilter, setEnvFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const canWrite = user.permissions.includes('servers.write')

  const fetchServers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (envFilter) params.set('environment', envFilter)
      if (statusFilter) params.set('status', statusFilter)
      if (tagFilter) params.set('tag', tagFilter)
      const qs = params.toString() ? `?${params.toString()}` : ''
      const data = await api.get<{ servers: Server[] }>(`/servers${qs}`)
      setServers(data.servers)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load servers')
    } finally {
      setLoading(false)
    }
  }, [envFilter, statusFilter, tagFilter])

  useEffect(() => { void fetchServers() }, [fetchServers])

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    setSubmitting(true)
    const fd = new FormData(e.currentTarget)
    const hostname = (fd.get('hostname') as string).trim()
    const environment = fd.get('environment') as string
    const os = (fd.get('os') as string).trim()
    const location = (fd.get('location') as string).trim()
    const notes = (fd.get('notes') as string).trim()
    const ipsRaw = (fd.get('ips') as string).trim()
    const ips = ipsRaw ? ipsRaw.split(',').map((ip) => ip.trim()).filter(Boolean) : []
    try {
      await api.post('/servers', { hostname, environment, os: os || undefined, location: location || undefined, notes: notes || undefined, ips })
      setShowForm(false)
      void fetchServers()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to create server')
    } finally {
      setSubmitting(false)
    }
  }

  const columns = [
    {
      key: 'hostname',
      header: 'Hostname',
      render: (s: Server) => (
        <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          {s.hostname}
        </span>
      ),
    },
    {
      key: 'environment',
      header: 'Env',
      render: (s: Server) => <EnvBadge env={s.environment} />,
    },
    { key: 'os', header: 'OS', render: (s: Server) => s.os ?? <span style={{ color: 'var(--text-subtle)' }}>—</span> },
    { key: 'location', header: 'Location', render: (s: Server) => s.location ?? <span style={{ color: 'var(--text-subtle)' }}>—</span> },
    {
      key: 'status',
      header: 'Status',
      render: (s: Server) => <StatusBadge status={s.status} />,
    },
    {
      key: 'tags',
      header: 'Tags',
      render: (s: Server) =>
        s.tags.length > 0
          ? s.tags.map((t) => <TagPill key={t.id} tag={t} />)
          : <span style={{ color: 'var(--text-subtle)' }}>—</span>,
    },
  ]

  return (
    <AppShell title={appTitle} currentPath="/servers" onNavigate={onNavigate} user={user} onLogout={onLogout}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Servers</h1>
          {canWrite && (
            <button
              onClick={() => setShowForm((v) => !v)}
              style={{
                height: 30,
                padding: '0 12px',
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--accent)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {showForm ? 'Cancel' : '+ Add server'}
            </button>
          )}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
            Env
            <select value={envFilter} onChange={(e) => setEnvFilter(e.target.value)} style={SELECT_STYLE}>
              {ENV_OPTIONS.map((o) => <option key={o} value={o}>{o || 'All'}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={SELECT_STYLE}>
              {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o || 'All'}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
            Tag
            <input
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              placeholder="tag name"
              style={{ ...INPUT_STYLE, width: 120 }}
            />
          </label>
        </div>

        {/* New server form */}
        {showForm && (
          <form
            onSubmit={(e) => { void handleCreate(e) }}
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>New server</p>
            {formError && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{formError}</p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Hostname *
                <input name="hostname" required placeholder="etl-01" style={INPUT_STYLE} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Environment
                <select name="environment" defaultValue="other" style={SELECT_STYLE}>
                  {ENV_OPTIONS.slice(1).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                OS
                <input name="os" placeholder="Ubuntu 22.04" style={INPUT_STYLE} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Location
                <input name="location" placeholder="DC1 / AWS us-east-1" style={INPUT_STYLE} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                IP Addresses
                <input name="ips" placeholder="192.168.1.1, 10.0.0.2" style={INPUT_STYLE} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)', gridColumn: '1 / -1' }}>
                Notes
                <input name="notes" placeholder="Optional notes" style={INPUT_STYLE} />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                style={{
                  height: 30, padding: '0 12px', background: 'none',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  height: 30, padding: '0 14px', background: 'var(--accent)',
                  border: 'none', borderRadius: 'var(--radius-sm)',
                  color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                {submitting ? 'Creating…' : 'Create server'}
              </button>
            </div>
          </form>
        )}

        {/* Error state */}
        {error && (
          <div
            style={{
              padding: '10px 14px',
              background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 13,
              color: 'var(--danger)',
            }}
          >
            {error}
            <button
              onClick={() => { void fetchServers() }}
              style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', textDecoration: 'underline' }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Table */}
        <DataTable<Server>
          columns={columns}
          rows={servers}
          keyField="id"
          loading={loading}
          onRowClick={(s) => onNavigate?.(`/servers/${s.id}`)}
          emptyMessage={
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
                No servers yet — document your first.
              </p>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>
                Add a server to start building your infrastructure documentation.
              </p>
              {canWrite && (
                <button
                  onClick={() => setShowForm(true)}
                  style={{
                    height: 30, padding: '0 14px', background: 'var(--accent-soft)',
                    border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)',
                    color: 'var(--accent)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  + Add server
                </button>
              )}
            </div>
          }
        />
      </div>
    </AppShell>
  )
}
