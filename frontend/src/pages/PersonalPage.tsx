import { useState, useEffect, type FormEvent, type CSSProperties } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { api, ApiError } from '../lib/api.ts'

interface Entry {
  id: string
  title: string
  url: string | null
  username: string | null
  logoUrl: string | null
  createdAt: string
  updatedAt: string
}

interface Props {
  user: { displayName: string; email: string; permissions: string[] }
  appTitle?: string
  onNavigate?: (path: string) => void
  onLogout?: () => void
}

const INPUT: CSSProperties = {
  height: 32, padding: '0 10px',
  background: 'var(--bg-elev-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)', fontSize: 13,
  fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box',
}

const BTN_PRIMARY: CSSProperties = {
  height: 32, padding: '0 14px',
  background: 'var(--accent)', border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: '#fff', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
}

const BTN_GHOST: CSSProperties = {
  height: 32, padding: '0 12px',
  background: 'none', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-muted)', fontSize: 13,
  cursor: 'pointer', fontFamily: 'inherit',
}

function Favicon({ url }: { url: string | null }) {
  if (!url) return <span style={{ fontSize: 18, lineHeight: 1 }}>🔑</span>
  try {
    const origin = new URL(url).origin
    return (
      <img
        src={`${origin}/favicon.ico`}
        alt=""
        width={18} height={18}
        style={{ borderRadius: 4, objectFit: 'contain' }}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      />
    )
  } catch {
    return <span style={{ fontSize: 18, lineHeight: 1 }}>🔑</span>
  }
}

