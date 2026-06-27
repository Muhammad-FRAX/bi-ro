import { ThemeToggle } from './ThemeToggle.tsx'
import { api } from '../lib/api.ts'

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/' },
  { label: 'Servers', href: '/servers' },
  { label: 'Apps', href: '/apps' },
  { label: 'Topology', href: '/topology' },
  { label: 'Scripts', href: '/scripts' },
  { label: 'Vault', href: '/vault' },
  { label: 'Personal', href: '/personal' },
  { label: 'Documents', href: '/documents' },
  { label: 'Notifications', href: '/notifications' },
  { label: 'Audit', href: '/audit' },
  { label: 'Recycle Bin', href: '/recycle-bin' },
  { label: 'Backup', href: '/backup' },
  { label: 'Settings', href: '/settings' },
]

interface AppShellProps {
  children: React.ReactNode
  title?: string
  currentPath?: string
  onNavigate?: (path: string) => void
  user?: { displayName: string; email: string }
  onLogout?: () => void
}

export function AppShell({
  children,
  title = 'BI Root',
  currentPath,
  onNavigate,
  user,
  onLogout,
}: AppShellProps) {
  // Fall back to window.location.pathname if no currentPath prop
  const activePath = currentPath ?? window.location.pathname

  function handleLogout() {
    api.post('/auth/logout', {}).then(() => {
      onLogout?.()
    }).catch(() => {
      onLogout?.()
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Topbar */}
      <header
        style={{
          height: 48,
          flexShrink: 0,
          background: 'var(--bg-elev)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <span
          style={{
            fontWeight: 600,
            fontSize: 14,
            color: 'var(--text)',
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* User chip */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px',
                  background: 'var(--bg-elev-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  color: 'var(--text-muted)',
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: 'var(--accent-soft)',
                    border: '1px solid var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--accent)',
                    flexShrink: 0,
                  }}
                  aria-hidden
                >
                  {user.displayName.charAt(0).toUpperCase()}
                </span>
                <span style={{ color: 'var(--text)', fontWeight: 500 }}>{user.displayName}</span>
              </div>
              <button
                onClick={handleLogout}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-sm)',
                  fontFamily: 'inherit',
                }}
              >
                Sign out
              </button>
            </div>
          )}
          <ThemeToggle />
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar — 220px */}
        <nav
          aria-label="Primary navigation"
          style={{
            width: 220,
            flexShrink: 0,
            background: 'var(--bg-elev)',
            borderRight: '1px solid var(--border)',
            padding: '8px 0',
            overflowY: 'auto',
          }}
        >
          {NAV_ITEMS.map((item) => {
            const active = activePath === item.href
            return (
              <a
                key={item.href}
                href={item.href}
                onClick={onNavigate ? (e) => { e.preventDefault(); onNavigate(item.href) } : undefined}
                aria-current={active ? 'page' : undefined}
                style={{
                  display: 'block',
                  padding: '6px 14px',
                  fontSize: 13,
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  background: active ? 'var(--accent-soft)' : 'transparent',
                  borderRadius: 6,
                  margin: '1px 6px',
                  transition: 'color 120ms, background 120ms',
                }}
              >
                {item.label}
              </a>
            )
          })}
        </nav>

        {/* Content area */}
        <main style={{ flex: 1, overflow: 'auto', padding: 24, background: 'var(--bg)' }}>
          <div style={{ maxWidth: 1280, margin: '0 auto' }}>{children}</div>
        </main>
      </div>
    </div>
  )
}
