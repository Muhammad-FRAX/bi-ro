import { useState, useEffect, useCallback } from 'react'
import { ThemeProvider } from './components/ThemeProvider.tsx'
import { SetupPage } from './pages/SetupPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { DashboardPage } from './pages/DashboardPage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'
import { ServersPage } from './pages/ServersPage.tsx'
import { ServerDetailPage } from './pages/ServerDetailPage.tsx'
import { AppsPage } from './pages/AppsPage.tsx'
import { TopologyPage } from './pages/TopologyPage.tsx'
import { VaultListPage } from './pages/VaultListPage.tsx'
import { VaultDetailPage } from './pages/VaultDetailPage.tsx'
import { SecretDetailPage } from './pages/SecretDetailPage.tsx'
import { NotificationsPage } from './pages/NotificationsPage.tsx'
import { DocumentsPage } from './pages/DocumentsPage.tsx'
import { RecycleBinPage } from './pages/RecycleBinPage.tsx'
import { AuditPage } from './pages/AuditPage.tsx'
import { BackupPage } from './pages/BackupPage.tsx'
import { PersonalPage } from './pages/PersonalPage.tsx'
import { ScriptsPage } from './pages/ScriptsPage.tsx'
import { CommandPalette } from './components/CommandPalette.tsx'
import { api } from './lib/api.ts'

type AppState = 'loading' | 'setup' | 'login' | 'app'

interface CurrentUser {
  userId: string
  email: string
  displayName: string
  permissions: string[]
  forcePasswordChange: boolean
}

function Spinner() {
  return (
    <ThemeProvider>
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          role="status"
          aria-label="Loading"
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            border: '2px solid var(--border)',
            borderTopColor: 'var(--accent)',
            animation: 'spin 600ms linear infinite',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </ThemeProvider>
  )
}

