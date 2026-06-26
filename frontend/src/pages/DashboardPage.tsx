import { useState, useEffect } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { api } from '../lib/api.ts'

interface ExpiringItem {
  id: string
  title: string
  type: string
  vaultId: string
  vaultName: string
  daysRemaining: number | null
  expiresAt: string | null
}

interface DashboardPageProps {
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

function DaysRemainingBadge({ days }: { days: number | null }) {
  if (days === null) return null
  const rounded = Math.floor(days)
  let bg = 'var(--success)'
  let color = '#000'
  if (days <= 0) { bg = 'var(--danger)'; color = '#fff' }
  else if (days <= 2) { bg = 'var(--danger)'; color = '#fff' }
  else if (days <= 7) { bg = 'var(--warning)'; color = '#000' }
  return (
    <span
      style={{
        background: bg,
        color,
        borderRadius: 'var(--radius-sm)',
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 6px',
        fontVariantNumeric: 'tabular-nums',
        flexShrink: 0,
      }}
    >
      {rounded <= 0 ? 'Overdue' : `${rounded}d`}
    </span>
  )
}

export function DashboardPage({ user, appTitle, onNavigate, onLogout }: DashboardPageProps) {
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([])
  const [expiryLoading, setExpiryLoading] = useState(true)
  const [expiryError, setExpiryError] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    const canViewSecrets = user.permissions.includes('secrets.view') || user.permissions.includes('users.manage')
    if (!canViewSecrets) {
      setExpiryLoading(false)
      return
    }
    api.get<{ items: ExpiringItem[] }>('/notifications/expiring-soon?days=7')
      .then((d) => setExpiringItems(d.items))
      .catch(() => setExpiryError("Couldn't load expiry data"))
      .finally(() => setExpiryLoading(false))

    api.get<{ count: number }>('/notifications/unread-count')
      .then((d) => setUnreadCount(d.count))
      .catch(() => {})
  }, [user.permissions])

  return (
    <AppShell title={appTitle} currentPath="/" onNavigate={onNavigate} user={user} onLogout={onLogout}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* §23 D-3: expiring soon + alerts first, then totals, then recent */}

        {/* Dominant block: expiry + alerts */}
        <section aria-label="Expiry alerts">
          <div
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 20,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text)',
                }}
              >
                Expiring soon &amp; overdue
              </h2>
              {unreadCount > 0 && (
                <a
                  href="/notifications"
                  onClick={(e) => { e.preventDefault(); onNavigate?.('/notifications') }}
                  style={{
                    fontSize: 12,
                    color: 'var(--accent)',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      background: 'var(--danger)',
                      color: '#fff',
                      borderRadius: 10,
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '1px 5px',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {unreadCount}
                  </span>
                  View all notifications
                </a>
              )}
            </div>

            {expiryLoading ? (
              /* Loading skeleton */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      height: 36,
                      background: 'var(--bg-elev-2)',
                      borderRadius: 4,
                      opacity: 1 - i * 0.3,
                    }}
                  />
                ))}
              </div>
            ) : expiryError ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{expiryError}</p>
            ) : expiringItems.length === 0 ? (
              /* Empty state — warmth + CTA (§23 D-1) */
              <div style={{ padding: '24px 0', textAlign: 'center' }}>
                <p
                  style={{
                    margin: '0 0 4px',
                    fontSize: 14,
                    fontWeight: 500,
                    color: 'var(--text)',
                  }}
                >
                  Nothing expiring. You&apos;re current.
                </p>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                  Credentials will appear here as they approach their expiry date.
                </p>
              </div>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {expiringItems.map((item) => (
                  <li
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      background: 'var(--bg-elev-2)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <a
                        href={`/secrets/${item.id}`}
                        onClick={(e) => { e.preventDefault(); onNavigate?.(`/secrets/${item.id}`) }}
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: 'var(--text)',
                          textDecoration: 'none',
                          display: 'block',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.title}
                      </a>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
                        {item.vaultName} · {item.type}
                      </p>
                    </div>
                    <DaysRemainingBadge days={item.daysRemaining} />
                  </li>
                ))}
                <li style={{ padding: '4px 0' }}>
                  <a
                    href="/vault"
                    onClick={(e) => { e.preventDefault(); onNavigate?.('/vault') }}
                    style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}
                  >
                    View all credentials →
                  </a>
                </li>
              </ul>
            )}
          </div>
        </section>

        {/* Totals block */}
        <section aria-label="Summary totals">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {[
              { label: 'Servers', count: 0, href: '/servers' },
              { label: 'Secrets', count: 0, href: '/vault' },
              { label: 'Scripts', count: 0, href: '/scripts' },
              { label: 'Documents', count: 0, href: '/documents' },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '16px 20px',
                  cursor: 'pointer',
                }}
                onClick={() => onNavigate?.(item.href)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onNavigate?.(item.href)}
              >
                <p
                  style={{
                    margin: '0 0 4px',
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    fontWeight: 500,
                  }}
                >
                  {item.label}
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: 22,
                    fontWeight: 600,
                    color: 'var(--text)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {item.count}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Recent activity */}
        <section aria-label="Recent activity">
          <div
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 20,
            }}
          >
            <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              Recent activity
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              No recent activity. Start by{' '}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); onNavigate?.('/servers') }}
                style={{ color: 'var(--accent)', textDecoration: 'none' }}
              >
                documenting your first server
              </a>
              .
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
