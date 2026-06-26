import { useState, useEffect, type FormEvent } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Input } from '../components/ui/Input.tsx'
import { api, ApiError } from '../lib/api.ts'

interface Role {
  id: string
  name: string
  description: string
  isBuiltin: boolean
  permissions: string[]
}

interface UserRow {
  id: string
  email: string
  displayName: string
  authMode: string
  status: string
  forcePasswordChange: boolean
  roles: string[]
}

type TabId = 'users' | 'roles' | 'smtp' | 'notifications'

interface SettingsPageProps {
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

// ── SMTP Settings Sub-component ─────────────────────────────────────────────
function SmtpTab() {
  const [host, setHost] = useState('')
  const [port, setPort] = useState('587')
  const [secure, setSecure] = useState(false)
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [from, setFrom] = useState('')
  const [testTo, setTestTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<{ smtp: { host: string | null; port: number; secure: boolean; user: string | null; from: string | null; hasPassword: boolean } }>('/admin/smtp')
      .then((d) => {
        setHost(d.smtp.host ?? '')
        setPort(String(d.smtp.port))
        setSecure(d.smtp.secure)
        setUser(d.smtp.user ?? '')
        setFrom(d.smtp.from ?? '')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    try {
      await api.put('/admin/smtp', {
        host, port: parseInt(port, 10), secure, user: user || null,
        password: password || undefined, from: from || null,
      })
      setMsg({ text: 'SMTP settings saved.', ok: true })
      setPassword('')
    } catch {
      setMsg({ text: 'Failed to save SMTP settings.', ok: false })
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    if (!testTo.trim()) return
    setTesting(true)
    setMsg(null)
    try {
      await api.post('/admin/smtp/test', { to: testTo.trim() })
      setMsg({ text: `Test email sent to ${testTo}.`, ok: true })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Send failed'
      setMsg({ text: `Test failed: ${message}`, ok: false })
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>SMTP Configuration</h2>

      <form onSubmit={(e) => void handleSave(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <Input id="smtp-host" label="Host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.example.com" />
          <Input id="smtp-port" label="Port" type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Input id="smtp-user" label="Username (optional)" value={user} onChange={(e) => setUser(e.target.value)} placeholder="user@example.com" />
          <Input id="smtp-pass" label="Password (leave blank to keep existing)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end' }}>
          <Input id="smtp-from" label="From address" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="noreply@example.com" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', paddingBottom: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
            TLS (port 465)
          </label>
        </div>

        {msg && (
          <p style={{ margin: 0, fontSize: 13, color: msg.ok ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</p>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save SMTP'}</Button>
        </div>
      </form>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Send test email</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <Input id="smtp-test-to" label="Recipient" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
          <Button type="button" onClick={() => void handleTest()} disabled={testing || !testTo.trim()}>
            {testing ? 'Sending…' : 'Send test'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Notification Rules Sub-component ─────────────────────────────────────────
interface NotifRule {
  id: string
  kind: string
  thresholdDays: number | null
  enabled: boolean
}

function NotificationRulesTab() {
  const [rules, setRules] = useState<NotifRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  async function loadRules() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<{ rules: NotifRule[] }>('/notifications/rules')
      setRules(data.rules)
    } catch {
      setError("Couldn't load notification rules")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadRules() }, [])

  async function toggleRule(id: string, enabled: boolean) {
    setSaving(id)
    try {
      await api.patch(`/notifications/rules/${id}`, { enabled })
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)))
    } catch {
      // best-effort
    } finally {
      setSaving(null)
    }
  }

  const kindLabel: Record<string, string> = {
    expiry: 'Credential expiry',
    cert_expiry: 'Certificate expiry',
    worker_stale: 'Scanner stale',
    digest: 'Weekly digest',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Notification Rules</h2>
      {loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
      ) : error ? (
        <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.map((rule) => (
            <div
              key={rule.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                background: 'var(--bg-elev)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                  {kindLabel[rule.kind] ?? rule.kind}
                  {rule.thresholdDays !== null && (
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                      {' '}— {rule.thresholdDays === 0 ? 'at expiry' : `${rule.thresholdDays}d before`}
                    </span>
                  )}
                </p>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  disabled={saving === rule.id}
                  onChange={(e) => void toggleRule(rule.id, e.target.checked)}
                  style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
                />
                <span style={{ fontSize: 12, color: rule.enabled ? 'var(--success)' : 'var(--text-muted)' }}>
                  {rule.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SettingsPage({ user, appTitle, onNavigate, onLogout }: SettingsPageProps) {
  const [tab, setTab] = useState<TabId>('users')
  const [users, setUsers] = useState<UserRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create user form state
  const [showCreate, setShowCreate] = useState(false)
  const [createEmail, setCreateEmail] = useState('')
  const [createName, setCreateName] = useState('')
  const [createRole, setCreateRole] = useState('viewer')
  const [createPassword, setCreatePassword] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const canManageUsers = user.permissions.includes('users.manage')

  async function loadUsers() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<{ users: UserRow[] }>('/admin/users')
      setUsers(data.users)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You do not have permission to manage users.')
      } else {
        setError('Could not load users. Retry.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function loadRoles() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<{ roles: Role[] }>('/admin/roles')
      setRoles(data.roles)
    } catch {
      setError('Could not load roles. Retry.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'users') {
      void loadUsers()
    } else {
      void loadRoles()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault()
    setCreateError(null)
    if (!createEmail.trim() || !createName.trim() || !createPassword) {
      setCreateError('All fields are required.')
      return
    }
    setCreating(true)
    try {
      await api.post('/admin/users', {
        email: createEmail.trim(),
        displayName: createName.trim(),
        role: createRole,
        password: createPassword,
      })
      setShowCreate(false)
      setCreateEmail('')
      setCreateName('')
      setCreatePassword('')
      setCreateRole('viewer')
      void loadUsers()
    } catch (err) {
      if (err instanceof ApiError) {
        setCreateError(err.message)
      } else {
        setCreateError('Failed to create user.')
      }
    } finally {
      setCreating(false)
    }
  }

  const tabStyle = (active: boolean) => ({
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 500,
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    background: active ? 'var(--accent-soft)' : 'transparent',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'color 120ms, background 120ms',
  })

  return (
    <AppShell title={appTitle} currentPath="/settings" onNavigate={onNavigate} user={user} onLogout={onLogout}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>Settings</h1>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 4,
            width: 'fit-content',
          }}
          role="tablist"
          aria-label="Settings sections"
        >
          {(['users', 'roles', 'smtp', 'notifications'] as TabId[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => { setTab(t); setError(null) }}
              style={tabStyle(tab === t)}
            >
              {t === 'smtp' ? 'SMTP' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Users tab */}
        {tab === 'users' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                Users
              </h2>
              {canManageUsers && (
                <Button
                  intent="primary"
                  size="sm"
                  onClick={() => setShowCreate(true)}
                >
                  + Add user
                </Button>
              )}
            </div>

            {error && (
              <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>
                {error}{' '}
                <button
                  onClick={loadUsers}
                  style={{
                    color: 'var(--accent)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    padding: 0,
                    fontFamily: 'inherit',
                  }}
                >
                  Retry
                </button>
              </p>
            )}

            {showCreate && (
              <form
                onSubmit={handleCreateUser}
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
                aria-label="Create new user"
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    New user
                  </h3>
                  <Button
                    size="sm"
                    intent="ghost"
                    type="button"
                    onClick={() => { setShowCreate(false); setCreateError(null) }}
                  >
                    Cancel
                  </Button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Input
                    id="create-email"
                    label="Email"
                    type="email"
                    value={createEmail}
                    onChange={(e) => setCreateEmail(e.target.value)}
                    placeholder="user@example.com"
                    required
                  />
                  <Input
                    id="create-name"
                    label="Display name"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="Jane Smith"
                    required
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label
                      htmlFor="create-role"
                      style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}
                    >
                      Role
                    </label>
                    <select
                      id="create-role"
                      value={createRole}
                      onChange={(e) => setCreateRole(e.target.value)}
                      style={{
                        height: 'var(--input-h)',
                        padding: '0 10px',
                        fontSize: 13,
                        background: 'var(--bg-elev-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--text)',
                        fontFamily: 'inherit',
                        width: '100%',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="viewer_secrets">Viewer (secrets)</option>
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <Input
                    id="create-password"
                    label="Temporary password"
                    type="password"
                    value={createPassword}
                    onChange={(e) => setCreatePassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>

                {createError && (
                  <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>
                    {createError}
                  </p>
                )}

                <Button
                  type="submit"
                  intent="primary"
                  size="sm"
                  disabled={creating}
                  style={{ alignSelf: 'flex-start' }}
                >
                  {creating ? 'Creating…' : 'Create user'}
                </Button>
              </form>
            )}

            <DataTable<UserRow>
              columns={[
                { key: 'email', header: 'Email' },
                { key: 'displayName', header: 'Name' },
                {
                  key: 'roles',
                  header: 'Role',
                  render: (row) => (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 8px',
                        background: 'var(--accent-soft)',
                        color: 'var(--accent)',
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      {row.roles.join(', ') || '—'}
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (row) => (
                    <span
                      style={{
                        color:
                          row.status === 'active'
                            ? 'var(--success)'
                            : row.status === 'suspended'
                            ? 'var(--danger)'
                            : 'var(--warning)',
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      {row.status}
                    </span>
                  ),
                },
                {
                  key: 'forcePasswordChange',
                  header: 'Must change pw',
                  render: (row) =>
                    row.forcePasswordChange ? (
                      <span style={{ color: 'var(--warning)', fontSize: 12 }}>Yes</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No</span>
                    ),
                },
              ]}
              rows={users}
              keyField="id"
              loading={loading}
              emptyMessage="No users yet. Add your first user."
            />
          </div>
        )}

        {/* SMTP tab */}
        {tab === 'smtp' && <SmtpTab />}

        {/* Notifications Rules tab */}
        {tab === 'notifications' && <NotificationRulesTab />}

        {/* Roles tab */}
        {tab === 'roles' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              Roles
            </h2>

            {error && (
              <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>
                {error}
              </p>
            )}

            {loading ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading roles…</p>
            ) : roles.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No roles found.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {roles.map((role) => (
                  <div
                    key={role.id}
                    style={{
                      background: 'var(--bg-elev)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      padding: '14px 16px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                        {role.name}
                      </span>
                      {role.isBuiltin && (
                        <span
                          style={{
                            fontSize: 11,
                            color: 'var(--text-subtle)',
                            background: 'var(--bg-elev-2)',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            padding: '1px 6px',
                          }}
                        >
                          built-in
                        </span>
                      )}
                    </div>
                    <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)' }}>
                      {role.description}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {role.permissions.map((perm) => (
                        <span
                          key={perm}
                          style={{
                            fontSize: 11,
                            color: 'var(--text-muted)',
                            background: 'var(--bg-elev-2)',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            padding: '2px 6px',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {perm}
                        </span>
                      ))}
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
