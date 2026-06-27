import { useState, useEffect, useCallback, type CSSProperties, type FormEvent } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { RevealDialog } from '../components/RevealDialog.tsx'
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
  vaultId: string | null
  vaultName: string | null
  ownerId: string | null
  canEdit: boolean
}

interface AppInstance {
  id: string
  serverId: string
  hostname: string
  environment: string
  version: string | null
  notes: string | null
  createdAt: string
}

interface AppSecret {
  id: string
  title: string
  type: string
  username: string | null
  hostUrl: string | null
  daysRemaining: number | null
  lastChangedAt: string | null
  vaultId: string
  vaultName: string
}

interface Vault { id: string; name: string }

interface AppsPageProps {
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

const INPUT: CSSProperties = {
  height: 30, padding: '0 8px', background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
  width: '100%', boxSizing: 'border-box',
}
const GHOST_BTN: CSSProperties = {
  height: 28, padding: '0 10px', background: 'none', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
}
const PRIMARY_BTN: CSSProperties = {
  height: 28, padding: '0 12px', background: 'var(--accent)', border: 'none',
  borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}

function EolBadge({ eolDate }: { eolDate: string | null }) {
  if (!eolDate) return <span style={{ color: 'var(--text-subtle)' }}>—</span>
  const ms = new Date(eolDate).getTime() - Date.now()
  const daysLeft = Math.floor(ms / 86_400_000)
  const color = daysLeft < 0 ? 'var(--danger)' : daysLeft < 90 ? 'var(--warning)' : 'var(--text-muted)'
  const label = daysLeft < 0 ? `EOL ${Math.abs(daysLeft)}d ago` : daysLeft < 90 ? `EOL in ${daysLeft}d` : eolDate
  return <span style={{ fontSize: 12, color, fontVariantNumeric: 'tabular-nums' }}>{label}</span>
}

function EnvBadge({ env }: { env: string }) {
  const color =
    env === 'prod' ? 'var(--danger)' :
    env === 'staging' ? 'var(--warning)' :
    env === 'dev' ? 'var(--success)' :
    'var(--text-muted)'
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color, background: `color-mix(in srgb, ${color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`, borderRadius: 3, padding: '1px 5px' }}>
      {env}
    </span>
  )
}

function VaultBadge({ name }: { name: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', borderRadius: 3, padding: '1px 6px', letterSpacing: '0.04em' }}>
      vault: {name}
    </span>
  )
}

function SecretTypeBadge({ type }: { type: string }) {
  const color =
    type === 'ssh' ? 'var(--success)' :
    type === 'api_key' ? 'var(--warning)' :
    type === 'certificate' ? '#a78bfa' :
    'var(--text-muted)'
  return (
    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color, background: `color-mix(in srgb, ${color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`, borderRadius: 3, padding: '1px 5px' }}>
      {type.replace('_', ' ')}
    </span>
  )
}

