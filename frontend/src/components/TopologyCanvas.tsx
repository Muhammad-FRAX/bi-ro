import { useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type NodeProps,
  type EdgeProps,
  getBezierPath,
} from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import '@xyflow/react/dist/style.css'

// ── Type definitions ──────────────────────────────────────────────────────────

export interface PortInfo {
  number: number
  protocol: string
  appLabel: string | null
  exposure: string
}

export interface TopologyNode {
  id: string
  type: 'server' | 'app_instance'
  data: {
    label: string
    environment?: string
    status?: string
    serverId?: string
    serverHostname?: string
    instanceId?: string
    ports?: PortInfo[]
  }
}

export interface TopologyEdge {
  id: string
  source: string
  target: string
  data: {
    label: string | null
    protocol: string | null
  }
}

interface TopologyCanvasProps {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  loading?: boolean
  blastRadius?: string[]
  accessibilityMode?: boolean
  onNodeClick?: (id: string, type: 'server' | 'app_instance') => void
}

// ── Dagre layout ──────────────────────────────────────────────────────────────

const NODE_WIDTH = 190
const INSTANCE_NODE_HEIGHT = 60
const PORT_BADGE_HEIGHT = 20
const MAX_INLINE_PORTS = 3

function serverNodeHeight(portCount: number): number {
  const inline = Math.min(portCount, MAX_INLINE_PORTS)
  const hasOverflow = portCount > MAX_INLINE_PORTS
  return 68 + inline * PORT_BADGE_HEIGHT + (hasOverflow ? PORT_BADGE_HEIGHT : 0) + (portCount > 0 ? 8 : 0)
}

function applyDagreLayout(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
): Array<{ id: string; position: { x: number; y: number }; width: number; height: number }> {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80 })

  for (const node of nodes) {
    const h = node.type === 'server'
      ? serverNodeHeight(node.data.ports?.length ?? 0)
      : INSTANCE_NODE_HEIGHT
    g.setNode(node.id, { width: NODE_WIDTH, height: h })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const n = g.node(node.id)
    const h = node.type === 'server'
      ? serverNodeHeight(node.data.ports?.length ?? 0)
      : INSTANCE_NODE_HEIGHT
    return {
      id: node.id,
      position: { x: n.x - NODE_WIDTH / 2, y: n.y - h / 2 },
      width: NODE_WIDTH,
      height: h,
    }
  })
}

// ── Custom node: ServerNode ───────────────────────────────────────────────────

