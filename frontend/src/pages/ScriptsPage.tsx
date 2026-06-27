import { AppShell } from '../components/AppShell.tsx'

interface Props {
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

export function ScriptsPage({ user, appTitle, onNavigate, onLogout }: Props) {
  return (
    <AppShell title={appTitle} currentPath="/scripts" onNavigate={onNavigate} user={user} onLogout={onLogout}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Scripts</h1>
        </div>
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🛠</div>
          <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Scripts coming soon</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Run and manage automation scripts on your servers from here.</p>
        </div>
      </div>
    </AppShell>
  )
}