export function AppsPage({ user, appTitle, onNavigate, onLogout }: AppsPageProps) {
  const [apps, setApps] = useState<App[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addVaultId, setAddVaultId] = useState('')

  const [vaults, setVaults] = useState<Vault[]>([])

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [instances, setInstances] = useState<Record<string, AppInstance[]>>({})
  const [instancesLoading, setInstancesLoading] = useState<Record<string, boolean>>({})
  const [secrets, setSecrets] = useState<Record<string, AppSecret[]>>({})
  const [secretsLoading, setSecretsLoading] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<App & { vaultId: string }>>({})
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [revealTarget, setRevealTarget] = useState<{ id: string; title: string } | null>(null)

  const canViewSecrets = user.permissions.includes('secrets.view')

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

  useEffect(() => {
    api.get<Vault[]>('/vaults')
      .then((d) => setVaults(Array.isArray(d) ? d : []))
      .catch(() => { /* non-fatal — user may not have vault access */ })
  }, [])

  async function loadInstances(appId: string) {
    if (instances[appId]) return
    setInstancesLoading((p) => ({ ...p, [appId]: true }))
    try {
      const data = await api.get<{ instances: AppInstance[] }>(`/apps/${appId}/instances`)
      setInstances((p) => ({ ...p, [appId]: data.instances }))
    } catch {
      setInstances((p) => ({ ...p, [appId]: [] }))
    } finally {
      setInstancesLoading((p) => ({ ...p, [appId]: false }))
    }
  }

  async function loadSecrets(appId: string) {
    if (secrets[appId]) return
    setSecretsLoading((p) => ({ ...p, [appId]: true }))
    try {
      const data = await api.get<{ secrets: AppSecret[] }>(`/apps/${appId}/secrets`)
      setSecrets((p) => ({ ...p, [appId]: data.secrets }))
    } catch {
      setSecrets((p) => ({ ...p, [appId]: [] }))
    } finally {
      setSecretsLoading((p) => ({ ...p, [appId]: false }))
    }
  }

  function toggleExpand(appId: string) {
    if (expandedId === appId) {
      setExpandedId(null)
    } else {
      setExpandedId(appId)
      void loadInstances(appId)
      if (canViewSecrets) void loadSecrets(appId)
    }
  }

  function openEdit(app: App) {
    setEditingId(app.id)
    setEditDraft({
      name: app.name,
      category: app.category ?? '',
      vendor: app.vendor ?? '',
      version: app.version ?? '',
      eolDate: app.eolDate ?? '',
      docsUrl: app.docsUrl ?? '',
      notes: app.notes ?? '',
      vaultId: app.vaultId ?? '',
    })
    setEditError(null)
  }

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAddError(null)
    setAddSubmitting(true)
    const fd = new FormData(e.currentTarget)
    try {
      await api.post('/apps', {
        name: (fd.get('name') as string).trim(),
        category: (fd.get('category') as string).trim() || undefined,
        vendor: (fd.get('vendor') as string).trim() || undefined,
        version: (fd.get('version') as string).trim() || undefined,
        eol_date: (fd.get('eol_date') as string).trim() || undefined,
        docs_url: (fd.get('docs_url') as string).trim() || undefined,
        vaultId: addVaultId || undefined,
      })
      setShowAddForm(false)
      setAddVaultId('')
      void fetchApps()
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : 'Failed to create app')
    } finally {
      setAddSubmitting(false)
    }
  }

  async function handleEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editingId) return
    setEditError(null)
    setEditSubmitting(true)
    try {
      await api.patch(`/apps/${editingId}`, {
        name: editDraft.name,
        category: editDraft.category || null,
        vendor: editDraft.vendor || null,
        version: editDraft.version || null,
        eol_date: editDraft.eolDate || null,
        docs_url: editDraft.docsUrl || null,
        notes: editDraft.notes || null,
        vaultId: editDraft.vaultId || null,
      })
      setEditingId(null)
      void fetchApps()
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Failed to update app')
    } finally {
      setEditSubmitting(false)
    }
  }

  const TD: CSSProperties = { padding: '0 12px', fontSize: 13, color: 'var(--text)', textAlign: 'left' }
  const TH: CSSProperties = { ...TD, fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }

  return (
    <AppShell title={appTitle} currentPath="/apps" onNavigate={onNavigate} user={user} onLogout={onLogout}>
      {revealTarget && (
        <RevealDialog
          secretId={revealTarget.id}
          secretTitle={revealTarget.title}
          onClose={() => setRevealTarget(null)}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Apps</h1>
          <button
            onClick={() => { setShowAddForm((v) => !v); setAddError(null) }}
            style={{ height: 30, padding: '0 12px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', color: 'var(--accent)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {showAddForm ? 'Cancel' : '+ Add app'}
          </button>
        </div>

        {/* Add form */}
        {showAddForm && (
          <form onSubmit={(e) => { void handleCreate(e) }} style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>New app</p>
            {addError && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{addError}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Name *<input name="name" required placeholder="PostgreSQL" style={INPUT} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Category<input name="category" placeholder="database / automation" style={INPUT} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Vendor<input name="vendor" placeholder="PostgreSQL / n8n.io" style={INPUT} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Version<input name="version" placeholder="16.1" style={INPUT} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                EOL date<input name="eol_date" type="date" style={INPUT} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Docs URL<input name="docs_url" type="url" placeholder="https://…" style={INPUT} />
              </label>
              {vaults.length > 0 && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)', gridColumn: '1 / -1' }}>
                  Vault (optional — assign to a vault to make it a shared team app)
                  <select value={addVaultId} onChange={(e) => setAddVaultId(e.target.value)} style={{ ...INPUT, height: 30 }}>
                    <option value="">— Personal / catalog app —</option>
                    {vaults.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => { setShowAddForm(false); setAddVaultId('') }} style={GHOST_BTN}>Cancel</button>
              <button type="submit" disabled={addSubmitting} style={{ ...PRIMARY_BTN, height: 30, opacity: addSubmitting ? 0.6 : 1 }}>
                {addSubmitting ? 'Creating…' : 'Create app'}
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

        {/* Apps table */}
        {loading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : apps.length === 0 ? (
          <div style={{ padding: '48px 0', textAlign: 'center' }}>
            <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>No apps yet.</p>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>Add an app to track versions, EOL dates, and shared credentials.</p>
            <button onClick={() => setShowAddForm(true)} style={{ height: 30, padding: '0 14px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', color: 'var(--accent)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>+ Add app</button>
          </div>
        ) : (
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={TH}>App name</th>
                  <th style={TH}>Category</th>
                  <th style={TH}>Vendor</th>
                  <th style={TH}>Version</th>
                  <th style={TH}>EOL date</th>
                  <th style={TH}>Docs</th>
                  <th style={TH} />
                </tr>
              </thead>
              <tbody>
                {apps.map((app) => (
                  <>
                    {/* Main row */}
                    <tr
                      key={app.id}
                      style={{ height: 38, borderBottom: expandedId === app.id || editingId === app.id ? 'none' : '1px solid var(--border)', background: expandedId === app.id ? 'color-mix(in srgb, var(--accent) 4%, transparent)' : 'transparent', cursor: 'pointer' }}
                      onClick={() => { if (editingId !== app.id) toggleExpand(app.id) }}
                    >
                      <td style={TD}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 10, color: expandedId === app.id ? 'var(--accent)' : 'var(--text-subtle)', transition: 'transform 0.15s', display: 'inline-block', transform: expandedId === app.id ? 'rotate(90deg)' : 'none' }}>▶</span>
                          <span style={{ fontWeight: 500, color: 'var(--text)' }}>{app.name}</span>
                          {app.vaultId && app.vaultName && <VaultBadge name={app.vaultName} />}
                        </div>
                      </td>
                      <td style={TD}>{app.category ?? <span style={{ color: 'var(--text-subtle)' }}>—</span>}</td>
                      <td style={TD}>{app.vendor ?? <span style={{ color: 'var(--text-subtle)' }}>—</span>}</td>
                      <td style={TD}>
                        {app.version
                          ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{app.version}</span>
                          : <span style={{ color: 'var(--text-subtle)' }}>—</span>}
                      </td>
                      <td style={TD}><EolBadge eolDate={app.eolDate} /></td>
                      <td style={TD}>
                        {app.docsUrl
                          ? <a href={app.docsUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent)', fontSize: 12, textDecoration: 'none' }}>↗ link</a>
                          : <span style={{ color: 'var(--text-subtle)' }}>—</span>}
                      </td>
                      <td style={{ ...TD, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        {app.canEdit && (
                          <button
                            onClick={() => { editingId === app.id ? setEditingId(null) : openEdit(app) }}
                            style={{ background: 'none', border: 'none', color: editingId === app.id ? 'var(--text-muted)' : 'var(--accent)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: '2px 8px' }}
                          >
                            {editingId === app.id ? 'Cancel' : 'Edit'}
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Edit form row */}
                    {editingId === app.id && (
                      <tr key={`${app.id}-edit`} style={{ borderBottom: '1px solid var(--border)', background: 'color-mix(in srgb, var(--accent) 4%, transparent)' }}>
                        <td colSpan={7} style={{ padding: '12px 14px' }}>
                          <form onSubmit={(e) => { void handleEdit(e) }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Edit app</p>
                            {editError && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{editError}</p>}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                                Name *
                                <input required value={editDraft.name ?? ''} onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))} style={INPUT} />
                              </label>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                                Category
                                <input value={editDraft.category ?? ''} onChange={(e) => setEditDraft((p) => ({ ...p, category: e.target.value }))} placeholder="database / automation" style={INPUT} />
                              </label>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                                Vendor
                                <input value={editDraft.vendor ?? ''} onChange={(e) => setEditDraft((p) => ({ ...p, vendor: e.target.value }))} style={INPUT} />
                              </label>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                                Version
                                <input value={editDraft.version ?? ''} onChange={(e) => setEditDraft((p) => ({ ...p, version: e.target.value }))} style={INPUT} />
                              </label>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                                EOL date
                                <input type="date" value={editDraft.eolDate ?? ''} onChange={(e) => setEditDraft((p) => ({ ...p, eolDate: e.target.value }))} style={INPUT} />
                              </label>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                                Docs URL
                                <input type="url" value={editDraft.docsUrl ?? ''} onChange={(e) => setEditDraft((p) => ({ ...p, docsUrl: e.target.value }))} placeholder="https://…" style={INPUT} />
                              </label>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                                Notes
                                <input value={editDraft.notes ?? ''} onChange={(e) => setEditDraft((p) => ({ ...p, notes: e.target.value }))} placeholder="Any notes about this app" style={INPUT} />
                              </label>
                              {vaults.length > 0 && (
                                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-muted)', gridColumn: 'span 2' }}>
                                  Vault
                                  <select value={editDraft.vaultId ?? ''} onChange={(e) => setEditDraft((p) => ({ ...p, vaultId: e.target.value }))} style={{ ...INPUT, height: 30 }}>
                                    <option value="">— Personal / catalog app —</option>
                                    {vaults.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                                  </select>
                                </label>
                              )}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                              <button type="button" onClick={() => setEditingId(null)} style={GHOST_BTN}>Cancel</button>
                              <button type="submit" disabled={editSubmitting} style={{ ...PRIMARY_BTN, opacity: editSubmitting ? 0.6 : 1 }}>
                                {editSubmitting ? 'Saving…' : 'Save changes'}
                              </button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}

                    {/* Expanded detail row */}
                    {expandedId === app.id && editingId !== app.id && (
                      <tr key={`${app.id}-expand`} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td colSpan={7} style={{ padding: '12px 14px 16px', background: 'color-mix(in srgb, var(--accent) 4%, transparent)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                            {app.notes && (
                              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>{app.notes}</p>
                            )}

                            {/* Credentials section */}
                            {canViewSecrets && (
                              <div>
                                <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>Credentials</div>
                                {secretsLoading[app.id] ? (
                                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
                                ) : !secrets[app.id] || secrets[app.id]!.length === 0 ? (
                                  <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontStyle: 'italic' }}>No credentials linked to this app.</div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {secrets[app.id]!.map((s) => (
                                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                                        <SecretTypeBadge type={s.type} />
                                        <span style={{ fontWeight: 500, fontSize: 13, color: 'var(--text)', flex: 1 }}>{s.title}</span>
                                        {s.username && (
                                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{s.username}</span>
                                        )}
                                        <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{s.vaultName}</span>
                                        <button
                                          onClick={() => setRevealTarget({ id: s.id, title: s.title })}
                                          style={{ height: 24, padding: '0 10px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', color: 'var(--accent)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                                        >
                                          Reveal
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Running on servers */}
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>
                                Running on
                              </div>
                              {instancesLoading[app.id] ? (
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
                              ) : !instances[app.id] || instances[app.id]!.length === 0 ? (
                                <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontStyle: 'italic' }}>Not deployed on any server yet.</div>
                              ) : (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                  {instances[app.id]!.map((inst) => (
                                    <button
                                      key={inst.id}
                                      onClick={() => onNavigate?.(`/servers/${inst.serverId}`)}
                                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', transition: 'border-color 0.15s' }}
                                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                                    >
                                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{inst.hostname}</span>
                                      <EnvBadge env={inst.environment} />
                                      {inst.version && (
                                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>v{inst.version}</span>
                                      )}
                                      <span style={{ fontSize: 11, color: 'var(--accent)', marginLeft: 2 }}>→</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
