import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'

export type ButtonSize = 'sm' | 'md' | 'lg'
export type ButtonIntent = 'primary' | 'secondary' | 'danger' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize
  intent?: ButtonIntent
  children: ReactNode
}

const sizeStyles: Record<ButtonSize, CSSProperties> = {
  sm: { height: 'var(--btn-h-sm)', padding: '0 8px', fontSize: 12 },
  md: { height: 'var(--btn-h)', padding: '0 12px', fontSize: 13 },
  lg: { height: 'var(--btn-h-lg)', padding: '0 16px', fontSize: 14 },
}

const intentStyles: Record<ButtonIntent, CSSProperties> = {
  primary: {
    background: 'var(--accent)',
    color: '#fff',
    border: '1px solid transparent',
  },
  secondary: {
    background: 'var(--bg-elev-2)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
  },
  danger: {
    background: 'var(--danger)',
    color: '#fff',
    border: '1px solid transparent',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid transparent',
  },
}

export function Button({
  size = 'md',
  intent = 'secondary',
  style,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled}
      style={{
        ...sizeStyles[size],
        ...intentStyles[intent],
        borderRadius: 'var(--radius-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'inherit',
        fontWeight: 500,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        lineHeight: 1,
        transition: 'opacity 120ms',
        ...style,
      }}
    >
      {children}
    </button>
  )
}
