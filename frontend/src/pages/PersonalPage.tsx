import { useState, useEffect, useRef, type FormEvent, type CSSProperties } from 'react'
import { AppShell } from '../components/AppShell.tsx'
import { ConfirmDialog } from '../components/ConfirmDialog.tsx'
import { api, ApiError } from '../lib/api.ts'

interface Entry {
  id: string
  title: string
  url: string | null
  username: string | null
  logoUrl: string | null
  appId: string | null
  createdAt: string
  updatedAt: string
}

interface PersonalApp { id: string; name: string }

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

const REVEAL_SECONDS = 10

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

  // Personal apps (for linking entries)
  const [personalApps, setPersonalApps] = useState<PersonalApp[]>([])

  // Add entry form
  const [showAdd, setShowAdd] = useState(false)
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addAppId, setAddAppId] = useState('')

  // Edit entry form
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ title: '', url: '', username: '', newPassword: '', vaultPassword: '', appId: '' })
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Reveal state: entryId → { value, exp }
  const [revealed, setRevealed] = useState<Record<string, { value: string; exp: number }>>({})
  const [revealingId, setRevealingId] = useState<string | null>(null)
  const [revealPw, setRevealPw] = useState('')
  const [revealError, setRevealError] = useState<string | null>(null)
  const [revealSubmitting, setRevealSubmitting] = useState(false)

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null)

  // Clipboard copy
  const [copiedEntryId, setCopiedEntryId] = useState<string | null>(null)
  const clipClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (clipClearRef.current) clearTimeout(clipClearRef.current) }, [])

  // Countdown tick — fires every second, removes expired reveals and re-renders countdown
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      setRevealed((prev) => {
        const hasExpired = Object.values(prev).some((r) => r.exp <= now)
        if (!hasExpired && Object.keys(prev).length === 0) return prev
        const next = { ...prev }
        for (const k of Object.keys(next)) {
          if (next[k]!.exp <= now) delete next[k]
        }
        return next
      })
    }, 500) // 500ms for smoother countdown
    return () => clearInterval(id)
  }, [])

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

  useEffect(() => {
    api.get<{ apps: { id: string; name: string; vaultId: string | null }[] }>('/apps')
      .then((d) => setPersonalApps(d.apps.filter((a) => a.vaultId === null)))
      .catch(() => {})
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
        password: fd.get('password') as string,
        appId: addAppId || undefined,
      })
      setShowAdd(false)
      setAddAppId('')
      e.currentTarget.reset()
      await loadEntries()
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : 'Failed to create entry')
    } finally {
      setAddSubmitting(false)
    }
  }

  function openEdit(entry: Entry) {
    setEditingId(entry.id)
    setEditDraft({ title: entry.title, url: entry.url ?? '', username: entry.username ?? '', newPassword: '', vaultPassword: '', appId: entry.appId ?? '' })
    setEditError(null)
  }

  async function handleEditEntry(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setEditError(null)
    if (editDraft.newPassword && !editDraft.vaultPassword) {
      setEditError('Vault password is required to change the secret value')
      return
    }
    setEditSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        title: editDraft.title.trim(),
        url: editDraft.url.trim() || null,
        username: editDraft.username.trim() || null,
        appId: editDraft.appId || null,
      }
      if (editDraft.newPassword) {
        body.newValue = editDraft.newPassword
        body.password = editDraft.vaultPassword
      }
      await api.patch(`/personal-vault/entries/${editingId}`, body)
      setEditingId(null)
      await loadEntries()
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Failed to update entry')
    } finally {
      setEditSubmitting(false)
    }
  }

  async function handleReveal(entryId: string) {
    if (!revealPw) { setRevealError('Password required'); return }
    setRevealError(null)
    setRevealSubmitting(true)
    try {
      const data = await api.post<{ value: string }>(`/personal-vault/entries/${entryId}/reveal`, { password: revealPw })
      setRevealed((prev) => ({ ...prev, [entryId]: { value: data.value, exp: Date.now() + REVEAL_SECONDS * 1000 } }))
      setRevealingId(null)
      setRevealPw('')
    } catch (err) {
      setRevealError(err instanceof ApiError ? err.message : 'Reveal failed')
    } finally {
      setRevealSubmitting(false)
    }
  }

  async function handleCopyEntry(entryId: string) {
    const rev = revealed[entryId]
    if (!rev || rev.exp <= Date.now()) return
    try {
      await navigator.clipboard.writeText(rev.value)
      setCopiedEntryId(entryId)
      setTimeout(() => setCopiedEntryId((prev) => prev === entryId ? null : prev), 1500)
      if (clipClearRef.current) clearTimeout(clipClearRef.current)
      clipClearRef.current = setTimeout(() => {
        navigator.clipboard.writeText('').catch(() => {})
      }, Math.max(0, rev.exp - Date.now()))
    } catch {
      // Clipboard API unavailable
    }
  }

  async function handleDelete(id: string) {
    setConfirmDelete(null)
    setDeletingId(id)
    try {
      await api.delete(`/personal-vault/entries/${id}`)
      setEntries((prev) => prev.filter((e) => e.id !== id))
      if (editingId === id) setEditingId(null)
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

        {loading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}

        {error && (
          <div style={{ padding: '10px 14px', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* ── Not initialized ── */}
        {!loading && initialized === false && (
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 24, maxWidth: 420 }}>
            <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Set up your personal vault</p>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Choose a vault password. This password encrypts your entries — it's separate from your login.
              <strong style={{ color: 'var(--warning)', display: 'block', marginTop: 6 }}>It cannot be recovered if lost.</strong>
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <button
                onClick={() => { setShowAdd((v) => !v); setAddError(null) }}
                style={{ ...BTN_PRIMARY, background: showAdd ? 'var(--bg-elev)' : 'var(--accent)', color: showAdd ? 'var(--text-muted)' : '#fff', border: showAdd ? '1px solid var(--border)' : 'none' }}
              >
                {showAdd ? 'Cancel' : '+ Add entry'}
              </button>
            </div>

            {/* ── Add form ── */}
            {showAdd && (
              <form onSubmit={(e) => void handleAddEntry(e)} style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>New entry</p>
                {addError && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{addError}</p>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    Title *<input name="title" required placeholder="e.g. GitHub" style={INPUT} />
                  </label>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    Username / email<input name="username" placeholder="you@example.com" style={INPUT} />
                  </label>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    URL<input name="url" type="url" placeholder="https://github.com" style={INPUT} />
                  </label>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    Password / secret *<input name="value" type="password" required placeholder="The value to store" style={INPUT} />
                  </label>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                    Vault password (to encrypt)<input name="password" type="password" required placeholder="Your vault password" style={INPUT} />
                  </label>
                  {personalApps.length > 0 && (
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                      Link to personal app (optional)
                      <select value={addAppId} onChange={(e) => setAddAppId(e.target.value)} style={{ ...INPUT, height: 32 }}>
                        <option value="">— None —</option>
                        {personalApps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button type="button" onClick={() => setShowAdd(false)} style={BTN_GHOST}>Cancel</button>
                  <button type="submit" disabled={addSubmitting} style={{ ...BTN_PRIMARY, opacity: addSubmitting ? 0.6 : 1 }}>
                    {addSubmitting ? 'Saving…' : 'Save entry'}
                  </button>
                </div>
              </form>
            )}

            {entries.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                No entries yet. Add your first credential above.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {entries.map((entry) => {
                const rev = revealed[entry.id]
                const isRevealing = revealingId === entry.id
                const isEditing = editingId === entry.id
                const secsLeft = rev ? Math.ceil((rev.exp - Date.now()) / 1000) : 0
                const countdownColor = secsLeft <= 3 ? 'var(--danger)' : secsLeft <= 6 ? 'var(--warning)' : 'var(--success)'

                return (
                  <div
                    key={entry.id}
                    style={{ background: 'var(--bg-elev)', border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}
                  >
                    {/* Entry header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Favicon url={entry.url} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {entry.title}
                        </div>
                        {entry.username && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{entry.username}</div>
                        )}
                        {entry.url && (
                          <a href={entry.url} target="_blank" rel="noreferrer"
                            style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {entry.url}
                          </a>
                        )}
                      </div>

                      {/* Actions row */}
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                        {rev ? (
                          <>
                            {/* Countdown badge */}
                            <span style={{
                              fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
                              color: countdownColor,
                              background: `color-mix(in srgb, ${countdownColor} 12%, transparent)`,
                              border: `1px solid color-mix(in srgb, ${countdownColor} 30%, transparent)`,
                              borderRadius: 'var(--radius-sm)', padding: '2px 6px',
                              minWidth: 28, textAlign: 'center',
                            }}>
                              {secsLeft}s
                            </span>
                            {/* Value */}
                            <span style={{
                              fontFamily: 'var(--font-mono)', fontSize: 12,
                              background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
                              borderRadius: 'var(--radius-sm)', padding: '4px 8px',
                              color: 'var(--success)', userSelect: 'all',
                            }}>
                              {rev.value}
                            </span>
                            {/* Copy icon */}
                            <button
                              onClick={() => void handleCopyEntry(entry.id)}
                              title={copiedEntryId === entry.id ? 'Copied!' : 'Copy to clipboard'}
                              style={{
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                width: 28, height: 28, padding: 0,
                                background: copiedEntryId === entry.id ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'var(--bg-elev-2)',
                                border: `1px solid ${copiedEntryId === entry.id ? 'color-mix(in srgb, var(--success) 40%, transparent)' : 'var(--border)'}`,
                                borderRadius: 'var(--radius-sm)',
                                color: copiedEntryId === entry.id ? 'var(--success)' : 'var(--text-muted)',
                                cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s',
                              }}
                            >
                              {copiedEntryId === entry.id
                                ? <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>
                                : <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/><path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5h-.5A1.5 1.5 0 0 0 3 3v.5h10V3a1.5 1.5 0 0 0-1.5-1.5H11A1.5 1.5 0 0 0 9.5 0h-3z"/></svg>
                              }
                            </button>
                          </>
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
                          onClick={() => { isEditing ? setEditingId(null) : openEdit(entry) }}
                          style={{ height: 28, padding: '0 8px', background: isEditing ? 'var(--accent-soft)' : 'none', border: isEditing ? '1px solid var(--accent)' : 'none', color: isEditing ? 'var(--accent)' : 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 'var(--radius-sm)' }}
                        >
                          {isEditing ? 'Cancel' : 'Edit'}
                        </button>
                        <button
                          onClick={() => setConfirmDelete({ id: entry.id, title: entry.title })}
                          disabled={deletingId === entry.id}
                          style={{ height: 28, padding: '0 8px', background: 'none', border: 'none', color: 'var(--danger)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Reveal password prompt */}
                    {isRevealing && !rev && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                        <input
                          type="password"
                          value={revealPw}
                          onChange={(e) => setRevealPw(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void handleReveal(entry.id) }}
                          placeholder="Vault password"
                          autoFocus
                          style={{ ...INPUT, flex: 1 }}
                        />
                        <button onClick={() => void handleReveal(entry.id)} disabled={revealSubmitting}
                          style={{ ...BTN_PRIMARY, opacity: revealSubmitting ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                          {revealSubmitting ? '…' : 'Show'}
                        </button>
                        {revealError && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{revealError}</span>}
                      </div>
                    )}

                    {/* Edit form */}
                    {isEditing && (
                      <form onSubmit={(e) => void handleEditEntry(e)} style={{ paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Edit entry</p>
                        {editError && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{editError}</p>}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            Title *
                            <input required value={editDraft.title} onChange={(e) => setEditDraft((p) => ({ ...p, title: e.target.value }))} style={INPUT} />
                          </label>
                          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            Username / email
                            <input value={editDraft.username} onChange={(e) => setEditDraft((p) => ({ ...p, username: e.target.value }))} placeholder="you@example.com" style={INPUT} />
                          </label>
                          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                            URL
                            <input type="url" value={editDraft.url} onChange={(e) => setEditDraft((p) => ({ ...p, url: e.target.value }))} placeholder="https://example.com" style={INPUT} />
                          </label>
                          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            New password / secret
                            <input type="password" value={editDraft.newPassword} onChange={(e) => setEditDraft((p) => ({ ...p, newPassword: e.target.value }))} placeholder="Leave blank to keep current" style={INPUT} />
                          </label>
                          {editDraft.newPassword && (
                            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                              Vault password (to re-encrypt)
                              <input type="password" value={editDraft.vaultPassword} onChange={(e) => setEditDraft((p) => ({ ...p, vaultPassword: e.target.value }))} placeholder="Your vault password" style={INPUT} autoFocus />
                            </label>
                          )}
                          {personalApps.length > 0 && (
                            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                              Link to personal app
                              <select value={editDraft.appId} onChange={(e) => setEditDraft((p) => ({ ...p, appId: e.target.value }))} style={{ ...INPUT, height: 32 }}>
                                <option value="">— None —</option>
                                {personalApps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                              </select>
                            </label>
                          )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                          <button type="button" onClick={() => setEditingId(null)} style={BTN_GHOST}>Cancel</button>
                          <button type="submit" disabled={editSubmitting} style={{ ...BTN_PRIMARY, opacity: editSubmitting ? 0.6 : 1 }}>
                            {editSubmitting ? 'Saving…' : 'Save changes'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete entry"
          message={`Delete "${confirmDelete.title}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => void handleDelete(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </AppShell>
  )
}
