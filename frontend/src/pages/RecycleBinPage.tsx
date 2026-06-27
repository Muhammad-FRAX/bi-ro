import { useState, useEffect } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { Button } from '../components/ui/Button.tsx'
import { api, ApiError } from '../lib/api.ts'

type ItemType = 'servers' | 'apps' | 'documents' | 'secrets' | 'users'

interface RecycleBinItem {
  id: string
  type: ItemType
  label: string
  deletedAt: string
}

interface Props {
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

const TYPE_OPTIONS: { value: ItemType; label: string; perm: string }[] = [
  { value: 'servers', label: 'Servers', perm: 'infra.read' },
  { value: 'apps', label: 'Apps', perm: 'infra.read' },
  { value: 'documents', label: 'Documents', perm: 'docs.read' },
  { value: 'secrets', label: 'Secrets', perm: 'vault.manage_access' },
  { value: 'users', label: 'Users', perm: 'users.manage' },
]

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function RecycleBinPage({ user, appTitle, onNavigate, onLogout }: Props) {
  const [selectedType, setSelectedType] = useState<ItemType>('servers')
  const [items, setItems] = useState<RecycleBinItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const allowedTypes = TYPE_OPTIONS.filter((t) => user.permissions.includes(t.perm))

  async function load(type: ItemType) {
    setLoading(true)
    setError(null)
    setItems([])
    try {
      const data = await api.get<{ items: RecycleBinItem[] }>(`/recycle-bin?type=${type}`)
      setItems(data.items)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load recycle bin')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (allowedTypes.length > 0) {
      const first = allowedTypes[0]
      if (first) {
        setSelectedType(first.value)
        void load(first.value)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleTypeChange(type: ItemType) {
    setSelectedType(type)
    void load(type)
  }

  async function handleRestore(id: string) {
    setRestoring(id)
    setRestoreError(null)
    try {
      await api.post(`/recycle-bin/${selectedType}/${id}/restore`, {})
      setItems((prev) => prev.filter((item) => item.id !== id))
    } catch (err) {
      setRestoreError(err instanceof ApiError ? err.message : 'Restore failed')
    } finally {
      setRestoring(null)
    }
  }

  if (allowedTypes.length === 0) {
    return (
      <AppShell
        title={appTitle ?? 'BI Root'}
        currentPath="/recycle-bin"
        onNavigate={onNavigate}
        user={user}
        onLogout={onLogout}
      >
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          You do not have permission to view the recycle bin.
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell
      title={appTitle ?? 'BI Root'}
      currentPath="/recycle-bin"
      onNavigate={onNavigate}
      user={user}
      onLogout={onLogout}
    >
      <div style={{ maxWidth: 800 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
          Recycle Bin
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
          Soft-deleted items. Restore to bring them back.
        </p>

        {/* Type filter tabs */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            marginBottom: 20,
            borderBottom: '1px solid var(--border)',
            paddingBottom: 0,
          }}
        >
          {allowedTypes.map((t) => {
            const active = selectedType === t.value
            return (
              <button
                key={t.value}
                onClick={() => handleTypeChange(t.value)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'color 120ms',
                  marginBottom: -1,
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Error states */}
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

        {restoreError && (
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
            {restoreError}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        )}

        {/* Empty state */}
        {!loading && !error && items.length === 0 && (
          <div
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
              border: '1px dashed var(--border)',
              borderRadius: 8,
            }}
          >
            No deleted {selectedType} found.
          </div>
        )}

        {/* Items table */}
        {!loading && items.length > 0 && (
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    background: 'var(--bg-elev)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 16px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Name
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 16px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Deleted At
                  </th>
                  <th style={{ padding: '10px 16px', width: 100 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr
                    key={item.id}
                    style={{
                      borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                      background: 'transparent',
                    }}
                  >
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: 13,
                        color: 'var(--text)',
                        fontFamily: 'monospace',
                      }}
                    >
                      {item.label}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: 12,
                        color: 'var(--text-muted)',
                      }}
                    >
                      {formatDate(item.deletedAt)}
                    </td>
                    <td style={{ padding: '8px 16px', textAlign: 'right' }}>
                      <Button
                        size="sm"
                        intent="ghost"
                        disabled={restoring === item.id}
                        onClick={() => void handleRestore(item.id)}
                      >
                        {restoring === item.id ? 'Restoring…' : 'Restore'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