function ServerNode({ data, selected }: NodeProps & { data: TopologyNode['data'] }) {
  const isHighlighted = (data as { _highlighted?: boolean })._highlighted
  const env = data.environment ?? ''
  const status = data.status ?? ''
  const ports = data.ports ?? []
  const visiblePorts = ports.slice(0, MAX_INLINE_PORTS)
  const overflowCount = ports.length - MAX_INLINE_PORTS
  const nodeH = serverNodeHeight(ports.length)

  const envColor =
    env === 'prod' ? 'var(--danger)' :
    env === 'staging' ? 'var(--warning)' :
    env === 'dev' ? 'var(--success)' :
    'var(--text-muted)'

  const statusColor =
    status === 'active' ? 'var(--success)' :
    status === 'decommissioned' ? 'var(--text-subtle)' :
    'var(--warning)'

  return (
    <div
      aria-label={`Server: ${data.label}`}
      style={{
        background: isHighlighted
          ? 'var(--accent-soft)'
          : selected
          ? 'color-mix(in srgb, var(--bg-elev) 80%, var(--accent-soft))'
          : 'var(--bg-elev)',
        border: `1px solid ${isHighlighted || selected ? 'var(--accent-strong)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        padding: '8px 10px 6px',
        width: NODE_WIDTH,
        height: nodeH,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        boxShadow: isHighlighted || selected
          ? '0 0 0 2px var(--accent-soft)'
          : '0 1px 3px rgba(0,0,0,0.15)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: 'var(--border)' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {data.label}
        </span>
        <span style={{ display: 'inline-block', padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: envColor, background: `color-mix(in srgb, ${envColor} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${envColor} 25%, transparent)`, flexShrink: 0 }}>
          {env}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{status}</span>
      </div>

      {/* Port badges */}
      {ports.length > 0 && (
        <div style={{ marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visiblePorts.map((p) => {
            const expColor = p.exposure === 'external' ? 'var(--danger)' : p.exposure === 'vpn' ? 'var(--warning)' : 'var(--text-subtle)'
            return (
              <div key={p.number} style={{ display: 'flex', alignItems: 'center', gap: 4, height: PORT_BADGE_HEIGHT - 2 }}>
                {/* Pipe nub */}
                <div style={{ width: 6, height: 1, background: 'var(--border)', flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', flexShrink: 0 }}>:{p.number}</span>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: expColor, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.appLabel ?? p.protocol}
                </span>
              </div>
            )
          })}
          {overflowCount > 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-subtle)', height: PORT_BADGE_HEIGHT - 2, display: 'flex', alignItems: 'center', paddingLeft: 10 }}>
              +{overflowCount} more — click for all
            </div>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} style={{ background: 'var(--border)' }} />
    </div>
  )
}

// ── Custom node: AppInstanceNode ──────────────────────────────────────────────

function AppInstanceNode({ data, selected }: NodeProps & { data: TopologyNode['data'] }) {
  const isHighlighted = (data as { _highlighted?: boolean })._highlighted

  return (
    <div
      aria-label={`App instance: ${data.label} on ${data.serverHostname ?? ''}`}
      style={{
        background: isHighlighted
          ? 'var(--accent-soft)'
          : selected
          ? 'color-mix(in srgb, var(--bg-elev) 80%, var(--accent-soft))'
          : 'var(--bg-elev)',
        border: `1px solid ${isHighlighted || selected ? 'var(--accent-strong)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        padding: '6px 10px',
        width: NODE_WIDTH,
        height: INSTANCE_NODE_HEIGHT,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        justifyContent: 'center',
        boxShadow: isHighlighted || selected
          ? '0 0 0 2px var(--accent-soft)'
          : '0 1px 2px rgba(0,0,0,0.1)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: 'var(--border)' }} />
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {data.label}
      </span>
      {data.serverHostname && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {data.serverHostname}
        </span>
      )}
      <Handle type="source" position={Position.Right} style={{ background: 'var(--border)' }} />
    </div>
  )
}

// ── Custom edge with label ────────────────────────────────────────────────────

function TopologyEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  animated,
  selected,
}: EdgeProps & { data?: { label?: string | null; protocol?: string | null } }) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const label = data?.label ?? data?.protocol ?? null

  return (
    <>
      <path
        id={id}
        d={edgePath}
        stroke={selected ? 'var(--accent)' : 'var(--border)'}
        strokeWidth={selected ? 2 : 1.5}
        fill="none"
        strokeDasharray={animated ? '6 3' : undefined}
        style={animated ? { animation: 'dash 1s linear infinite' } : undefined}
      />
      {label && (
        <foreignObject
          x={labelX - 40}
          y={labelY - 10}
          width={80}
          height={20}
          style={{ overflow: 'visible' }}
        >
          <div
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              padding: '1px 5px',
              fontSize: 10,
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
              textAlign: 'center',
            }}
          >
            {label}
          </div>
        </foreignObject>
      )}
    </>
  )
}

// ── Main TopologyCanvas component ─────────────────────────────────────────────

const nodeTypes = {
  server: ServerNode,
  app_instance: AppInstanceNode,
}

const edgeTypes = {
  topology: TopologyEdgeComponent,
}

