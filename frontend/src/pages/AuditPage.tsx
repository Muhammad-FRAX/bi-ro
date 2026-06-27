import { useState, useEffect, type FormEvent } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { Button } from '../components/ui/Button.tsx'
import { api, ApiError } from '../lib/api.ts'

interface AuditEntry {
  id: string
  actor_id: string | null
  actor_email: string | null
  action: string
  target_type: string | null
  target_id: string | null
  ip: string | null
  user_agent: string | null
  result: string
  ts: string
  detail: Record<string, unknown> | null
}

interface AuditResponse {
  entries: AuditEntry[]
}

interface Props {
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

const RESULT_COLOR: Record<string, string> = {
  ok: 'var(--success, #34d399)',
  denied: 'var(--warning, #fbbf24)',
  error: 'var(--danger, #f87171)',
  fail: 'var(--danger, #f87171)',
}

function ResultBadge({ result }: { result: string }) {
  const color = RESULT_COLOR[result] ?? 'var(--text-muted)'
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 7px',
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 600,
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {result}
    </span>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function AuditPage({ user, appTitle, onNavigate, onLogout }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [filterAction, setFilterAction] = useState('')
  const [filterResult, setFilterResult] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [offset, setOffset] = useState(0)
  const LIMIT = 50

  const canView = user.permissions.includes('audit.read')

  async function load(off = 0) {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('limit', String(LIMIT))
      params.set('offset', String(off))
      if (filterAction.trim()) params.set('action', filterAction.trim())
      if (filterResult.trim()) params.set('result', filterResult.trim())
      if (filterDateFrom.trim()) params.set('dateFrom', filterDateFrom.trim())
      if (filterDateTo.trim()) params.set('dateTo', filterDateTo.trim())

      const data = await api.get<AuditResponse>(`/admin/audit?${params.toString()}`)
      setEntries(data.entries)
      setOffset(off)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canView) void load(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView])

  function handleFilter(e: FormEvent) {
    e.preventDefault()
    void load(0)
  }

  function handleClear() {
    setFilterAction('')
    setFilterResult('')
    setFilterDateFrom('')
    setFilterDateTo('')
    // Load after state resets (use setTimeout to ensure state cleared)
    setTimeout(() => void load(0), 0)
  }

  if (!canView) {
    return (
      <AppShell
        title={appTitle ?? 'BI Root'}
        currentPath="/audit"
        onNavigate={onNavigate}
        user={user}
        onLogout={onLogout}
      >
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          You do not have permission to view the audit log.
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell
      title={appTitle ?? 'BI Root'}
      currentPath="/audit"
      onNavigate={onNavigate}
      user={user}
      onLogout={onLogout}
    >
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
          Audit Log
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
          Read-only record of all system events. Cannot be edited or deleted.
        </p>

        {/* Filters */}
        <form
          onSubmit={handleFilter}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 20,
            padding: '14px 16px',
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            alignItems: 'flex-end',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Action
            </label>
            <input
              type="text"
              placeholder="e.g. login, reveal"
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 13,
                color: 'var(--text)',
                fontFamily: 'inherit',
                width: 150,
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Result
            </label>
            <select
              value={filterResult}
              onChange={(e) => setFilterResult(e.target.value)}
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 13,
                color: 'var(--text)',
                fontFamily: 'inherit',
                width: 120,
              }}
            >
              <option value="">All</option>
              <option value="ok">ok</option>
              <option value="denied">denied</option>
              <option value="error">error</option>
              <option value="fail">fail</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              From
            </label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 13,
                color: 'var(--text)',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              To
            </label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 13,
                color: 'var(--text)',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <Button type="submit" size="sm" disabled={loading}>
            Filter
          </Button>
          <Button type="button" size="sm" intent="ghost" onClick={handleClear}>
            Clear
          </Button>
        </form>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: '10px 14px',
              background: 'color-mix(in srgb, var(--danger, #f87171) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--danger, #f87171) 30%, transparent)',
              borderRadius: 6,
              color: 'var(--danger, #f87171)',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading audit log…</div>
        )}

        {/* Table */}
        {!loading && !error && (
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              overflow: 'auto',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
              <thead>
                <tr style={{ background: 'var(--bg-elev)', borderBottom: '1px solid var(--border)' }}>
                  {['Timestamp', 'Actor', 'Action', 'Target', 'IP', 'Result'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '10px 14px',
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        padding: '48px 24px',
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                        fontSize: 13,
                      }}
                    >
                      No audit entries found.
                    </td>
                  </tr>
                )}
                {entries.map((entry, idx) => (
                  <tr
                    key={entry.id}
                    style={{
                      borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                      background: 'transparent',
                    }}
                  >
                    <td
                      style={{
                        padding: '10px 14px',
                        fontSize: 12,
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                        fontFamily: 'monospace',
                      }}
                    >
                      {formatDate(entry.ts)}
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        fontSize: 12,
                        color: 'var(--text)',
                        maxWidth: 180,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.actor_email ?? entry.actor_id ?? '—'}
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        fontSize: 12,
                        color: 'var(--text)',
                        fontFamily: 'monospace',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.action}
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        fontSize: 12,
                        color: 'var(--text-muted)',
                        maxWidth: 200,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.target_type
                        ? `${entry.target_type}${entry.target_id ? `:${entry.target_id.slice(0, 8)}…` : ''}`
                        : '—'}
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        fontSize: 12,
                        color: 'var(--text-muted)',
                        fontFamily: 'monospace',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.ip ?? '—'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <ResultBadge result={entry.result} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && entries.length > 0 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 12,
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            <span>
              Showing {offset + 1}–{offset + entries.length}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                size="sm"
                intent="ghost"
                disabled={offset === 0}
                onClick={() => void load(Math.max(0, offset - LIMIT))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                intent="ghost"
                disabled={entries.length < LIMIT}
                onClick={() => void load(offset + LIMIT)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
