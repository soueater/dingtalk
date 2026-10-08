// src/components/panels/FlowList.tsx —— 页面跳转关系总览
import { useProjectStore } from '@/stores/project.store'
import { Button } from '@/components/ui/Button'
import { IconTrash, IconLink } from '@/components/ui/Icons'

export function FlowList() {
  const design = useProjectStore((s) => s.design)
  const commit = useProjectStore((s) => s.commit)
  const setActivePage = useProjectStore((s) => s.setActivePage)

  const nameOf = (id: string) => design.pages.find((p) => p.id === id)?.name ?? id

  if (!design.flows.length) {
    return (
      <div className="empty">
        <div className="empty-icon">
          <IconLink size={18} />
        </div>
        <div className="empty-title">还没有页面跳转</div>
        <div className="empty-desc">
          选中某个按钮或列表项，在属性面板底部添加「点击跳转」目标页面。
        </div>
      </div>
    )
  }

  const remove = (id: string) => {
    commit('删除页面跳转', (d) => {
      d.flows = d.flows.filter((f) => f.id !== id)
      return d
    })
  }

  return (
    <div>
      <div className="block">
        <div className="block-title">跳转关系（{design.flows.length}）</div>
        {design.flows.map((f) => {
          const node = findName(design.pages, f.from)
          return (
            <div key={f.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <div className="flex-1">
                <div className="title">
                  <span
                    style={{ color: 'var(--brand)', cursor: 'pointer' }}
                    onClick={() => setActivePage(f.fromPage)}
                  >
                    {nameOf(f.fromPage)}
                  </span>
                  <span style={{ color: 'var(--text-3)', margin: '0 5px' }}>→</span>
                  <span style={{ cursor: 'pointer' }} onClick={() => setActivePage(f.to)}>
                    {nameOf(f.to)}
                  </span>
                </div>
                <div className="sub">
                  触发元素：{node ?? f.from} · {f.trigger === 'click' ? '点击' : f.trigger}
                </div>
              </div>
              <Button variant="ghost" size="sm" iconOnly onClick={() => remove(f.id)} title="删除">
                <IconTrash size={11} />
              </Button>
            </div>
          )
        })}
      </div>

      <div className="block">
        <div className="block-title">页面连线图</div>
        <FlowGraph />
      </div>
    </div>
  )
}

function findName(pages: import('@shared/design').Page[], nodeId: string): string | null {
  for (const p of pages) {
    const found = walk(p.root)
    if (found) return found
  }
  return null

  function walk(n: import('@shared/design').Node): string | null {
    if (n.id === nodeId) return n.name ?? n.type
    for (const c of n.children ?? []) {
      const r = walk(c)
      if (r) return r
    }
    return null
  }
}

/** 简易 SVG 页面关系图 */
function FlowGraph() {
  const design = useProjectStore((s) => s.design)
  const setActivePage = useProjectStore((s) => s.setActivePage)

  const w = 260
  const rowH = 34
  const h = Math.max(80, design.pages.length * rowH + 20)
  const xs = design.pages.map((_, i) => 30 + (i % 2) * 130)
  const ys = design.pages.map((_, i) => 22 + Math.floor(i / 2) * 60)

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <defs>
        <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0L8 4L0 8z" fill="var(--brand)" />
        </marker>
      </defs>

      {design.flows.map((f, i) => {
        const from = design.pages.findIndex((p) => p.id === f.fromPage)
        const to = design.pages.findIndex((p) => p.id === f.to)
        if (from < 0 || to < 0) return null
        const x1 = xs[from] + 45
        const y1 = ys[from]
        const x2 = xs[to] + 45
        const y2 = ys[to]
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2 - 12
        return (
          <path
            key={f.id || i}
            d={`M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`}
            stroke="var(--brand)"
            strokeWidth="1.2"
            fill="none"
            opacity="0.7"
            markerEnd="url(#arrow)"
          />
        )
      })}

      {design.pages.map((p, i) => (
        <g key={p.id} style={{ cursor: 'pointer' }} onClick={() => setActivePage(p.id)}>
          <rect
            x={xs[i]}
            y={ys[i] - 13}
            width="90"
            height="26"
            rx="6"
            fill="var(--surface-3)"
            stroke="var(--border-strong)"
          />
          <text
            x={xs[i] + 45}
            y={ys[i] + 4}
            textAnchor="middle"
            fontSize="10"
            fill="var(--text-2)"
          >
            {p.name.length > 7 ? `${p.name.slice(0, 7)}…` : p.name}
          </text>
        </g>
      ))}
    </svg>
  )
}
