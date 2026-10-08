// src/components/canvas/CanvasOverlays.tsx —— 画布增强层（F-PM-09）
//
// 三块相互独立的叠加物，都建立在 canvas-layout 的同一套坐标之上：
//   · GroupFrames —— 给同一分组的界面画一个外框 + 标题，让"哪些屏是一组的"肉眼可见；
//   · FlowLayer   —— 界面级跳转连线（是从 flows 推出来的，不需要用户再画一遍）；
//   · MiniMap     —— 右下角缩略导航，界面一多就不会迷路。
import { useMemo, useRef } from 'react'
import type { DesignJSON, Flow, Page, PageGroup } from '@shared/design'
import { GROUP_COLORS } from '@shared/interfaces'
import { boundsOf, inflate, layoutPages, rectsIntersect, type PageBox, type Rect } from '@/lib/canvas-layout'

/* ============================ 分组框 ============================ */

export interface GroupFrameModel {
  id: string
  name: string
  color: string
  rect: Rect
  pageCount: number
}

/** 由布局结果推出每个分组的外框；未分组界面不画框 */
export function groupFrames(design: DesignJSON, boxes: PageBox[]): GroupFrameModel[] {
  const groups = design.pageGroups ?? []
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const out: GroupFrameModel[] = []
  groups.forEach((g: PageGroup, i) => {
    const rects = design.pages
      .filter((p) => p.groupId === g.id)
      .map((p) => byId.get(p.id))
      .filter((b): b is PageBox => !!b)
      .map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))
    const b = boundsOf(rects)
    if (!b) return
    out.push({
      id: g.id,
      name: g.name,
      color: g.color ?? GROUP_COLORS[i % GROUP_COLORS.length],
      rect: inflate(b, 22, 34),
      pageCount: rects.length,
    })
  })
  return out
}

export function GroupFrames({
  frames,
  onSelectGroup,
  onRenameGroup,
}: {
  frames: GroupFrameModel[]
  onSelectGroup?: (groupId: string) => void
  onRenameGroup?: (groupId: string, name: string) => void
}) {
  if (!frames.length) return null
  return (
    <div className="cv-groups" aria-hidden={false}>
      {frames.map((f) => (
        <div
          key={f.id}
          className="cv-group-frame"
          style={{
            left: f.rect.x,
            top: f.rect.y,
            width: f.rect.w,
            height: f.rect.h,
            borderColor: f.color,
          }}
        >
          <button
            className="cv-group-label"
            style={{ background: f.color }}
            title={`${f.name} · ${f.pageCount} 个界面（双击改名，单击选中组内界面）`}
            onClick={() => onSelectGroup?.(f.id)}
            onDoubleClick={() => {
              const next = window.prompt('分组名称', f.name)
              if (next?.trim()) onRenameGroup?.(f.id, next.trim())
            }}
          >
            {f.name}
            <span className="n">{f.pageCount}</span>
          </button>
        </div>
      ))}
    </div>
  )
}

/* ============================ 流程连线 ============================ */

interface Edge {
  id: string
  from: Rect
  to: Rect
  label?: string
  /** 两端在同一行时用直线，否则用绕行曲线 */
  sameRow: boolean
}

/** 从 flows 推出界面级连线。自环（自己跳自己）跳过，避免画出一坨。 */
export function flowEdges(design: DesignJSON, boxes: PageBox[]): Edge[] {
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const out: Edge[] = []
  for (const f of design.flows as Flow[]) {
    if (!f.fromPage || !f.to || f.fromPage === f.to) continue
    const a = byId.get(f.fromPage)
    const b = byId.get(f.to)
    if (!a || !b) continue
    out.push({
      id: f.id,
      from: { x: a.x, y: a.y, w: a.w, h: a.h },
      to: { x: b.x, y: b.y, w: b.w, h: b.h },
      label: f.trigger,
      sameRow: a.y === b.y,
    })
  }
  return out
}

function edgePath(e: Edge): string {
  const ax = e.from.x + e.from.w
  const ay = e.from.y + e.from.h / 2
  if (e.sameRow) {
    const bx = e.to.x
    const by = e.to.y + e.to.h / 2
    const mx = (ax + bx) / 2
    return `M ${ax} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`
  }
  /* 跨行：从右侧出发，绕到目标左侧 */
  const bx = e.to.x
  const by = e.to.y + e.to.h / 2
  const bulge = 28
  const above = e.to.y > e.from.y
  const dirY = above ? e.from.y + e.from.h + bulge : e.from.y - bulge
  return `M ${ax} ${ay} C ${ax + bulge} ${ay}, ${ax + bulge} ${dirY}, ${ax - 4} ${dirY} L ${bx - bulge - 4} ${dirY} C ${bx - bulge} ${dirY}, ${bx - bulge} ${by}, ${bx} ${by}`
}

