import { useState, useEffect } from 'react'
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

  if (currentPath === '/settings') {
    return (
      <ThemeProvider>
        <SettingsPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  if (currentPath === '/servers') {
    return (
      <ThemeProvider>
        <ServersPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  // /servers/:id — match server detail route
  const serverDetailMatch = currentPath.match(/^\/servers\/([^/]+)$/)
  if (serverDetailMatch) {
    return (
      <ThemeProvider>
        <ServerDetailPage serverId={serverDetailMatch[1]!} {...sharedProps} />
      </ThemeProvider>
    )
  }

  if (currentPath === '/apps') {
    return (
      <ThemeProvider>
        <AppsPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  if (currentPath === '/topology') {
    return (
      <ThemeProvider>
        <TopologyPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  if (currentPath === '/vault') {
    return (
      <ThemeProvider>
        <VaultListPage {...sharedProps} />
      </ThemeProvider>
    )
  }

  // /vault/:id
  const vaultDetailMatch = currentPath.match(/^\/vault\/([^/]+)$/)
  if (vaultDetailMatch) {
    return (
      <ThemeProvider>
        <VaultDetailPage vaultId={vaultDetailMatch[1]!} {...sharedProps} />
      </ThemeProvider>
    )
  }

  // /secrets/:id
  const secretDetailMatch = currentPath.match(/^\/secrets\/([^/]+)$/)
  if (secretDetailMatch) {
    return (
      <ThemeProvider>
        <SecretDetailPage secretId={secretDetailMatch[1]!} {...sharedProps} />
      </ThemeProvider>
    )
  }

  // Default: Dashboard (handles /, and future pages)
  return (
    <ThemeProvider>
      <DashboardPage {...sharedProps} />
    </ThemeProvider>
  )
}
