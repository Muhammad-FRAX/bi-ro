import { useState, useEffect, type FormEvent, type CSSProperties } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { Button } from '../components/ui/Button.tsx'
import { RevealDialog } from '../components/RevealDialog.tsx'
import { api, ApiError } from '../lib/api.ts'

interface Secret {
  id: string
  vault_id: string
  type: string
  title: string
  username: string | null
  host_url: string | null
  notes: string | null
  key_version: string
  rotation_period_days: number | null
  expires_at: string | null
  last_changed_at: string
  created_at: string
  days_remaining: number | null
}

interface HistoryEntry {
  id: string
  secret_id: string
  key_version: string
  changed_at: string
  changed_by: string | null
  reason: string | null
}

interface Props {
  secretId: string
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

const FIELD_LABEL: CSSProperties = {
  fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase',
  letterSpacing: '0.06em', fontWeight: 600, marginBottom: 2,
}

const FIELD_VALUE: CSSProperties = { fontSize: 13, color: 'var(--text)' }

const FIELD: CSSProperties = {
  height: 'var(--input-h)', background: 'var(--bg-elev-2)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  padding: '0 10px', fontSize: 13, color: 'var(--text)',
  fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box',
}

function MetaField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={FIELD_LABEL}>{label}</div>
      <div style={FIELD_VALUE}>{children}</div>
    </div>
  )
}

function DaysRemainingBadge({ days }: { days: number | null }) {
  if (days === null) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No expiry set</span>
  const BADGE: CSSProperties = {
    display: 'inline-block', padding: '2px 8px', borderRadius: 99,
    fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
  }
  const c = days < 0 ? 'var(--danger)' : days <= 7 ? 'var(--warning)' : 'var(--success)'
  return (
    <span style={{ ...BADGE, color: c, background: `color-mix(in srgb, ${c} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 25%, transparent)`, fontVariantNumeric: 'tabular-nums' }}>
      {days < 0 ? `${Math.abs(Math.round(days))}d overdue` : `${Math.round(days)}d remaining`}
    </span>
  )
}

const TABS: CSSProperties = {
  display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 20,
}
const TAB = (active: boolean): CSSProperties => ({
  padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: active ? 600 : 400,
  color: active ? 'var(--accent)' : 'var(--text-muted)', background: 'none', border: 'none',
  borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
  marginBottom: -1, transition: 'color 120ms', fontFamily: 'inherit',
})

