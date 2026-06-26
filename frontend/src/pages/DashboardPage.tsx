import { AppShell } from '../components/AppShell.tsx'

interface DashboardPageProps {
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

export function DashboardPage({ user, appTitle, onNavigate, onLogout }: DashboardPageProps) {
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
            </div>

            {/* Empty state — warmth + CTA (§23 D-1) */}
            <div
              style={{
                padding: '32px 0',
                textAlign: 'center',
              }}
            >
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
              { label: 'Servers', count: 0 },
              { label: 'Secrets', count: 0 },
              { label: 'Scripts', count: 0 },
              { label: 'Documents', count: 0 },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '16px 20px',
                }}
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