export function TopologyCanvas({
  nodes: rawNodes,
  edges: rawEdges,
  loading = false,
  blastRadius = [],
  accessibilityMode = false,
  onNodeClick,
}: TopologyCanvasProps) {
  // Apply layout
  const layoutPositions = useMemo(
    () => applyDagreLayout(rawNodes, rawEdges),
    [rawNodes, rawEdges],
  )

  const blastSet = useMemo(() => new Set(blastRadius), [blastRadius])

  const flowNodes = useMemo(
    () =>
      rawNodes.map((node) => {
        const pos = layoutPositions.find((p) => p.id === node.id)
        return {
          id: node.id,
          type: node.type,
          position: pos?.position ?? { x: 0, y: 0 },
          data: {
            ...node.data,
            _highlighted: blastSet.has(node.id),
          },
        }
      }),
    [rawNodes, layoutPositions, blastSet],
  )

  const flowEdges = useMemo(
    () =>
      rawEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'topology',
        animated:
          blastSet.has(edge.source) ||
          blastSet.has(edge.target),
        data: edge.data,
      })),
    [rawEdges, blastSet],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges)

  // Sync internal state when source data or blast radius changes
  useEffect(() => { setNodes(flowNodes) }, [flowNodes, setNodes])
  useEffect(() => { setEdges(flowEdges) }, [flowEdges, setEdges])

  const handleNodeClick = useCallback(
    (_evt: React.MouseEvent, node: { id: string; type?: string }) => {
      onNodeClick?.(node.id, (node.type ?? 'server') as 'server' | 'app_instance')
    },
    [onNodeClick],
  )

  // Loading skeleton
  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading topology"
        style={{
          height: 480,
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: '2px solid var(--border)',
            borderTopColor: 'var(--accent)',
            animation: 'spin 600ms linear infinite',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // Empty state
  if (rawNodes.length === 0) {
    return (
      <div
        aria-label="No topology data"
        style={{
          height: 480,
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
          Nothing mapped yet. Add servers + apps.
        </p>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          Create servers and app instances to visualise your infrastructure topology.
        </p>
      </div>
    )
  }

  // Accessibility table fallback
  if (accessibilityMode) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <section aria-label="Topology nodes">
          <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            Nodes ({rawNodes.length})
          </h3>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              color: 'var(--text)',
            }}
          >
            <thead>
              <tr>
                {['ID', 'Type', 'Label', 'Details'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '4px 8px',
                      borderBottom: '1px solid var(--border)',
                      color: 'var(--text-muted)',
                      fontWeight: 600,
                      fontSize: 12,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rawNodes.map((n) => (
                <tr key={n.id}>
                  <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {n.id}
                  </td>
                  <td style={{ padding: '4px 8px' }}>{n.type}</td>
                  <td style={{ padding: '4px 8px' }}>{n.data.label}</td>
                  <td style={{ padding: '4px 8px', color: 'var(--text-muted)', fontSize: 12 }}>
                    {n.type === 'server'
                      ? `${n.data.environment ?? ''} • ${n.data.status ?? ''}`
                      : n.data.serverHostname ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-label="Topology edges">
          <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            Edges ({rawEdges.length})
          </h3>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              color: 'var(--text)',
            }}
          >
            <thead>
              <tr>
                {['From', 'To', 'Label', 'Protocol'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '4px 8px',
                      borderBottom: '1px solid var(--border)',
                      color: 'var(--text-muted)',
                      fontWeight: 600,
                      fontSize: 12,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rawEdges.map((e) => (
                <tr key={e.id}>
                  <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {e.source}
                  </td>
                  <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {e.target}
                  </td>
                  <td style={{ padding: '4px 8px' }}>{e.data.label ?? '—'}</td>
                  <td style={{ padding: '4px 8px' }}>{e.data.protocol ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    )
  }

  // Canvas
  return (
    <div
      style={{
        height: 480,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        background: 'var(--bg)',
      }}
    >
      <style>{`
        @keyframes dash { to { stroke-dashoffset: -18; } }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={16} />
        <Controls
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
          }}
        />
        <MiniMap
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
          }}
          nodeColor={(node) =>
            node.type === 'server' ? 'var(--accent)' : 'var(--border)'
          }
        />
      </ReactFlow>
    </div>
  )
}