export function PersonalPage({ user, appTitle, onNavigate, onLogout }: Props) {
  const [initialized, setInitialized] = useState<boolean | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Init form
  const [initPw, setInitPw] = useState('')
  const [initPwConfirm, setInitPwConfirm] = useState('')
  const [initSubmitting, setInitSubmitting] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  // Add entry form
  const [showAdd, setShowAdd] = useState(false)
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Reveal state: entryId → { value, expiresAt }
  const [revealed, setRevealed] = useState<Record<string, { value: string; exp: number }>>({})
  const [revealingId, setRevealingId] = useState<string | null>(null)
  const [revealPw, setRevealPw] = useState('')
  const [revealError, setRevealError] = useState<string | null>(null)
  const [revealSubmitting, setRevealSubmitting] = useState(false)

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function checkStatus() {
    try {
      const data = await api.get<{ initialized: boolean }>('/personal-vault/status')
      setInitialized(data.initialized)
      if (data.initialized) await loadEntries()
      else setLoading(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load personal vault')
      setLoading(false)
    }
  }

  async function loadEntries() {
    setLoading(true)
    try {
      const data = await api.get<{ entries: Entry[] }>('/personal-vault/entries')
      setEntries(data.entries)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load entries')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void checkStatus() }, [])

  // Expire revealed values after 10s
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      setRevealed((prev) => {
        const next = { ...prev }
        for (const k of Object.keys(next)) {
          if (next[k]!.exp < now) delete next[k]
        }
        return next
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  async function handleInit(e: FormEvent) {
    e.preventDefault()
    setInitError(null)
    if (initPw !== initPwConfirm) { setInitError('Passwords do not match'); return }
    if (initPw.length < 6) { setInitError('Password must be at least 6 characters'); return }
    setInitSubmitting(true)
    try {
      await api.post('/personal-vault/initialize', { password: initPw })
      setInitialized(true)
      setInitPw(''); setInitPwConfirm('')
      await loadEntries()
    } catch (err) {
      setInitError(err instanceof ApiError ? err.message : 'Failed to initialize vault')
    } finally {
      setInitSubmitting(false)
    }
  }

  async function handleAddEntry(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAddError(null)
    setAddSubmitting(true)
    const fd = new FormData(e.currentTarget)
    try {
      await api.post('/personal-vault/entries', {
        title: (fd.get('title') as string).trim(),
        url: (fd.get('url') as string).trim() || undefined,
        username: (fd.get('username') as string).trim() || undefined,
        value: fd.get('value') as string,
        logo_url: undefined,
        password: fd.get('password') as string,
      })
      setShowAdd(false)
      e.currentTarget.reset()
      await loadEntries()
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : 'Failed to create entry')
    } finally {
      setAddSubmitting(false)
    }
  }

  async function handleReveal(entryId: string) {
    if (!revealPw) { setRevealError('Password required'); return }
    setRevealError(null)
    setRevealSubmitting(true)
    try {
      const data = await api.post<{ value: string }>(`/personal-vault/entries/${entryId}/reveal`, { password: revealPw })
      setRevealed((prev) => ({ ...prev, [entryId]: { value: data.value, exp: Date.now() + 10000 } }))
      setRevealingId(null)
      setRevealPw('')
    } catch (err) {
      setRevealError(err instanceof ApiError ? err.message : 'Reveal failed')
    } finally {
      setRevealSubmitting(false)
    }
  }

  async function handleDelete(id: string, title: string) {
    if (!confirm(`Delete "${title}"?`)) return
    setDeletingId(id)
    try {
      await api.delete(`/personal-vault/entries/${id}`)
      setEntries((prev) => prev.filter((e) => e.id !== id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <AppShell currentPath="/personal" onNavigate={onNavigate} user={user} onLogout={onLogout} appTitle={appTitle}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 32px' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>Personal vault</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            Your private credentials — encrypted with your own key. No admin can read these.
          </p>
        </div>

        {loading && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        )}

        {error && (
          <div style={{ padding: '10px 14px', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* ── Not initialized ── */}
        {!loading && initialized === false && (
          <div style={{
            background: 'var(--bg-elev)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: 24, maxWidth: 420,
          }}>
            <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Set up your personal vault</p>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Choose a vault password. This password encrypts your entries — it's separate from your login.
              <strong style={{ color: 'var(--warning)', display: 'block', marginTop: 6 }}>
                It cannot be recovered if lost.
              </strong>
            </p>
            <form onSubmit={(e) => void handleInit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {initError && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{initError}</p>}
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                Vault password
                <input type="password" value={initPw} onChange={(e) => setInitPw(e.target.value)} required style={INPUT} />
              </label>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                Confirm password
                <input type="password" value={initPwConfirm} onChange={(e) => setInitPwConfirm(e.target.value)} required style={INPUT} />
              </label>
              <button type="submit" disabled={initSubmitting} style={{ ...BTN_PRIMARY, opacity: initSubmitting ? 0.6 : 1, marginTop: 4 }}>
                {initSubmitting ? 'Setting up…' : 'Create vault'}
              </button>
            </form>
          </div>
        )}

        {/* ── Initialized: entries list ── */}
        {!loading && initialized === true && (
          <>
            {/* Add entry button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <button
                onClick={() => { setShowAdd((v) => !v); setAddError(null) }}
                style={{ ...BTN_PRIMARY, background: showAdd ? 'var(--bg-elev)' : 'var(--accent)', color: showAdd ? 'var(--text-muted)' : '#fff', border: showAdd ? '1px solid var(--border)' : 'none' }}
              >
                {showAdd ? 'Cancel' : '+ Add entry'}
              </button>
            </div>

            {/* Add entry form */}
            {showAdd && (
              <form
                onSubmit={(e) => void handleAddEntry(e)}
                style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>New entry</p>
                {addError && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{addError}</p>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    Title *
                    <input name="title" required placeholder="e.g. GitHub" style={INPUT} />
                  </label>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    Username / email
                    <input name="username" placeholder="you@example.com" style={INPUT} />
                  </label>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    URL
                    <input name="url" type="url" placeholder="https://github.com" style={INPUT} />
                  </label>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    Password / secret *
                    <input name="value" type="password" required placeholder="The value to store" style={INPUT} />
                  </label>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                    Vault password (to encrypt)
                    <input name="password" type="password" required placeholder="Your vault password" style={INPUT} />
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button type="button" onClick={() => setShowAdd(false)} style={BTN_GHOST}>Cancel</button>
                  <button type="submit" disabled={addSubmitting} style={{ ...BTN_PRIMARY, opacity: addSubmitting ? 0.6 : 1 }}>
                    {addSubmitting ? 'Saving…' : 'Save entry'}
                  </button>
                </div>
              </form>
            )}

            {/* Entries */}
            {entries.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                No entries yet. Add your first credential above.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {entries.map((entry) => {
                const rev = revealed[entry.id]
                const isRevealing = revealingId === entry.id
                return (
                  <div
                    key={entry.id}
                    style={{
                      background: 'var(--bg-elev)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)', padding: '12px 16px',
                      display: 'flex', flexDirection: 'column', gap: 8,
                    }}
                  >
                    {/* Entry header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Favicon url={entry.url} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {entry.title}
                        </div>
                        {entry.username && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {entry.username}
                          </div>
                        )}
                        {entry.url && (
                          <a
                            href={entry.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {entry.url}
                          </a>
                        )}
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {rev ? (
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: 12,
                            background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)', padding: '4px 8px',
                            color: 'var(--success)', userSelect: 'all',
                          }}>
                            {rev.value}
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setRevealingId(isRevealing ? null : entry.id)
                              setRevealPw('')
                              setRevealError(null)
                            }}
                            style={{ ...BTN_GHOST, height: 28, fontSize: 12 }}
                          >
                            {isRevealing ? 'Cancel' : 'Reveal'}
                          </button>
                        )}
                        <button
                          onClick={() => void handleDelete(entry.id, entry.title)}
                          disabled={deletingId === entry.id}
                          style={{ height: 28, padding: '0 8px', background: 'none', border: 'none', color: 'var(--danger)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Inline reveal password prompt */}
                    {isRevealing && !rev && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                        <input
                          type="password"
                          value={revealPw}
                          onChange={(e) => setRevealPw(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void handleReveal(entry.id) }}
                          placeholder="Vault password"
                          autoFocus
                          style={{ ...INPUT, flex: 1 }}
                        />
                        <button
                          onClick={() => void handleReveal(entry.id)}
                          disabled={revealSubmitting}
                          style={{ ...BTN_PRIMARY, opacity: revealSubmitting ? 0.6 : 1, whiteSpace: 'nowrap' }}
                        >
                          {revealSubmitting ? '…' : 'Show'}
                        </button>
                        {revealError && (
                          <span style={{ fontSize: 12, color: 'var(--danger)' }}>{revealError}</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
