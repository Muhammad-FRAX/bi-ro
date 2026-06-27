import { useEffect, type CSSProperties } from 'react'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  intent?: 'danger' | 'warning' | 'primary'
  onConfirm: () => void
  onCancel: () => void
}

const OVERLAY: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
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
  width: 360,
  maxWidth: '90vw',
  boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  intent = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmColor =
    intent === 'danger' ? 'var(--danger)' :
    intent === 'warning' ? 'var(--warning)' :
    'var(--accent)'

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm])

  return (
    <div style={OVERLAY} onClick={(e) => { if (e.target === e.currentTarget) onCancel() }} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div style={DIALOG}>
        <h2 id="confirm-title" style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
          {title}
        </h2>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            autoFocus
            onClick={onCancel}
            style={{ height: 32, padding: '0 14px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{ height: 32, padding: '0 14px', background: `color-mix(in srgb, ${confirmColor} 15%, transparent)`, border: `1px solid color-mix(in srgb, ${confirmColor} 40%, transparent)`, borderRadius: 'var(--radius-sm)', color: confirmColor, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
