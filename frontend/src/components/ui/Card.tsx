import type { CSSProperties, ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  title?: string
  style?: CSSProperties
}

export function Card({ children, title, style }: CardProps) {
  return (
    <div
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 16,
        ...style,
      }}
    >
      {title && (
        <p
          style={{
            margin: '0 0 12px',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {title}
        </p>
      )}
      {children}
    </div>
  )
}
