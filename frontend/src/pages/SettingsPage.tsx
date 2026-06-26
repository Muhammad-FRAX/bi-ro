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

type TabId = 'users' | 'roles'

interface SettingsPageProps {
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
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
          {(['users', 'roles'] as TabId[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => { setTab(t); setError(null) }}
              style={tabStyle(tab === t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
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
