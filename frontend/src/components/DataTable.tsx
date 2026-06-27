import type { CSSProperties, ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
  width?: number | string
}

interface DataTableProps<T extends object> {
  columns: Column<T>[]
  rows: T[]
  keyField: keyof T & string
  loading?: boolean
  emptyMessage?: ReactNode
  rowActions?: (row: T) => ReactNode
  onRowClick?: (row: T) => void
}

const cellStyle: CSSProperties = {
  padding: '0 12px',
  fontSize: 13,
  color: 'var(--text)',
  borderBottom: '1px solid var(--border)',
  height: 38,
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const headerStyle: CSSProperties = {
  ...cellStyle,
  color: 'var(--text-muted)',
  fontSize: 12,
  fontWeight: 500,
  background: 'var(--bg-elev)',
  height: 34,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const SKELETON_WIDTHS = [60, 80, 50, 70, 65, 55, 75, 45]

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }, (_, i) => (
        <td key={i} style={{ ...cellStyle, padding: '8px 12px' }}>
          <div
            style={{
              height: 14,
              background: 'var(--bg-elev-2)',
              borderRadius: 4,
              width: `${SKELETON_WIDTHS[i % SKELETON_WIDTHS.length]}%`,
              opacity: 0.6,
            }}
          />
        </td>
      ))}
    </tr>
  )
}

export function DataTable<T extends object>({
  columns,
  rows,
  keyField,
  loading = false,
  emptyMessage = 'No data.',
  rowActions,
  onRowClick,
}: DataTableProps<T>) {
  const totalCols = columns.length + (rowActions ? 1 : 0)

  return (
    <div
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}
      role="region"
      aria-label="Data table"
    >
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={{ ...headerStyle, width: col.width, textAlign: 'left' }}
                >
                  {col.header}
                </th>
              ))}
              {rowActions && (
                <th scope="col" style={{ ...headerStyle, width: 80, textAlign: 'right' }}>
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>
                <SkeletonRow cols={totalCols} />
                <SkeletonRow cols={totalCols} />
                <SkeletonRow cols={totalCols} />
              </>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={totalCols}
                  style={{
                    ...cellStyle,
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    padding: '32px 12px',
                    height: 'auto',
                  }}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={String(row[keyField])}
                  style={{ transition: 'background 80ms', cursor: onRowClick ? 'pointer' : undefined }}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row) } } : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? 'button' : undefined}
                  onMouseEnter={(e) => {
                    ;(e.currentTarget as HTMLTableRowElement).style.background = 'var(--accent-soft)'
                  }}
                  onMouseLeave={(e) => {
                    ;(e.currentTarget as HTMLTableRowElement).style.background = ''
                  }}
                >
                  {columns.map((col) => (
                    <td key={col.key} style={cellStyle}>
                      {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                  {rowActions && (
                    <td style={{ ...cellStyle, textAlign: 'right', padding: '0 8px' }}>
                      {rowActions(row)}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