export function FlowLayer({
  edges,
  width,
  height,
}: {
  edges: Edge[]
  width: number
  height: number
}) {
  if (!edges.length) return null
  return (
    <svg className="cv-flow-layer" width={width} height={height}>
      <defs>
        <marker id="cv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--brand)" />
        </marker>
      </defs>
      {edges.map((e) => (
        <g key={e.id} className="cv-edge">
          <path d={edgePath(e)} markerEnd="url(#cv-arrow)" />
        </g>
      ))}
    </svg>
  )
}

/* ============================ 缩略导航图 ============================ */

export function MiniMap({
  design,
  boxes,
  canvas,
  zoom,
  pan,
  viewport,
  width = 188,
  height = 128,
  onJump,
}: {
  design: DesignJSON
  boxes: PageBox[]
  canvas: { width: number; height: number }
  zoom: number
  pan: { x: number; y: number }
  viewport: { w: number; h: number }
  width?: number
  height?: number
  onJump: (world: { x: number; y: number }) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)

  const { scale, offset, viewRect } = useMemo(() => {
    const content = boundsOf(boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))) ?? {
      x: 0,
      y: 0,
      w: canvas.width,
      h: canvas.height,
    }
    const pad = 16
    const s = Math.min((width - pad) / content.w, (height - pad) / content.h)
    const off = { x: (width - content.w * s) / 2 - content.x * s, y: (height - content.h * s) / 2 - content.y * s }
    /* 当前视口在"世界坐标"里的矩形 */
    const vr = {
      x: -pan.x / zoom,
      y: -pan.y / zoom,
      w: viewport.w / zoom,
      h: viewport.h / zoom,
    }
    return { scale: s, offset: off, viewRect: vr }
  }, [boxes, canvas.width, canvas.height, width, height, zoom, pan.x, pan.y, viewport.w, viewport.h])

  const groupColor = (p: Page, i: number) => {
    const g = (design.pageGroups ?? []).find((x) => x.id === p.groupId)
    if (!g) return 'var(--text-3)'
    const idx = (design.pageGroups ?? []).findIndex((x) => x.id === g.id)
    return g.color ?? GROUP_COLORS[idx % GROUP_COLORS.length]
  }

  const toMini = (x: number, y: number) => ({ x: x * scale + offset.x, y: y * scale + offset.y })

  const jumpFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    onJump({ x: (mx - offset.x) / scale, y: (my - offset.y) / scale })
  }

  return (
    <div
      ref={wrapRef}
      className="cv-minimap"
      style={{ width, height }}
      title="缩略导航：点击任意位置跳转视野"
      onMouseDown={(e) => {
        e.stopPropagation()
        jumpFromEvent(e)
      }}
      onMouseMove={(e) => {
        if (e.buttons === 1) jumpFromEvent(e)
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {boxes.map((b, i) => {
        const p = design.pages[b.index]
        if (!p) return null
        const tl = toMini(b.x, b.y)
        const visible = rectsIntersect({ x: b.x, y: b.y, w: b.w, h: b.h }, viewRect)
        return (
          <div
            key={b.id}
            className={`cv-mm-page ${visible ? 'visible' : ''}`}
            style={{
              left: tl.x,
              top: tl.y,
              width: Math.max(3, b.w * scale),
              height: Math.max(3, b.h * scale),
              borderColor: groupColor(p, i),
            }}
          />
        )
      })}
      <div
        className="cv-mm-view"
        style={{
          left: viewRect.x * scale + offset.x,
          top: viewRect.y * scale + offset.y,
          width: viewRect.w * scale,
          height: viewRect.h * scale,
        }}
      />
    </div>
  )
}

/* 供画布直接使用的派生函数集合 */
export function useCanvasOverlays(design: DesignJSON) {
  return useMemo(() => {
    const boxes = layoutPages(design.pages, design.meta.canvas)
    return {
      boxes,
      frames: groupFrames(design, boxes),
      edges: flowEdges(design, boxes),
    }
  }, [design])
}
