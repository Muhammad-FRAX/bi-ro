import { useState, useEffect, useRef, type FormEvent, type CSSProperties, type MouseEvent } from 'react'
import { Button } from './ui/Button.tsx'
import { api } from '../lib/api.ts'

interface RevealDialogProps {
  secretId: string
  secretTitle: string
  onClose: () => void
}

// §23 — 10s countdown ring around the revealed value; auto-re-mask at 0
const REVEAL_SECONDS = 10

// SVG countdown ring (accent stroke depleting over 10s)
function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const R = 22
  const CIRCUMFERENCE = 2 * Math.PI * R
  const progress = seconds / total
  const strokeDashoffset = CIRCUMFERENCE * (1 - progress)

  const color =
    seconds <= 3 ? 'var(--danger)' : seconds <= 6 ? 'var(--warning)' : 'var(--accent-strong)'

  return (
    <svg
      width={56}
      height={56}
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      {/* Track */}
      <circle
        cx={28}
        cy={28}
        r={R}
        fill="none"
        stroke="var(--border)"
        strokeWidth={3}
      />
      {/* Progress */}
      <circle
        cx={28}
        cy={28}
        r={R}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={strokeDashoffset}
        style={{ transform: 'rotate(-90deg)', transformOrigin: '28px 28px', transition: 'stroke-dashoffset 1s linear, stroke 0.5s' }}
      />
      {/* Seconds text */}
      <text
        x={28}
        y={33}
        textAnchor="middle"
        fill={color}
        fontSize={14}
        fontWeight={600}
        fontFamily="var(--font-mono)"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {seconds}
      </text>
    </svg>
  )
}

const OVERLAY: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  backdropFilter: 'blur(2px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}

const DIALOG: CSSProperties = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: '24px 28px',
  width: 420,
  maxWidth: '90vw',
  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
}

const LABEL: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-subtle)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 600,
  marginBottom: 6,
  display: 'block',
}

export function RevealDialog({ secretId, secretTitle, onClose }: RevealDialogProps) {
  const [phase, setPhase] = useState<'auth' | 'revealed' | 'error'>('auth')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealedValue, setRevealedValue] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(REVEAL_SECONDS)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const clipboardClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Countdown timer when value is revealed
  useEffect(() => {
    if (phase !== 'revealed') return
    setSecondsLeft(REVEAL_SECONDS)
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current!)
          // Re-mask — clear value from state
          setRevealedValue(null)
          setPhase('auth')
          setPassword('')
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [phase])

  // Clipboard auto-clear on unmount / close
  useEffect(() => {
    return () => {
      if (clipboardClearRef.current) clearTimeout(clipboardClearRef.current)
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const result = await api.post<{ value: string }>(`/secrets/${secretId}/reveal`, { password })
      setRevealedValue(result.value)
      setPhase('revealed')
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Reveal failed'
      if (msg.includes('429') || msg.toLowerCase().includes('too many')) {
        setError('Too many attempts. Please wait 15 minutes.')
      } else if (msg.includes('401')) {
        setError('Wrong password. Please try again.')
      } else if (msg.includes('403')) {
        setError('You do not have permission to reveal this secret.')
      } else {
        setError(msg)
      }
      setPhase('error')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!revealedValue) return
    try {
      await navigator.clipboard.writeText(revealedValue)
      setCopied(true)
      // §20 F3.5 — clipboard auto-clear is best-effort (unreliable cross-OS)
      // The 10s re-mask is the real guarantee
      clipboardClearRef.current = setTimeout(() => {
        navigator.clipboard.writeText('').catch(() => {
          // Best-effort: ignore errors (not all browsers allow blank-write)
        })
        setCopied(false)
      }, REVEAL_SECONDS * 1000)
    } catch {
      // Clipboard API not available — silently ignore per §20 F3.5
    }
  }

  // Close on backdrop click
  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      // Clear revealed value before closing
      setRevealedValue(null)
      onClose()
    }
  }

  return (
    <div style={OVERLAY} onClick={handleBackdrop} role="dialog" aria-modal="true" aria-labelledby="reveal-title">
      <div style={DIALOG}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div id="reveal-title" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              Reveal Secret
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {secretTitle}
            </div>
          </div>
          <button
            onClick={() => { setRevealedValue(null); onClose() }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, padding: '0 4px' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {phase === 'revealed' && revealedValue ? (
          <div>
            {/* §23 — 10s countdown ring with depleting accent stroke */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <CountdownRing seconds={secondsLeft} total={REVEAL_SECONDS} />
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Value re-masks in <strong style={{ color: secondsLeft <= 3 ? 'var(--danger)' : 'var(--text)' }}>{secondsLeft}s</strong>
              </div>
            </div>

            <label style={LABEL}>Secret value</label>
            <div
              style={{
                background: 'var(--bg-elev-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                color: 'var(--text)',
                wordBreak: 'break-all',
                marginBottom: 12,
                userSelect: 'all',
              }}
              role="textbox"
              aria-readonly="true"
              aria-label="Secret value"
            >
              {revealedValue}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <Button intent="primary" size="sm" onClick={() => void handleCopy()}>
                {copied ? '✓ Copied' : 'Copy'}
              </Button>
              <Button intent="ghost" size="sm" onClick={() => { setRevealedValue(null); onClose() }}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              Confirm it&apos;s you by entering your password. Each reveal requires re-authentication and is audited.
            </p>

            {(phase === 'error' && error) && (
              <div
                style={{
                  background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 12px',
                  fontSize: 13,
                  color: 'var(--danger)',
                  marginBottom: 14,
                }}
                role="alert"
              >
                {error}
              </div>
            )}

            <label htmlFor="step-up-password" style={LABEL}>Your password</label>
            <input
              id="step-up-password"
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setPhase('auth'); setError(null) }}
              placeholder="Enter your password"
              required
              autoFocus
              style={{
                width: '100%',
                height: 'var(--input-h)',
                background: 'var(--bg-elev-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '0 10px',
                fontSize: 13,
                color: 'var(--text)',
                fontFamily: 'inherit',
                outline: 'none',
                marginBottom: 16,
                boxSizing: 'border-box',
              }}
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button
                type="button"
                intent="ghost"
                size="sm"
                onClick={() => { setRevealedValue(null); onClose() }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                intent="primary"
                size="sm"
                disabled={loading || !password}
              >
                {loading ? 'Verifying…' : 'Reveal'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
