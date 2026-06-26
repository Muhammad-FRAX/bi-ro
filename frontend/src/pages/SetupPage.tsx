import { useState, type FormEvent } from 'react'
import { ThemeProvider } from '../components/ThemeProvider.tsx'
import { ThemeToggle } from '../components/ThemeToggle.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Input } from '../components/ui/Input.tsx'
import { api, ApiError } from '../lib/api.ts'

interface SetupPageProps {
  onComplete: () => void
}

export function SetupPage({ onComplete }: SetupPageProps) {
  const [appTitle, setAppTitle] = useState('BI Root')
  const [appAccent, setAppAccent] = useState('#a78bfa')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'config' | 'done'>('config')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api.post('/setup/initialize', { appTitle: appTitle.trim() || 'BI Root', appAccent })
      setStep('done')
      setTimeout(onComplete, 800)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Setup failed. Please try again.')
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
        {/* Minimal header */}
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
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
            BI Root — First-launch Setup
          </span>
          <ThemeToggle />
        </header>

        {/* Setup wizard content */}
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
              maxWidth: 440,
              background: 'var(--bg-elev)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: 32,
            }}
          >
            {step === 'done' ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
                <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
                  Setup complete
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                  Redirecting to login…
                </p>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 28 }}>
                  <h1 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>
                    Welcome to BI Root
                  </h1>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: '18px' }}>
                    Configure your instance. The admin account was seeded from your environment variables —
                    log in immediately after setup.
                  </p>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <Input
                    id="app-title"
                    label="Application title"
                    value={appTitle}
                    onChange={(e) => setAppTitle(e.target.value)}
                    placeholder="BI Root"
                    autoComplete="off"
                  />

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label
                      htmlFor="app-accent"
                      style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}
                    >
                      Accent color
                    </label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        id="app-accent"
                        type="color"
                        value={appAccent}
                        onChange={(e) => setAppAccent(e.target.value)}
                        style={{
                          height: 30,
                          width: 44,
                          padding: 2,
                          background: 'var(--bg-elev-2)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                        }}
                        aria-label="Pick accent color"
                      />
                      <Input
                        value={appAccent}
                        onChange={(e) => setAppAccent(e.target.value)}
                        placeholder="#a78bfa"
                        style={{ flex: 1 }}
                        aria-label="Accent hex value"
                      />
                    </div>
                  </div>

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
                    style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                  >
                    {loading ? 'Setting up…' : 'Complete setup'}
                  </Button>
                </form>
              </>
            )}
          </div>
        </main>
      </div>
    </ThemeProvider>
  )
}
