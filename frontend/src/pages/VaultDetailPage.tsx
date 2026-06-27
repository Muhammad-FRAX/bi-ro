import { useState, useEffect, type FormEvent, type CSSProperties } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { Button } from '../components/ui/Button.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { RevealDialog } from '../components/RevealDialog.tsx'
import { ConfirmDialog } from '../components/ConfirmDialog.tsx'
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
  server_id: string | null
  server_hostname: string | null
  app_id: string | null
  app_name: string | null
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

  // Servers + apps lists (for link selectors)
  const [servers, setServers] = useState<{ id: string; hostname: string }[]>([])
  const [apps, setApps] = useState<{ id: string; name: string }[]>([])

  // Edit credential
  const [editingSecret, setEditingSecret] = useState<Secret | null>(null)
  const [editDraft, setEditDraft] = useState({ title: '', type: 'generic', username: '', hostUrl: '', notes: '', rotationPeriodDays: '', serverId: '', appId: '' })
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // New secret form
  const [showNew, setShowNew] = useState(false)
  const [newSecret, setNewSecret] = useState({
    title: '', type: 'generic', username: '', value: '',
    hostUrl: '', rotationPeriodDays: '', serverId: '', appId: '',
  })
  const [creating, setCreating] = useState(false)

  // Reveal dialog
  const [revealTarget, setRevealTarget] = useState<{ id: string; title: string } | null>(null)

  // Confirm delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Member management
  const [userSearch, setUserSearch] = useState('')
  const [userResults, setUserResults] = useState<{ id: string; displayName: string; email: string }[]>([])
  const [userSearchOpen, setUserSearchOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<{ id: string; displayName: string; email: string } | null>(null)
  const [newMemberAccess, setNewMemberAccess] = useState<'view' | 'reveal' | 'manage'>('view')
  const [addingMember, setAddingMember] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [confirmRemoveMember, setConfirmRemoveMember] = useState<VaultMember | null>(null)

  // Password generator
  const [genLength, setGenLength] = useState(20)
  const [genCharset, setGenCharset] = useState<'alphanumeric' | 'symbols' | 'pronounceable'>('symbols')
  const [generated, setGenerated] = useState<string | null>(null)
  const [generatingPw, setGeneratingPw] = useState(false)

  const canCreate = user.permissions.includes('secrets.create')
  const canReveal = user.permissions.includes('secrets.reveal')
  const canManage = user.permissions.includes('vault.manage_access')
  const canEdit   = user.permissions.includes('secrets.edit')

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
      .catch(() => {})
    api.get<{ apps: { id: string; name: string }[] }>('/apps')
      .then((d) => setApps(d.apps))
      .catch(() => {})
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
        appId: newSecret.appId || undefined,
      })
      setNewSecret({ title: '', type: 'generic', username: '', value: '', hostUrl: '', rotationPeriodDays: '', serverId: '', appId: '' })
      setShowNew(false)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create secret')
    } finally {
      setCreating(false)
    }
  }

  function openEdit(s: Secret) {
    setEditDraft({
      title: s.title,
      type: s.type,
      username: s.username ?? '',
      hostUrl: s.host_url ?? '',
      notes: s.notes ?? '',
      rotationPeriodDays: s.rotation_period_days?.toString() ?? '',
      serverId: s.server_id ?? '',
      appId: s.app_id ?? '',
    })
    setEditError(null)
    setEditingSecret(s)
  }

  async function handleEditSecret(e: FormEvent) {
    e.preventDefault()
    if (!editingSecret) return
    setEditSubmitting(true); setEditError(null)
    try {
      await api.patch(`/secrets/${editingSecret.id}`, {
        title: editDraft.title,
        type: editDraft.type,
        username: editDraft.username || null,
        hostUrl: editDraft.hostUrl || null,
        notes: editDraft.notes || null,
        rotationPeriodDays: editDraft.rotationPeriodDays ? Number(editDraft.rotationPeriodDays) : null,
        serverId: editDraft.serverId || null,
        appId: editDraft.appId || null,
      })
      setEditingSecret(null)
      await load()
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Update failed')
    } finally {
      setEditSubmitting(false)
    }
  }

  async function handleDeleteSecret(id: string) {
    try {
      await api.delete(`/secrets/${id}`)
      setConfirmDeleteId(null)
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

  // User search for member picker
  useEffect(() => {
    if (!userSearch.trim() || !userSearchOpen) { setUserResults([]); return }
    const t = setTimeout(() => {
      api.get<{ users: { id: string; displayName: string; email: string }[] }>(`/vault/users?q=${encodeURIComponent(userSearch)}`)
        .then((d) => setUserResults(d.users))
        .catch(() => setUserResults([]))
    }, 200)
    return () => clearTimeout(t)
  }, [userSearch, userSearchOpen])

  async function handleAddMember(e: FormEvent) {
    e.preventDefault()
    if (!selectedUser) return
    setAddingMember(true); setMemberError(null)
    try {
      await api.post(`/vaults/${vaultId}/members`, { userId: selectedUser.id, access: newMemberAccess })
      await load()
      setSelectedUser(null); setUserSearch(''); setUserResults([]); setNewMemberAccess('view')
    } catch (err) {
      setMemberError(err instanceof ApiError ? err.message : 'Failed to add member')
    } finally {
      setAddingMember(false)
    }
  }

  async function handleRemoveMember(userId: string) {
    try {
      await api.delete(`/vaults/${vaultId}/members/${userId}`)
      setConfirmRemoveMember(null)
      await load()
    } catch (err) {
      setMemberError(err instanceof ApiError ? err.message : 'Failed to remove member')
      setConfirmRemoveMember(null)
    }
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

      {/* Edit credential modal */}
      {editingSecret && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditingSecret(null) }}>
          <form
            onSubmit={(e) => void handleEditSecret(e)}
            style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '24px 28px', width: 520, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Edit credential</h2>
              <button type="button" onClick={() => setEditingSecret(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
            </div>
            {editError && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{editError}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Title *
                <input required style={FIELD} value={editDraft.title} onChange={(e) => setEditDraft((p) => ({ ...p, title: e.target.value }))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Type
                <select style={FIELD} value={editDraft.type} onChange={(e) => setEditDraft((p) => ({ ...p, type: e.target.value }))}>
                  {SECRET_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Username / identity
                <input style={FIELD} value={editDraft.username} onChange={(e) => setEditDraft((p) => ({ ...p, username: e.target.value }))} placeholder="e.g. postgres" />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Host / URL
                <input style={FIELD} value={editDraft.hostUrl} onChange={(e) => setEditDraft((p) => ({ ...p, hostUrl: e.target.value }))} placeholder="e.g. db-01:5432" />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Linked server
                <select style={FIELD} value={editDraft.serverId} onChange={(e) => setEditDraft((p) => ({ ...p, serverId: e.target.value, appId: e.target.value ? '' : p.appId }))}>
                  <option value="">— none —</option>
                  {servers.map((s) => <option key={s.id} value={s.id}>{s.hostname}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Linked app
                <select style={FIELD} value={editDraft.appId} onChange={(e) => setEditDraft((p) => ({ ...p, appId: e.target.value, serverId: e.target.value ? '' : p.serverId }))}>
                  <option value="">— none —</option>
                  {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Rotation period (days)
                <input type="number" min={1} style={{ ...FIELD, width: '100%' }} value={editDraft.rotationPeriodDays} onChange={(e) => setEditDraft((p) => ({ ...p, rotationPeriodDays: e.target.value }))} placeholder="e.g. 90" />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', gridColumn: '1 / -1' }}>
                Notes
                <input style={FIELD} value={editDraft.notes} onChange={(e) => setEditDraft((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" />
              </label>
            </div>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-subtle)', fontStyle: 'italic' }}>
              To rotate the secret value, use the "Rotate password" button on the secret detail page.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setEditingSecret(null)} style={{ height: 32, padding: '0 14px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button type="submit" disabled={editSubmitting} style={{ height: 32, padding: '0 14px', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: editSubmitting ? 0.6 : 1 }}>
                {editSubmitting ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}
      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete secret"
          message="Delete this secret? This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => void handleDeleteSecret(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
      {confirmRemoveMember && (
        <ConfirmDialog
          title="Remove member"
          message={`Remove ${confirmRemoveMember.display_name} from this vault? They will lose access to all credentials in it.`}
          confirmLabel="Remove"
          onConfirm={() => void handleRemoveMember(confirmRemoveMember.user_id)}
          onCancel={() => setConfirmRemoveMember(null)}
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
                    <select style={FIELD} value={newSecret.serverId} onChange={(e) => setNewSecret((p) => ({ ...p, serverId: e.target.value, appId: e.target.value ? '' : p.appId }))}>
                      <option value="">— none —</option>
                      {servers.map((s) => <option key={s.id} value={s.id}>{s.hostname}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Linked app</label>
                    <select style={FIELD} value={newSecret.appId} onChange={(e) => setNewSecret((p) => ({ ...p, appId: e.target.value, serverId: e.target.value ? '' : p.serverId }))}>
                      <option value="">— none —</option>
                      {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
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
                  header: 'Title',
                  render: (s) => (
                    <button
                      onClick={() => onNavigate?.(`/secrets/${s.id}`)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 13, fontFamily: 'inherit', padding: 0, textAlign: 'left', fontWeight: 500 }}
                    >
                      {s.title}
                    </button>
                  ),
                },
                {
                  key: 'server_hostname',
                  header: 'Server / App',
                  render: (s) => {
                    if (s.server_hostname) return (
                      <button onClick={() => onNavigate?.(`/servers/${s.server_id}`)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 0 }}>
                        {s.server_hostname}
                      </button>
                    )
                    if (s.app_name) return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.app_name}</span>
                    if (s.host_url) return <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontFamily: 'var(--font-mono)' }}>{s.host_url}</span>
                    return <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>—</span>
                  },
                },
                { key: 'type', header: 'Type', render: (s) => <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.type.replace(/_/g, ' ')}</span> },
                { key: 'username', header: 'Username', render: (s) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{s.username ?? '—'}</span> },
                {
                  key: 'days_remaining',
                  header: 'Expires in',
                  render: (s) => <DaysRemainingBadge days={s.days_remaining} />,
                },
              ]}
              rows={secrets}
              keyField="id"
              loading={false}
              emptyMessage={
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
                  <div style={{ marginBottom: 8 }}>No credentials here yet.</div>
                  {canCreate && (
                    <Button intent="primary" size="sm" onClick={() => setShowNew(true)}>+ Add credential</Button>
                  )}
                </div>
              }
              rowActions={(s) => (
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  {canEdit && (
                    <Button size="sm" intent="secondary" onClick={() => openEdit(s)}>Edit</Button>
                  )}
                  {canReveal && (
                    <Button size="sm" intent="secondary" onClick={() => setRevealTarget({ id: s.id, title: s.title })}>Reveal</Button>
                  )}
                  {canManage && (
                    <Button size="sm" intent="danger" onClick={() => setConfirmDeleteId(s.id)}>Delete</Button>
                  )}
                </div>
              )}
            />
          </>
        )}

        {activeTab === 'members' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Add member form — only for vault managers */}
            {canManage && (
              <form
                onSubmit={(e) => { void handleAddMember(e) }}
                style={{ background: 'var(--bg-elev-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Add member</p>
                {memberError && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{memberError}</p>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  {/* User picker */}
                  <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 160 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                      User
                      {selectedUser ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 8px', background: 'var(--bg-elev-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
                          <span style={{ flex: 1, color: 'var(--text)' }}>{selectedUser.displayName}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedUser.email}</span>
                          <button type="button" onClick={() => { setSelectedUser(null); setUserSearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                        </div>
                      ) : (
                        <input
                          value={userSearch}
                          onChange={(e) => { setUserSearch(e.target.value); setUserSearchOpen(true) }}
                          onFocus={() => setUserSearchOpen(true)}
                          placeholder="Search by name or email…"
                          style={{ height: 30, padding: '0 8px', background: 'var(--bg-elev-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
                        />
                      )}
                    </label>
                    {userSearchOpen && !selectedUser && userResults.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', maxHeight: 180, overflowY: 'auto', marginTop: 2 }}>
                        {userResults.map((u) => (
                          <div
                            key={u.id}
                            onMouseDown={() => { setSelectedUser(u); setUserSearch(''); setUserSearchOpen(false) }}
                            style={{ padding: '7px 10px', fontSize: 13, cursor: 'pointer', display: 'flex', gap: 8 }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elev-2)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <span style={{ fontWeight: 500, color: 'var(--text)' }}>{u.displayName}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>{u.email}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Access level */}
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)', flex: '0 0 auto' }}>
                    Access
                    <select
                      value={newMemberAccess}
                      onChange={(e) => setNewMemberAccess(e.target.value as 'view' | 'reveal' | 'manage')}
                      style={{ height: 30, padding: '0 8px', background: 'var(--bg-elev-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}
                    >
                      <option value="view">View</option>
                      <option value="reveal">Reveal</option>
                      <option value="manage">Manage</option>
                    </select>
                  </label>
                  <button
                    type="submit"
                    disabled={!selectedUser || addingMember}
                    style={{ height: 30, padding: '0 14px', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: (!selectedUser || addingMember) ? 0.5 : 1 }}
                  >
                    {addingMember ? 'Adding…' : '+ Add'}
                  </button>
                </div>
              </form>
            )}

            {/* Members list */}
            <DataTable<VaultMember>
              columns={[
                { key: 'display_name', header: 'Name', render: (m) => <span style={{ fontSize: 13, fontWeight: 500 }}>{m.display_name}</span> },
                { key: 'email', header: 'Email', render: (m) => <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{m.email}</span> },
                {
                  key: 'access',
                  header: 'Access',
                  render: (m) => {
                    const c = m.access === 'manage' ? 'var(--accent)' : m.access === 'reveal' ? 'var(--success)' : 'var(--text-muted)'
                    return <span style={{ fontSize: 12, color: c, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{m.access}</span>
                  },
                },
              ]}
              rows={vault?.members ?? []}
              keyField="user_id"
              loading={false}
              emptyMessage="No members yet."
              rowActions={canManage ? (m) => (
                <Button size="sm" intent="danger" onClick={() => setConfirmRemoveMember(m)}>
                  Remove
                </Button>
              ) : undefined}
            />
          </div>
        )}
      </div>
    </AppShell>
  )
}
