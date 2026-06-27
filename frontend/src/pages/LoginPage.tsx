import { useState, type FormEvent } from 'react'
import { ThemeProvider } from '../components/ThemeProvider.tsx'
import { ThemeToggle } from '../components/ThemeToggle.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Input } from '../components/ui/Input.tsx'
import { api, ApiError } from '../lib/api.ts'

interface LoginPageProps {
  onLogin: (user: { userId: string; email: string; displayName: string; forcePasswordChange: boolean }) => void
  appTitle?: string
}

export function LoginPage({ onLogin, appTitle = 'BI Root' }: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim() || !password) {
      setError('Email and password are required.')
      return
    }
    setLoading(true)
    try {
      const data = await api.post<{ user: { userId: string; email: string; displayName: string; forcePasswordChange: boolean } }>(
        '/auth/login',
        { email: email.trim(), password },
      )
      onLogin(data.user)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid email or password.')
      } else {
        setError('Login failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <ThemeProvider>
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--bg)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          style={{
            height: 48,
            background: 'var(--bg-elev)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 24px',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{appTitle}</span>
          <ThemeToggle />
        </header>

        <main
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 360,
              background: 'var(--bg-elev)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: 32,
            }}
          >
            <div style={{ marginBottom: 28, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <img
                src="/favicon.svg"
                alt=""
                width={52}
                height={52}
                style={{ marginBottom: 14 }}
              />
              <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-muted)' }}>
                {appTitle}
              </p>
              <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
                Sign in
              </h1>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Input
                id="login-email"
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
              <Input
                id="login-password"
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />

              {error && (
                <p
                  role="alert"
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: 'var(--danger)',
                    background: 'rgba(248,113,113,0.08)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid rgba(248,113,113,0.2)',
                  }}
                >
                  {error}
                </p>
              )}

              <Button
                type="submit"
                intent="primary"
                size="md"
                disabled={loading}
                style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </div>
        </main>
      </div>
    </ThemeProvider>
  )
}