export default function App() {
  const [state, setState] = useState<AppState>('loading')
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [appTitle] = useState('BI Root')
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Current page path (SPA routing without react-router)
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname)

  // Bootstrap: check setup state + auth state
  useEffect(() => {
    async function bootstrap() {
      try {
        const ss = await api.get<{ initialized: boolean }>('/setup/state')

        if (!ss.initialized) {
          setState('setup')
          return
        }

        // App is initialized — try to restore session
        try {
          const me = await api.get<CurrentUser>('/auth/me')
          setCurrentUser(me)
          setState('app')
        } catch {
          setState('login')
        }
      } catch {
        // Can't reach API or 503 (uninitialized) — show setup
        setState('setup')
      }
    }

    void bootstrap()
  }, [])

  // Sync path state to browser URL
  function navigate(path: string) {
    window.history.pushState({}, '', path)
    setCurrentPath(path)
  }

  // Handle browser back/forward
  useEffect(() => {
    function onPopState() {
      setCurrentPath(window.location.pathname)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // Ctrl/Cmd-K opens command palette (only when logged in)
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault()
      if (state === 'app') {
        setPaletteOpen((open) => !open)
      }
    }
  }, [state])

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [handleGlobalKeyDown])

  function handleSetupComplete() {
    setState('login')
  }

  function handleLogin(user: Omit<CurrentUser, 'permissions'>) {
    // Fetch full permissions after login
    api.get<CurrentUser>('/auth/me').then((me) => {
      setCurrentUser(me)
      setState('app')
      navigate('/')
    }).catch(() => {
      setCurrentUser({ ...user, permissions: [] })
      setState('app')
      navigate('/')
    })
  }

  function handleLogout() {
    setCurrentUser(null)
    setState('login')
    navigate('/')
  }

  if (state === 'loading') {
    return <Spinner />
  }

  if (state === 'setup') {
    return <SetupPage onComplete={handleSetupComplete} />
  }

  if (state === 'login') {
    return <LoginPage onLogin={handleLogin} appTitle={appTitle} />
  }

  // App state — route based on currentPath
  const user = currentUser ?? {
    userId: '',
    email: '',
    displayName: 'User',
    permissions: [],
    forcePasswordChange: false,
  }
  const sharedProps = {
    user,
    appTitle,
    onNavigate: navigate,
    onLogout: handleLogout,
  }

  const palette = paletteOpen ? <CommandPalette onNavigate={navigate} onClose={() => setPaletteOpen(false)} /> : null

  const perms = user.permissions
  const has = (...p: string[]) => p.some((x) => perms.includes(x))

  if (currentPath === '/settings') {
    if (!has('users.manage')) { navigate('/'); return null }
    return (
      <ThemeProvider>
        {palette}
        <SettingsPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  if (currentPath === '/servers') {
    if (!has('infra.read')) { navigate('/'); return null }
    return (
      <ThemeProvider>
        {palette}
        <ServersPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  // /servers/:id — match server detail route
  const serverDetailMatch = currentPath.match(/^\/servers\/([^/]+)$/)
  if (serverDetailMatch) {
    if (!has('infra.read')) { navigate('/'); return null }
    return (
      <ThemeProvider>
        {palette}
        <ServerDetailPage serverId={serverDetailMatch[1]!} {...sharedProps} />
      </ThemeProvider>
    )
  }

  if (currentPath === '/apps') {
    if (!has('infra.read')) { navigate('/'); return null }
    return (
      <ThemeProvider>
        {palette}
        <AppsPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  if (currentPath === '/topology') {
    if (!has('infra.read')) { navigate('/'); return null }
    return (
      <ThemeProvider>
        {palette}
        <TopologyPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  if (currentPath === '/vault') {
    if (!has('secrets.view')) { navigate('/'); return null }
    return (
      <ThemeProvider>
        {palette}
        <VaultListPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  // /vault/:id
  const vaultDetailMatch = currentPath.match(/^\/vault\/([^/]+)$/)
  if (vaultDetailMatch) {
    if (!has('secrets.view')) { navigate('/'); return null }
    return (
      <ThemeProvider>
        {palette}
        <VaultDetailPage vaultId={vaultDetailMatch[1]!} {...sharedProps} />
      </ThemeProvider>
    )
  }

  // /secrets/:id
  const secretDetailMatch = currentPath.match(/^\/secrets\/([^/]+)$/)
  if (secretDetailMatch) {
    if (!has('secrets.view')) { navigate('/'); return null }
    return (
      <ThemeProvider>
        {palette}
        <SecretDetailPage secretId={secretDetailMatch[1]!} {...sharedProps} />
      </ThemeProvider>
    )
  }

  if (currentPath === '/personal') {
    return (
      <ThemeProvider>
        {palette}
        <PersonalPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  if (currentPath === '/scripts') {
    if (!has('infra.read')) { navigate('/'); return null }
    return (
      <ThemeProvider>
        {palette}
        <ScriptsPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  if (currentPath === '/notifications') {
    return (
      <ThemeProvider>
        {palette}
        <NotificationsPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  if (currentPath === '/documents') {
    if (!has('docs.read')) { navigate('/'); return null }
    return (
      <ThemeProvider>
        {palette}
        <DocumentsPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  if (currentPath === '/recycle-bin') {
    if (!has('servers.write', 'docs.write', 'users.manage')) { navigate('/'); return null }
    return (
      <ThemeProvider>
        {palette}
        <RecycleBinPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  if (currentPath === '/audit') {
    if (!has('audit.read')) { navigate('/'); return null }
    return (
      <ThemeProvider>
        {palette}
        <AuditPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  if (currentPath === '/backup') {
    if (!has('users.manage')) { navigate('/'); return null }
    return (
      <ThemeProvider>
        {palette}
        <BackupPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  // Default: Dashboard (handles /, and future pages)
  return (
    <ThemeProvider>
      {palette}
      <DashboardPage {...sharedProps} />
    </ThemeProvider>
  )
}
