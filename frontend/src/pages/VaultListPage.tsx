import { useState, useEffect, type FormEvent, type CSSProperties } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { Button } from '../components/ui/Button.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { api, ApiError } from '../lib/api.ts'

interface Vault {
  id: string
  name: string
  type: 'team' | 'personal'
  owner_id: string | null
  created_at: string
  member_count: number
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

function VaultTypeBadge({ type }: { type: string }) {
  const c = type === 'team' ? 'var(--accent)' : 'var(--text-muted)'
  return (
    <span style={{ ...BADGE, color: c, background: `color-mix(in srgb, ${c} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 30%, transparent)` }}>
      {type}
    </span>
  )
}

export function VaultListPage({ user, appTitle, onNavigate, onLogout }: Props) {
  const [vaults, setVaults] = useState<Vault[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const canManage = user.permissions.includes('vault.manage_access')

  async function load() {
    setLoading(true); setError(null)
    try {
      const data = await api.get<Vault[]>('/vaults')
      setVaults(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load vaults')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      await api.post('/vaults', { name: newName.trim(), type: 'team' })
      setNewName(''); setShowNew(false)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create vault')
    } finally {
      setCreating(false)
    }
  }

  return (
    <AppShell
      title={appTitle ?? 'BI Root'}
      currentPath="/vault"
      onNavigate={onNavigate}
      user={user}
      onLogout={onLogout}
    >
      <div style={{ maxWidth: 900, padding: '0 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            Team Vaults
          </h1>
          {canManage && !showNew && (
            <Button intent="primary" size="sm" onClick={() => setShowNew(true)}>
              + New vault
            </Button>
          )}
        </div>

        {showNew && (
          <form
            onSubmit={(e) => void handleCreate(e)}
            style={{
              display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16,
              background: 'var(--bg-elev)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '12px 14px',
            }}
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Vault name"
              required
              autoFocus
              style={{
                flex: 1, height: 'var(--input-h)', background: 'var(--bg-elev-2)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                padding: '0 10px', fontSize: 13, color: 'var(--text)', fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <Button type="submit" intent="primary" size="sm" disabled={creating || !newName.trim()}>
              {creating ? 'Creating…' : 'Create'}
            </Button>
            <Button type="button" intent="ghost" size="sm" onClick={() => { setShowNew(false); setNewName('') }}>
              Cancel
            </Button>
          </form>
        )}

        {error && (
          <div
            style={{
              background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
              borderRadius: 'var(--radius-sm)', padding: '8px 12px',
              fontSize: 13, color: 'var(--danger)', marginBottom: 14,
            }}
            role="alert"
          >
            {error}
          </div>
        )}

        <DataTable<Vault>
          columns={[
            {
              key: 'name',
              label: 'Name',
              render: (v) => (
                <button
                  onClick={() => onNavigate?.(`/vault/${v.id}`)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--accent)', fontSize: 13, fontFamily: 'inherit',
                    padding: 0, textAlign: 'left',
                  }}
                >
                  {v.name}
                </button>
              ),
            },
            { key: 'type', label: 'Type', render: (v) => <VaultTypeBadge type={v.type} /> },
            {
              key: 'member_count',
              label: 'Members',
              render: (v) => (
                <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                  {v.member_count}
                </span>
              ),
            },
            {
              key: 'created_at',
              label: 'Created',
              render: (v) => (
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {new Date(v.created_at).toLocaleDateString()}
                </span>
              ),
            },
          ]}
          rows={vaults}
          loading={loading}
          emptyMessage={
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
              <div style={{ marginBottom: 8 }}>No credentials here yet.</div>
              {canManage && (
                <Button intent="primary" size="sm" onClick={() => setShowNew(true)}>
                  + New vault
                </Button>
              )}
            </div>
          }
        />
      </div>
    </AppShell>
  )
}
