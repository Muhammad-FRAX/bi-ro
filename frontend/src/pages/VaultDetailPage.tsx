import { useState, useEffect, type FormEvent, type CSSProperties } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { Button } from '../components/ui/Button.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { RevealDialog } from '../components/RevealDialog.tsx'
import { api, ApiError } from '../lib/api.ts'

interface VaultMember {
  user_id: string
  access: 'view' | 'reveal' | 'manage'
  email: string
  display_name: string
}

interface Vault {
  id: string
  name: string
  type: 'team' | 'personal'
  owner_id: string | null
  created_at: string
  members: VaultMember[]
}

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

interface Props {
  vaultId: string
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

const BADGE: CSSProperties = {
  display: 'inline-block', padding: '2px 7px', borderRadius: 99,
  fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
}

function DaysRemainingBadge({ days }: { days: number | null }) {
  if (days === null) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
  const c = days < 0 ? 'var(--danger)' : days <= 7 ? 'var(--warning)' : 'var(--success)'
  return (
    <span style={{ ...BADGE, color: c, background: `color-mix(in srgb, ${c} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 25%, transparent)`, fontVariantNumeric: 'tabular-nums' }}>
      {days < 0 ? `${Math.abs(Math.round(days))}d overdue` : `${Math.round(days)}d`}
    </span>
  )
}

const SECRET_TYPES = ['server_login', 'db_credential', 'api_key', 'ssh_key', 'certificate', 'generic'] as const

export function VaultDetailPage({ vaultId, user, appTitle, onNavigate, onLogout }: Props) {
  const [vault, setVault] = useState<Vault | null>(null)
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'secrets' | 'members'>('secrets')

  // Servers list (for server-link selector)
  const [servers, setServers] = useState<{ id: string; hostname: string }[]>([])

  // New secret form
  const [showNew, setShowNew] = useState(false)
  const [newSecret, setNewSecret] = useState({
    title: '', type: 'generic', username: '', value: '',
    hostUrl: '', rotationPeriodDays: '', serverId: '',
  })
  const [creating, setCreating] = useState(false)

  // Reveal dialog
  const [revealTarget, setRevealTarget] = useState<{ id: string; title: string } | null>(null)

  // Password generator
  const [genLength, setGenLength] = useState(20)
  const [genCharset, setGenCharset] = useState<'alphanumeric' | 'symbols' | 'pronounceable'>('symbols')
  const [generated, setGenerated] = useState<string | null>(null)
  const [generatingPw, setGeneratingPw] = useState(false)

  const canCreate = user.permissions.includes('secrets.create')
  const canReveal = user.permissions.includes('secrets.reveal')
  const canManage = user.permissions.includes('vault.manage_access')

  async function load() {
    setLoading(true); setError(null)
    try {
      const [v, s] = await Promise.all([
        api.get<Vault>(`/vaults/${vaultId}`),
        api.get<Secret[]>(`/vaults/${vaultId}/secrets`),
      ])
      setVault(v); setSecrets(s)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You are not a member of this vault.')
      } else {
        setError(err instanceof ApiError ? err.message : 'Failed to load vault')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [vaultId])

  useEffect(() => {
    api.get<{ servers: { id: string; hostname: string }[] }>('/servers')
      .then((d) => setServers(d.servers))
      .catch(() => { /* non-fatal; selector stays empty */ })
  }, [])

  async function handleCreateSecret(e: FormEvent) {
    e.preventDefault()
    if (!newSecret.title || !newSecret.value) return
    setCreating(true)
    try {
      await api.post('/secrets', {
        vaultId,
        type: newSecret.type,
        title: newSecret.title,
        username: newSecret.username || undefined,
        value: newSecret.value,
        hostUrl: newSecret.hostUrl || undefined,
        rotationPeriodDays: newSecret.rotationPeriodDays ? Number(newSecret.rotationPeriodDays) : undefined,
        serverId: newSecret.serverId || undefined,
      })
      setNewSecret({ title: '', type: 'generic', username: '', value: '', hostUrl: '', rotationPeriodDays: '', serverId: '' })
      setShowNew(false)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create secret')
    } finally {
      setCreating(false)
    }
  }

  async function handleDeleteSecret(id: string) {
    if (!confirm('Delete this secret? This cannot be undone.')) return
    try {
      await api.delete(`/secrets/${id}`)
      setSecrets((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete')
    }
  }

  async function generatePassword() {
    setGeneratingPw(true)
    try {
      // Use crypto API client-side for password generation (no server needed)
      const { generatePassword } = await import('../lib/passwordGenerator.ts')
      setGenerated(generatePassword({ length: genLength, charset: genCharset }))
    } catch {
      setGenerated(null)
    } finally {
      setGeneratingPw(false)
    }
  }

  function useGenerated() {
    if (generated) setNewSecret((prev) => ({ ...prev, value: generated }))
  }

  const FIELD: CSSProperties = {
    height: 'var(--input-h)', background: 'var(--bg-elev-2)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    padding: '0 10px', fontSize: 13, color: 'var(--text)',
    fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box',
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

  if (loading) {
    return (
      <AppShell title={appTitle ?? 'BI Root'} currentPath="/vault" onNavigate={onNavigate} user={user} onLogout={onLogout}>
        <div style={{ color: 'var(--text-muted)', padding: 24 }}>Loading vault…</div>
      </AppShell>
    )
  }

  if (error) {
    return (
      <AppShell title={appTitle ?? 'BI Root'} currentPath="/vault" onNavigate={onNavigate} user={user} onLogout={onLogout}>
        <div style={{ color: 'var(--danger)', padding: 24 }} role="alert">{error}</div>
      </AppShell>
    )
  }

  return (
    <AppShell title={appTitle ?? 'BI Root'} currentPath="/vault" onNavigate={onNavigate} user={user} onLogout={onLogout}>
      {revealTarget && (
        <RevealDialog
          secretId={revealTarget.id}
          secretTitle={revealTarget.title}
          onClose={() => setRevealTarget(null)}
        />
      )}

      <div style={{ maxWidth: 960, padding: '0 4px' }}>
        {/* Breadcrumb */}
        <div style={{ marginBottom: 16, fontSize: 12, color: 'var(--text-muted)' }}>
          <button onClick={() => onNavigate?.('/vault')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, fontFamily: 'inherit', padding: 0 }}>
            Vaults
          </button>
          {' / '}
          <span>{vault?.name}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            {vault?.name}
            <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
              {vault?.type}
            </span>
          </h1>
          {canCreate && activeTab === 'secrets' && !showNew && (
            <Button intent="primary" size="sm" onClick={() => setShowNew(true)}>
              + Add credential
            </Button>
          )}
        </div>

        <div style={TABS}>
          <button style={TAB(activeTab === 'secrets')} onClick={() => setActiveTab('secrets')}>
            Credentials ({secrets.length})
          </button>
          <button style={TAB(activeTab === 'members')} onClick={() => setActiveTab('members')}>
            Members ({vault?.members.length ?? 0})
          </button>
        </div>

        {activeTab === 'secrets' && (
          <>
            {showNew && (
              <form
                onSubmit={(e) => void handleCreateSecret(e)}
                style={{
                  background: 'var(--bg-elev)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '16px 18px', marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
                  New credential
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Title *</label>
                    <input style={FIELD} value={newSecret.title} onChange={(e) => setNewSecret((p) => ({ ...p, title: e.target.value }))} required placeholder="e.g. DB prod password" />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Type</label>
                    <select style={FIELD} value={newSecret.type} onChange={(e) => setNewSecret((p) => ({ ...p, type: e.target.value }))}>
                      {SECRET_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Username / identity</label>
                    <input style={FIELD} value={newSecret.username} onChange={(e) => setNewSecret((p) => ({ ...p, username: e.target.value }))} placeholder="e.g. postgres" />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Host / URL</label>
                    <input style={FIELD} value={newSecret.hostUrl} onChange={(e) => setNewSecret((p) => ({ ...p, hostUrl: e.target.value }))} placeholder="e.g. db-01:5432" />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Linked server</label>
                    <select style={FIELD} value={newSecret.serverId} onChange={(e) => setNewSecret((p) => ({ ...p, serverId: e.target.value }))}>
                      <option value="">— none —</option>
                      {servers.map((s) => <option key={s.id} value={s.id}>{s.hostname}</option>)}
                    </select>
                  </div>
                </div>

                {/* Password generator */}
                <div style={{ background: 'var(--bg-elev-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Password generator</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select style={{ ...FIELD, width: 'auto', flex: '0 0 auto' }} value={genCharset} onChange={(e) => setGenCharset(e.target.value as typeof genCharset)}>
                      <option value="symbols">Symbols</option>
                      <option value="alphanumeric">Alphanumeric</option>
                      <option value="pronounceable">Pronounceable</option>
                    </select>
                    <input type="number" min={8} max={128} value={genLength} onChange={(e) => setGenLength(Number(e.target.value))} style={{ ...FIELD, width: 60, flex: '0 0 auto' }} />
                    <Button type="button" size="sm" intent="secondary" onClick={() => void generatePassword()} disabled={generatingPw}>
                      Generate
                    </Button>
                    {generated && (
                      <>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)', background: 'var(--bg)', padding: '2px 6px', borderRadius: 4, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {generated}
                        </code>
                        <Button type="button" size="sm" intent="ghost" onClick={useGenerated}>
                          Use
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>
                    Secret value *
                  </label>
                  <input
                    type="password"
                    style={FIELD}
                    value={newSecret.value}
                    onChange={(e) => setNewSecret((p) => ({ ...p, value: e.target.value }))}
                    required
                    placeholder="Enter or generate a secret value"
                    autoComplete="new-password"
                  />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>
                    Rotation period (days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    style={{ ...FIELD, width: 120 }}
                    value={newSecret.rotationPeriodDays}
                    onChange={(e) => setNewSecret((p) => ({ ...p, rotationPeriodDays: e.target.value }))}
                    placeholder="e.g. 90"
                  />
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <Button type="submit" intent="primary" size="sm" disabled={creating}>
                    {creating ? 'Saving…' : 'Save credential'}
                  </Button>
                  <Button type="button" intent="ghost" size="sm" onClick={() => setShowNew(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}

            <DataTable<Secret>
              columns={[
                {
                  key: 'title',
                  label: 'Title',
                  render: (s) => (
                    <button
                      onClick={() => onNavigate?.(`/secrets/${s.id}`)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 13, fontFamily: 'inherit', padding: 0, textAlign: 'left' }}
                    >
                      {s.title}
                    </button>
                  ),
                },
                { key: 'type', label: 'Type', render: (s) => <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.type.replace('_', ' ')}</span> },
                { key: 'username', label: 'Username', render: (s) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{s.username ?? '—'}</span> },
                {
                  key: 'days_remaining',
                  label: 'Expires in',
                  render: (s) => <DaysRemainingBadge days={s.days_remaining} />,
                },
                {
                  key: 'last_changed_at',
                  label: 'Last changed',
                  render: (s) => <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{new Date(s.last_changed_at).toLocaleDateString()}</span>,
                },
                {
                  key: 'id',
                  label: '',
                  render: (s) => (
                    <div style={{ display: 'flex', gap: 6 }}>
                      {canReveal && (
                        <Button size="sm" intent="secondary" onClick={() => setRevealTarget({ id: s.id, title: s.title })}>
                          Reveal
                        </Button>
                      )}
                      {canManage && (
                        <Button size="sm" intent="danger" onClick={() => void handleDeleteSecret(s.id)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
              rows={secrets}
              loading={false}
              emptyMessage={
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
                  <div style={{ marginBottom: 8 }}>No credentials here yet.</div>
                  {canCreate && (
                    <Button intent="primary" size="sm" onClick={() => setShowNew(true)}>+ Add credential</Button>
                  )}
                </div>
              }
            />
          </>
        )}

        {activeTab === 'members' && (
          <DataTable<VaultMember>
            columns={[
              { key: 'email', label: 'Email', render: (m) => <span style={{ fontSize: 13 }}>{m.email}</span> },
              { key: 'display_name', label: 'Name', render: (m) => <span style={{ fontSize: 13 }}>{m.display_name}</span> },
              {
                key: 'access',
                label: 'Access',
                render: (m) => {
                  const c = m.access === 'manage' ? 'var(--accent)' : m.access === 'reveal' ? 'var(--success)' : 'var(--text-muted)'
                  return (
                    <span style={{ fontSize: 12, color: c, fontWeight: 600 }}>{m.access}</span>
                  )
                },
              },
            ]}
            rows={vault?.members ?? []}
            loading={false}
            emptyMessage="No members yet."
          />
        )}
      </div>
    </AppShell>
  )
}
