import { useState, useEffect } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { api } from '../lib/api.ts'

interface Notification {
  id: string
  type: string
  severity: 'info' | 'warning' | 'danger'
  title: string
  body: string
  targetType: string | null
  targetId: string | null
  createdAt: string
  readAt: string | null
}

interface NotificationsPageProps {
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

function severityColor(severity: string) {
  if (severity === 'danger') return 'var(--danger)'
  if (severity === 'warning') return 'var(--warning)'
  return 'var(--accent)'
}

function severityLabel(severity: string) {
  if (severity === 'danger') return 'Critical'
  if (severity === 'warning') return 'Warning'
  return 'Info'
}

function formatRelative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function NotificationsPage({ user, appTitle, onNavigate, onLogout }: NotificationsPageProps) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<{ notifications: Notification[] }>(
        `/notifications${unreadOnly ? '?unread=true' : ''}`,
      )
      setNotifications(data.notifications)
    } catch {
      setError("Couldn't load notifications")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [unreadOnly])

  async function markRead(id: string) {
    try {
      await api.patch(`/notifications/${id}/read`, {})
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      )
    } catch {
      // best-effort
    }
  }

  async function markAllRead() {
    setMarkingAll(true)
    try {
      await api.patch('/notifications/read-all', {})
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
      )
    } catch {
      // best-effort
    } finally {
      setMarkingAll(false)
    }
  }

  const unreadCount = notifications.filter((n) => !n.readAt).length

  return (
    <AppShell
      title={appTitle}
      currentPath="/notifications"
      onNavigate={onNavigate}
      user={user}
      onLogout={onLogout}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
              Notifications
            </h1>
            {unreadCount > 0 && (
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                {unreadCount} unread
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
                style={{ accentColor: 'var(--accent)' }}
              />
              Unread only
            </label>
            {unreadCount > 0 && (
              <button
                onClick={() => void markAllRead()}
                disabled={markingAll}
                style={{
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--accent)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '4px 10px',
                  fontFamily: 'inherit',
                }}
              >
                {markingAll ? 'Marking…' : 'Mark all read'}
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
          }}
        >
          {loading ? (
            <div style={{ padding: 32 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    height: 48,
                    background: 'var(--bg-elev-2)',
                    borderRadius: 4,
                    marginBottom: i < 3 ? 8 : 0,
                    opacity: 1 - i * 0.2,
                  }}
                />
              ))}
            </div>
          ) : error ? (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <p style={{ margin: '0 0 8px', color: 'var(--danger)', fontSize: 13 }}>{error}</p>
              <button
                onClick={() => void load()}
                style={{
                  background: 'none',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '4px 10px',
                  fontFamily: 'inherit',
                }}
              >
                Retry
              </button>
            </div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: '48px 32px', textAlign: 'center' }}>
              <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
                You&apos;re all caught up.
              </p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                {unreadOnly
                  ? 'No unread notifications.'
                  : 'Notifications appear here when credentials are near expiry or workers report issues.'}
              </p>
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {notifications.map((n, idx) => (
                <li
                  key={n.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '12px 16px',
                    borderBottom:
                      idx < notifications.length - 1 ? '1px solid var(--border)' : 'none',
                    background: n.readAt ? 'transparent' : 'var(--accent-soft)',
                    transition: 'background 120ms',
                  }}
                >
                  {/* Severity dot */}
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: severityColor(n.severity),
                      flexShrink: 0,
                      marginTop: 5,
                    }}
                    title={severityLabel(n.severity)}
                  />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      style={{
                        margin: '0 0 2px',
                        fontSize: 13,
                        fontWeight: n.readAt ? 400 : 600,
                        color: 'var(--text)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {n.title}
                    </p>
                    {n.body && (
                      <p style={{ margin: '0 0 2px', fontSize: 12, color: 'var(--text-muted)' }}>
                        {n.body}
                      </p>
                    )}
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatRelative(n.createdAt)}
                      {n.targetType && n.targetId && (
                        <>
                          {' · '}
                          <a
                            href={`/${n.targetType}s/${n.targetId}`}
                            onClick={(e) => {
                              e.preventDefault()
                              onNavigate?.(`/${n.targetType}s/${n.targetId}`)
                            }}
                            style={{ color: 'var(--accent)', textDecoration: 'none' }}
                          >
                            View {n.targetType}
                          </a>
                        </>
                      )}
                    </p>
                  </div>

                  {!n.readAt && (
                    <button
                      onClick={() => void markRead(n.id)}
                      title="Mark as read"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-subtle)',
                        fontSize: 12,
                        padding: '2px 6px',
                        borderRadius: 'var(--radius-sm)',
                        flexShrink: 0,
                        fontFamily: 'inherit',
                      }}
                    >
                      ✓
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  )
}
