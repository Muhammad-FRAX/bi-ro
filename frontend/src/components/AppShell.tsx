import { ThemeToggle } from './ThemeToggle.tsx'

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
  { label: 'Settings', href: '/settings' },
]

interface AppShellProps {
  children: React.ReactNode
  title?: string
}

export function AppShell({ children, title = 'BI Root' }: AppShellProps) {
  // TODO: replace with useLocation() when react-router is added (C1.3+)
  const currentPath = window.location.pathname

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

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
            const active = currentPath === item.href
            return (
              <a
                key={item.href}
                href={item.href}
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