export function SecretDetailPage({ secretId, user, appTitle, onNavigate, onLogout }: Props) {
  const [secret, setSecret] = useState<Secret | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details')
  const [revealOpen, setRevealOpen] = useState(false)

  // Rotate form
  const [showRotate, setShowRotate] = useState(false)
  const [newValue, setNewValue] = useState('')
  const [rotateReason, setRotateReason] = useState('')
  const [rotating, setRotating] = useState(false)

  const canReveal = user.permissions.includes('secrets.reveal')
  const canEdit = user.permissions.includes('secrets.edit')

  async function load() {
    setLoading(true); setError(null)
    try {
      const s = await api.get<Secret>(`/secrets/${secretId}`)
      setSecret(s)
      if (activeTab === 'history') {
        const h = await api.get<HistoryEntry[]>(`/secrets/${secretId}/history`)
        setHistory(h)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load secret')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [secretId])

  async function loadHistory() {
    try {
      const h = await api.get<HistoryEntry[]>(`/secrets/${secretId}/history`)
      setHistory(h)
    } catch {
      /* non-critical */
    }
  }

  async function handleRotate(e: FormEvent) {
    e.preventDefault()
    if (!newValue) return
    setRotating(true)
    try {
      await api.patch(`/secrets/${secretId}`, { newValue, reason: rotateReason || undefined })
      setNewValue(''); setRotateReason(''); setShowRotate(false)
      await load()
      await loadHistory()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to rotate')
    } finally {
      setRotating(false)
    }
  }

  if (loading) {
    return (
      <AppShell title={appTitle ?? 'BI Root'} currentPath="/vault" onNavigate={onNavigate} user={user} onLogout={onLogout}>
        <div style={{ color: 'var(--text-muted)', padding: 24 }}>Loading…</div>
      </AppShell>
    )
  }

  if (error || !secret) {
    return (
      <AppShell title={appTitle ?? 'BI Root'} currentPath="/vault" onNavigate={onNavigate} user={user} onLogout={onLogout}>
        <div style={{ color: 'var(--danger)', padding: 24 }} role="alert">{error ?? 'Not found'}</div>
      </AppShell>
    )
  }

  return (
    <AppShell title={appTitle ?? 'BI Root'} currentPath="/vault" onNavigate={onNavigate} user={user} onLogout={onLogout}>
      {revealOpen && (
        <RevealDialog secretId={secret.id} secretTitle={secret.title} onClose={() => setRevealOpen(false)} />
      )}

      <div style={{ maxWidth: 720, padding: '0 4px' }}>
        {/* Breadcrumb */}
        <div style={{ marginBottom: 16, fontSize: 12, color: 'var(--text-muted)' }}>
          <button onClick={() => onNavigate?.('/vault')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, fontFamily: 'inherit', padding: 0 }}>
            Vaults
          </button>
          {' / '}
          <button onClick={() => onNavigate?.(`/vault/${secret.vault_id}`)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, fontFamily: 'inherit', padding: 0 }}>
            Vault
          </button>
          {' / '}
          <span>{secret.title}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            {secret.title}
          </h1>
          <div style={{ display: 'flex', gap: 8 }}>
            {canReveal && (
              <Button intent="primary" size="sm" onClick={() => setRevealOpen(true)}>
                Reveal
              </Button>
            )}
            {canEdit && !showRotate && (
              <Button intent="secondary" size="sm" onClick={() => setShowRotate(true)}>
                Rotate
              </Button>
            )}
          </div>
        </div>

        <div style={TABS}>
          <button style={TAB(activeTab === 'details')} onClick={() => setActiveTab('details')}>Details</button>
          <button style={TAB(activeTab === 'history')} onClick={() => { setActiveTab('history'); void loadHistory() }}>
            History
          </button>
        </div>

        {activeTab === 'details' && (
          <>
            {showRotate && (
              <form
                onSubmit={(e) => void handleRotate(e)}
                style={{
                  background: 'var(--bg-elev)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '16px 18px', marginBottom: 20,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
                  Rotate credential
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>
                    New value *
                  </label>
                  <input type="password" style={FIELD} value={newValue} onChange={(e) => setNewValue(e.target.value)} required placeholder="Enter new secret value" autoComplete="new-password" />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>
                    Reason (optional)
                  </label>
                  <input style={FIELD} value={rotateReason} onChange={(e) => setRotateReason(e.target.value)} placeholder="e.g. Quarterly rotation" />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button type="submit" intent="primary" size="sm" disabled={rotating || !newValue}>
                    {rotating ? 'Rotating…' : 'Rotate & save history'}
                  </Button>
                  <Button type="button" intent="ghost" size="sm" onClick={() => setShowRotate(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}

            <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px 24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                <MetaField label="Type">{secret.type.replace('_', ' ')}</MetaField>
                <MetaField label="Username">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{secret.username ?? '—'}</span>
                </MetaField>
                <MetaField label="Host / URL">{secret.host_url ?? '—'}</MetaField>
                <MetaField label="Key version">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{secret.key_version}</span>
                </MetaField>
                <MetaField label="Expiry">
                  <DaysRemainingBadge days={secret.days_remaining} />
                </MetaField>
                <MetaField label="Last changed">
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                    {new Date(secret.last_changed_at).toLocaleString()}
                  </span>
                </MetaField>
                {secret.rotation_period_days && (
                  <MetaField label="Rotation period">
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{secret.rotation_period_days}d</span>
                  </MetaField>
                )}
                {secret.notes && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <MetaField label="Notes">{secret.notes}</MetaField>
                  </div>
                )}
              </div>

              {/* Secret value placeholder */}
              <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
                <div style={FIELD_LABEL}>Secret value</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: 13, letterSpacing: '0.12em',
                    color: 'var(--text-subtle)', background: 'var(--bg-elev-2)',
                    padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)', flex: 1,
                  }}>
                    {'•'.repeat(16)}
                  </div>
                  {canReveal && (
                    <Button intent="primary" size="sm" onClick={() => setRevealOpen(true)}>
                      Reveal
                    </Button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 6 }}>
                  Every reveal requires re-authentication and is logged in the audit trail.
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'history' && (
          <div>
            {history.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}>
                No history yet. Rotating a credential writes an entry here.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {history.map((h) => (
                  <div key={h.id} style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 16, padding: '10px 14px',
                    background: 'var(--bg-elev)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', fontSize: 13,
                  }}>
                    <div>
                      <div style={FIELD_LABEL}>Changed at</div>
                      <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                        {new Date(h.changed_at).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div style={FIELD_LABEL}>Reason</div>
                      <div style={{ color: h.reason ? 'var(--text)' : 'var(--text-muted)' }}>
                        {h.reason ?? '—'}
                      </div>
                    </div>
                    <div>
                      <div style={FIELD_LABEL}>Key version</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{h.key_version}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
