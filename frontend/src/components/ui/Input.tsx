import type { CSSProperties, InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  containerStyle?: CSSProperties
}

export function Input({ label, id, style, containerStyle, ...props }: InputProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...containerStyle }}>
      {label && (
        <label
          htmlFor={id}
          style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}
        >
          {label}
        </label>
      )}
      <input
        id={id}
        {...props}
        style={{
          height: 'var(--input-h)',
          padding: '0 10px',
          fontSize: 13,
          background: 'var(--bg-elev-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text)',
          fontFamily: 'inherit',
          width: '100%',
          ...style,
        }}
      />
    </div>
  )
}
