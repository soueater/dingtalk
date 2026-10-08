// src/components/canvas/Canvas.tsx
// 画布内核：多页面并排 + 缩放/平移 + 选中 + 命令式拖拽/缩放 + 吸附对齐
//
// 性能设计（对应 docs/S2-1 ADR A-6）：
// 拖拽期间 **完全不触发 React 重渲染**——直接改写目标元素的 transform 与选中框的
// 几何属性，仅在 pointerup 时向 store 提交一次 commit。这样即使页面上有数百个节点，
// 拖动也是稳定的 60fps（每帧只有一次样式写入 + 一次 rAF 绘制）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DesignJSON, Node, Page } from '@shared/design'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'
import type { TokenMap } from '@/services/render/tokens'
import { buildTokenMap } from '@/services/render/tokens'
import { tokenMapForPage } from '@/services/design/specs'
import { renderNodeWithStates } from '@/services/render/node'
import { CanvasToolbar } from './CanvasToolbar'
import { FlowLayer, GroupFrames, MiniMap, flowEdges, groupFrames } from './CanvasOverlays'
import { normalizeOrders } from '@shared/interfaces'
import { boundsOf, fitTransform, layoutPages, tidyOrder } from '@/lib/canvas-layout'
import { clamp } from '@/lib/format'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
/** 拖动吸附阈值（屏幕像素） */
const SNAP_THRESHOLD = 6

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface DragState {
  kind: 'pan' | 'move' | 'resize'
  handle?: Handle
  startClientX: number
  startClientY: number
  panOriginX: number
  panOriginY: number
  nodeId?: string
  /** 拖拽开始时的元素几何（设计坐标） */
  startRect?: Rect
  /** 拖拽开始前的完整设计快照，用于生成撤销记录 */
  snapshot?: DesignJSON
  /** 是否发生过实际位移 */
  moved: boolean
  /** 需要被命令式更新的 DOM 元素 */
  el?: HTMLElement
  /** 选中框 DOM */
  overlay?: HTMLElement
  /** 吸附辅助线 SVG 组 */
  guides?: HTMLElement
}

export function Canvas() {
  const design = useProjectStore((s) => s.design)
  const activePageId = useProjectStore((s) => s.activePageId)
  const selectedIds = useProjectStore((s) => s.selectedIds)
  const setActivePage = useProjectStore((s) => s.setActivePage)
  const select = useProjectStore((s) => s.select)

  const viewportRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(0.8)
  const [pan, setPan] = useState({ x: 60, y: 60 })
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const rafRef = useRef<number | null>(null)

  // F-ST-01：按页解析生效 TokenMap（页面级规范覆盖项目级）；未绑定规范时等价于 design.tokens
  const map = useMemo(() => buildTokenMap(design.tokens), [design.tokens])
  // 页面级规范按 page.id 缓存，避免每帧重复建 map
  const specMapCache = useMemo(() => {
    const cache = new Map<string, TokenMap>()
    for (const p of design.pages) cache.set(p.id, tokenMapForPage(design, p))
    return cache
  }, [design.pages, design.meta.specId, design.specs, design.tokens])
  const mapForPage = useCallback(
    (page: Page) => (design.meta.specId || page.specId ? specMapCache.get(page.id) ?? map : map),
    [specMapCache, map, design.meta.specId],
  )
  const { canvas } = design.meta
  const pages = design.pages

  /* ---------------------- F-PM-09：画布叠加层 ---------------------- */
  /** 界面摆放的唯一口径：画布渲染、分组框、连线、缩略图共用 */
  const boxes = useMemo(() => layoutPages(pages, canvas), [pages, canvas])
  const boxById = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes])
  const [showGroups, setShowGroups] = useState(true)
  const [showFlows, setShowFlows] = useState(false)
  const [showMiniMap, setShowMiniMap] = useState(true)
  const [viewportSize, setViewportSize] = useState({ w: 1200, h: 800 })

  const frames = useMemo(
    () => (showGroups ? groupFrames(design, boxes) : []),
    [design, boxes, showGroups],
  )
  const edges = useMemo(
    () => (showFlows ? flowEdges(design, boxes) : []),
    [design, boxes, showFlows],
  )
  /** 叠加层区域尺寸：覆盖所有界面并留出边框空间 */
  const overlaySize = useMemo(() => {
    const b = boundsOf(boxes.map((x) => ({ x: x.x, y: x.y, w: x.w, h: x.h })))
    if (!b) return { width: canvas.width + 200, height: canvas.height + 200 }
    return { width: b.x + b.w + 80, height: b.y + b.h + 80 }
  }, [boxes, canvas.width, canvas.height])

  /* ============================ 视图变换 ============================ */

  const zoomAt = useCallback((delta: number, cx?: number, cy?: number) => {
    setZoom((z) => {
      const next = clamp(z * delta, MIN_ZOOM, MAX_ZOOM)
      if (cx != null && cy != null) {
        const k = next / z
        setPan((p) => ({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }))
      }
      return next
    })
  }, [])

  // 把 1/zoom 暴露给 CSS，用于让选中框描边与手柄保持恒定视觉粗细
  // （否则 1.5px 描边在 50% 缩放下会变成 0.75px，看起来「框比内容小一圈」）
  useEffect(() => {
    stageRef.current?.style.setProperty('--inv-zoom', String(1 / zoom))
  }, [zoom])

  const fitToView = useCallback(() => {
    const vp = viewportRef.current
    if (!vp || !pages.length) return
    const rect = vp.getBoundingClientRect()
    /* 用布局的真实外框（可能多行），而不是"一行宽度" */
    const content = boundsOf(boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })))
    const t = fitTransform(content, { w: rect.width, h: rect.height }, 80, MIN_ZOOM, 1.6)
    setZoom(t.zoom)
    setPan(t.pan)
  }, [pages.length, boxes])

  // 首屏与页面数量变化时自适应
  useEffect(() => {
    const t = setTimeout(fitToView, 60)
    return () => clearTimeout(t)
  }, [fitToView])

  // 视口尺寸（缩略导航图需要它算"当前可见区"）
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const measure = () => {
      const r = vp.getBoundingClientRect()
      setViewportSize({ w: r.width, h: r.height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [])

  /**
   * 一键排布（F-PM-09）。
   * 做的是「按分组重排顺序」而不是「随机摆放」—— 真正的痛点是同组界面被别组隔开，
   * 几何位置由 layoutPages 统一计算，无需也不该把位置写回 page.pos。
   */
  const tidyCanvas = useCallback(() => {
    const st = useProjectStore.getState()
    const d = st.design
    const groupIds = (d.pageGroups ?? []).map((g) => g.id)
    const order = tidyOrder(d.pages, groupIds)
    const map = new Map(d.pages.map((p) => [p.id, p]))
    const next = order.map((id) => map.get(id)).filter((p): p is Page => !!p)
    const same = next.every((p, i) => p.id === d.pages[i].id)
    if (same) {
      useUiStore.getState().toast('info', '界面已经按分组归拢，无需重排')
      return
    }
    st.commit('一键排布界面', (dd) => ({ ...dd, pages: normalizeOrders(next) }))
    useUiStore.getState().toast('success', '已按分组重排界面顺序')
    setTimeout(fitToView, 40)
  }, [fitToView])

  // 快捷键：Ctrl+Shift+L 排布；Ctrl+Shift+G 切换分组框；Ctrl+Shift+F 切换流程视图
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return
      const k = e.key.toLowerCase()
      if (k === 'l') {
        e.preventDefault()
        tidyCanvas()
      } else if (k === 'g') {
        e.preventDefault()
        setShowGroups((v) => !v)
      } else if (k === 'f') {
        e.preventDefault()
        setShowFlows((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tidyCanvas])

  // 响应菜单 / 快捷键的缩放指令
  useEffect(() => {
    const onFit = () => fitToView()
    const onReset = () => {
      setZoom(1)
      setPan({ x: 60, y: 60 })
    }
    const onZoomIn = () => zoomAt(1.2)
    const onZoomOut = () => zoomAt(1 / 1.2)
    window.addEventListener('app:zoom-fit', onFit)
    window.addEventListener('app:zoom-100', onReset)
    window.addEventListener('app:zoom-in', onZoomIn)
    window.addEventListener('app:zoom-out', onZoomOut)
    return () => {
      window.removeEventListener('app:zoom-fit', onFit)
      window.removeEventListener('app:zoom-100', onReset)
      window.removeEventListener('app:zoom-in', onZoomIn)
      window.removeEventListener('app:zoom-out', onZoomOut)
    }
  }, [fitToView, zoomAt])

  /* ============================ 滚轮 ============================ */

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = vp.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.deltaY < 0 ? 1.08 : 1 / 1.08, e.clientX - rect.left, e.clientY - rect.top)
      } else {
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
      }
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  /* ============================ 空格平移 ============================ */

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        e.preventDefault()
        setSpaceHeld(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false)
    }
    // 窗口失焦时复位，避免状态卡住
    const blur = () => setSpaceHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  /* ======================= 元素几何读取工具 ======================= */

  /** 读取某个节点在页面坐标系中的几何（不依赖 store） */
  const readNodeRect = useCallback((nodeId: string): Rect | null => {
    const stage = stageRef.current
    if (!stage) return null
    const el = stage.querySelector<HTMLElement>(`[data-id="${CSS.escape(nodeId)}"]`)
    if (!el) return null
    const pageEl = el.closest<HTMLElement>('[data-page-id]')
    if (!pageEl) return null
    const r = el.getBoundingClientRect()
    const pr = pageEl.getBoundingClientRect()
    return {
      x: (r.left - pr.left) / zoom,
      y: (r.top - pr.top) / zoom,
      w: r.width / zoom,
      h: r.height / zoom,
    }
  }, [zoom])

  /* ============================ 指针交互 ============================ */

  const onPointerDown = (e: React.PointerEvent) => {
    const vp = viewportRef.current
    if (!vp) return

    // 中键 / 空格 → 平移视图
    if (e.button === 1 || spaceHeld) {
      e.preventDefault()
      vp.setPointerCapture(e.pointerId)
      dragRef.current = {
        kind: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        panOriginX: pan.x,
        panOriginY: pan.y,
        moved: false,
      }
      return
    }
    if (e.button !== 0) return

    const target = e.target as HTMLElement
    const pageEl = target.closest<HTMLElement>('[data-page-id]')
    const pageId = pageEl?.dataset.pageId ?? activePageId
    if (pageId !== activePageId) setActivePage(pageId)

    // 缩放手柄
    const handleEl = target.closest<HTMLElement>('[data-handle]')
    if (handleEl && selectedIds.length === 1) {
      const nodeId = selectedIds[0]
      const rect = readNodeRect(nodeId)
      if (!rect) return
      const el = stageRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(nodeId)}"]`)
      e.preventDefault()
      vp.setPointerCapture(e.pointerId)
      dragRef.current = {
        kind: 'resize',
        handle: handleEl.dataset.handle as Handle,
        startClientX: e.clientX,
        startClientY: e.clientY,
        panOriginX: 0,
        panOriginY: 0,
        nodeId,
        startRect: rect,
        snapshot: JSON.parse(JSON.stringify(useProjectStore.getState().design)) as DesignJSON,
        moved: false,
        el: el ?? undefined,
        overlay: document.getElementById('__sel_overlay') ?? undefined,
      }
      return
    }

    // 节点：选中 + 准备拖动
    const nodeEl = target.closest<HTMLElement>('[data-id]')
    if (!nodeEl) {
      select([])
      return
    }

    const nodeId = nodeEl.dataset.id!
    const found = useProjectStore.getState().findNode(nodeId, pageId)
    if (!found) return
    if (!selectedIds.includes(nodeId)) select([nodeId])

    const rect = readNodeRect(nodeId)
    if (!rect) return

    e.preventDefault()
    vp.setPointerCapture(e.pointerId)
    dragRef.current = {
      kind: 'move',
      startClientX: e.clientX,
      startClientY: e.clientY,
      panOriginX: 0,
      panOriginY: 0,
      nodeId,
      startRect: rect,
      snapshot: JSON.parse(JSON.stringify(useProjectStore.getState().design)) as DesignJSON,
      moved: false,
      el: nodeEl,
      overlay: document.getElementById('__sel_overlay') ?? undefined,
      guides: document.getElementById('__sel_guides') ?? undefined,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return

    if (d.kind === 'pan') {
      setPan({ x: d.panOriginX + (e.clientX - d.startClientX), y: d.panOriginY + (e.clientY - d.startClientY) })
      return
    }

    const dx = (e.clientX - d.startClientX) / zoom
    const dy = (e.clientY - d.startClientY) / zoom
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) d.moved = true

    // 用 rAF 合并同一帧内的多次 pointermove，避免无效样式写入
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    const payload = { dx, dy, shift: e.shiftKey }
    rafRef.current = requestAnimationFrame(() => paintDrag(d, payload))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    viewportRef.current?.releasePointerCapture?.(e.pointerId)
    if (!d || d.kind === 'pan') return

    // 清理命令式写入的样式
    clearDragVisual(d)

    if (!d.moved || !d.nodeId || !d.snapshot) return

    const dx = (e.clientX - d.startClientX) / zoom
    const dy = (e.clientY - d.startClientY) / zoom
    const geoms = computeGeom(d, { dx, dy, shift: e.shiftKey })

    // 一次性提交，产生一条正确的撤销记录
    const nodeId = d.nodeId
    const start = d.startRect!
    const isResize = d.kind === 'resize'
    useProjectStore.getState().commit(isResize ? '调整尺寸' : '移动元素', (dd) => ({
      ...dd,
      pages: dd.pages.map((p) => ({
        ...p,
        root: patchNode(p.root, nodeId, (n) => {
          const origW = n.layout?.width
          const origH = n.layout?.height
          return {
            ...n,
            layout: {
              ...(n.layout ?? {}),
              // x/y 一旦出现即代表绝对定位（见 render/node.ts 的定位规则）
              mode: 'absolute',
              x: geoms.rect.x,
              y: geoms.rect.y,
              // 尺寸冻结：元素脱离文档流后，`fill`(100%) 会相对页面而非原父容器，
              // 导致一拖就「撑满整页」。因此把非数值尺寸固化为实测像素值。
              width: isResize ? geoms.rect.w : typeof origW === 'number' ? origW : Math.round(start.w),
              height: isResize ? geoms.rect.h : typeof origH === 'number' ? origH : Math.round(start.h),
            },
          }
        }),
      })),
    }))
  }

  const onPointerLeave = () => setHoverId(null)

  /** 命令式绘制拖拽中的视觉（不触发 React 渲染） */
  const paintDrag = (
    d: DragState,
    { dx, dy, shift }: { dx: number; dy: number; shift: boolean },
  ) => {
    const geoms = computeGeom(d, { dx, dy, shift })
    const { rect, snapped } = geoms

    // 重要：以下所有几何量都使用**设计坐标**（元素在舞台内的本地坐标），
    // 不做 zoom 换算。因为 .canvas-stage 已经整体 scale(zoom)，
    // 若此处再乘一次 zoom，就会变成 zoom² 的位移，导致拖拽跟手偏慢、
    // 松手跳位、选中框与内容错位。
    if (d.el) {
      const sdx = rect.x - d.startRect!.x
      const sdy = rect.y - d.startRect!.y
      if (d.kind === 'move') {
        d.el.style.transform = `translate(${sdx}px, ${sdy}px)`
        d.el.style.zIndex = '9999'
        d.el.style.opacity = '0.86'
      } else {
        // resize：直接改写宽高（仅影响单个元素）
        d.el.style.width = `${rect.w}px`
        d.el.style.height = `${rect.h}px`
        d.el.style.transform = `translate(${sdx}px, ${sdy}px)`
      }
    }

    // 选中框跟随（设计坐标）
    if (d.overlay) {
      d.overlay.style.transform = `translate(${rect.x}px, ${rect.y}px)`
      d.overlay.style.width = `${rect.w}px`
      d.overlay.style.height = `${rect.h}px`
    }

    // 吸附辅助线（设计坐标）
    if (d.guides) {
      d.guides.innerHTML = snapped
        .map((s) => {
          if (s.axis === 'x') {
            return `<line x1="${s.pos}" y1="0" x2="${s.pos}" y2="${canvas.height}" stroke="#f472b6" stroke-width="1" stroke-dasharray="3 3"/>`
          }
          return `<line x1="0" y1="${s.pos}" x2="${canvas.width}" y2="${s.pos}" stroke="#f472b6" stroke-width="1" stroke-dasharray="3 3"/>`
        })
        .join('')
    }
  }

  /** 计算拖拽后的最终几何（含网格吸附与对齐吸附） */
  const computeGeom = (
    d: DragState,
    { dx, dy, shift }: { dx: number; dy: number; shift: boolean },
  ): { rect: Rect; snapped: Array<{ axis: 'x' | 'y'; pos: number }> } => {
    const s = d.startRect!
    const snapped: Array<{ axis: 'x' | 'y'; pos: number }> = []

    if (d.kind === 'move') {
      let x = s.x + dx
      let y = s.y + dy

      // Shift：锁定单轴
      if (shift) {
        if (Math.abs(dx) > Math.abs(dy)) y = s.y
        else x = s.x
      }

      // 网格吸附（8px）
      x = Math.round(x / 8) * 8
      y = Math.round(y / 8) * 8

      // 与页面边缘 / 中心线对齐吸附
      // targets 记录「元素左上角应该落在哪」，lines 记录「辅助线画在哪」
      const xt = [
        { elemAt: 0, lineAt: 0 },
        { elemAt: canvas.width / 2 - s.w / 2, lineAt: canvas.width / 2 },
        { elemAt: canvas.width - s.w, lineAt: canvas.width },
      ]
      const yt = [
        { elemAt: 0, lineAt: 0 },
        { elemAt: canvas.height / 2 - s.h / 2, lineAt: canvas.height / 2 },
        { elemAt: canvas.height - s.h, lineAt: canvas.height },
      ]
      const snapX = nearestBy(x, xt, SNAP_THRESHOLD / zoom)
      const snapY = nearestBy(y, yt, SNAP_THRESHOLD / zoom)
      if (snapX) {
        x = snapX.elemAt
        snapped.push({ axis: 'x', pos: snapX.lineAt })
      }
      if (snapY) {
        y = snapY.elemAt
        snapped.push({ axis: 'y', pos: snapY.lineAt })
      }

      return { rect: { x, y, w: s.w, h: s.h }, snapped }
    }

    // resize
    const h = d.handle!
    let { x, y, w } = s
    let hh = s.h
    const minW = 8
    const minH = 8

    if (h.includes('e')) w = Math.max(minW, snapRound(s.w + dx))
    if (h.includes('s')) hh = Math.max(minH, snapRound(s.h + dy))
    if (h.includes('w')) {
      const nw = Math.max(minW, snapRound(s.w - dx))
      x = s.x + (s.w - nw)
      w = nw
    }
    if (h.includes('n')) {
      const nh = Math.max(minH, snapRound(s.h - dy))
      y = s.y + (s.h - nh)
      hh = nh
    }
    if (shift && h.length === 2) {
      const k = Math.max(w / s.w, hh / s.h)
      w = snapRound(s.w * k)
      hh = snapRound(s.h * k)
    }

    return { rect: { x, y, w, h: hh }, snapped }
  }

  /** 清掉命令式写入的行内样式（React 下一次渲染会重建 DOM） */
  const clearDragVisual = (d: DragState) => {
    if (d.el) {
      d.el.style.transform = ''
      d.el.style.opacity = ''
      d.el.style.zIndex = ''
      if (d.kind === 'resize') {
        d.el.style.width = ''
        d.el.style.height = ''
      }
    }
    if (d.guides) d.guides.innerHTML = ''
  }

  /* ============================ 渲染 ============================ */

  const selected = selectedIds.length === 1 ? selectedIds[0] : null
  const selectedPageId = pages.find((p) => p.id === activePageId)?.id ?? pages[0]?.id

  return (
    <div className="canvas-wrap">
      <CanvasToolbar
        zoom={zoom}
        onZoomIn={() => zoomAt(1.15)}
        onZoomOut={() => zoomAt(1 / 1.15)}
        onZoomReset={() => {
          setZoom(1)
          setPan({ x: 60, y: 60 })
        }}
        onFit={fitToView}
        showGroups={showGroups}
        showFlows={showFlows}
        showMiniMap={showMiniMap}
        onToggleGroups={() => setShowGroups((v) => !v)}
        onToggleFlows={() => setShowFlows((v) => !v)}
        onToggleMiniMap={() => setShowMiniMap((v) => !v)}
        onTidy={tidyCanvas}
        pageCount={pages.length}
      />

      <div
        ref={viewportRef}
        className={`canvas-viewport ${spaceHeld ? 'space-held' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      >
        <div
          ref={stageRef}
          className="canvas-stage"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          {/* 分组外框：在最底层，避免遮挡界面内容 */}
          {frames.length > 0 && (
            <GroupFrames
              frames={frames}
              onSelectGroup={(gid) => {
                const first = design.pages.find((p) => p.groupId === gid)
                if (first) setActivePage(first.id)
              }}
              onRenameGroup={(gid, name) => useProjectStore.getState().renameGroup(gid, name)}
            />
          )}

          {pages.map((page, i) => {
            const box = boxById.get(page.id)
            const left = box?.x ?? i * (canvas.width + 40)
            const top = box?.y ?? 0
            return (
              <div
                key={page.id}
                className={`page-frame ${page.id === activePageId ? 'selected-page' : ''}`}
                data-page-id={page.id}
                style={{
                  left,
                  top,
                  width: canvas.width,
                  height: canvas.height,
                }}
              >
                <div className="page-frame-label">{page.name}</div>
                {/* 页面内容容器：承接 overflow 裁切，并作为节点的定位上下文。
                    F-ST-02：改用 renderNodeWithStates，把节点的 hover/active/focus
                    规则随内容一起注入，画布上即可直接看到交互反馈。 */}
                <div
                  className="page-render"
                  dangerouslySetInnerHTML={{ __html: renderNodeWithStates(page.root, mapForPage(page)) }}
                />

                {/* 选中框：命令式定位的目标 */}
                {selected && page.id === selectedPageId && (
                  <SelectionBox nodeId={selected} zoom={zoom} readRect={readNodeRect} />
                )}

                {/* 吸附辅助线容器：由 paintDrag 直接写 innerHTML */}
                {page.id === activePageId && (
                  <svg
                    id={page.id === activePageId ? '__sel_guides' : undefined}
                    width={canvas.width}
                    height={canvas.height}
                    style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 8 }}
                  />
                )}
              </div>
            )
          })}

          {/* 界面级跳转连线：由 flows 推出，覆盖在界面之上 */}
          {edges.length > 0 && (
            <FlowLayer edges={edges} width={overlaySize.width} height={overlaySize.height} />
          )}

          {!pages.length && (
            <div className="empty" style={{ position: 'absolute', left: 0, top: 120, width: 480 }}>
              <div className="empty-icon">◻</div>
              <div className="empty-title">还没有页面</div>
              <div className="empty-desc">用左侧的 AI 生成，或点击「新建」创建空白页</div>
            </div>
          )}
        </div>
      </div>

      {/* 缩略导航图（F-PM-09）：界面一多就不会迷路 */}
      {showMiniMap && pages.length > 1 && (
        <MiniMap
          design={design}
          boxes={boxes}
          canvas={canvas}
          zoom={zoom}
          pan={pan}
          viewport={viewportSize}
          onJump={(world) => {
            /* 让被点的世界坐标落到视口中心 */
            setPan({ x: viewportSize.w / 2 - world.x * zoom, y: viewportSize.h / 2 - world.y * zoom })
          }}
        />
      )}
    </div>
  )
}

/* ============================ 选中框 ============================ */

function SelectionBox({
  nodeId,
  zoom,
  readRect,
}: {
  nodeId: string
  zoom: number
  readRect: (id: string) => Rect | null
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const r = readRect(nodeId)
      if (!r) {
        el.style.display = 'none'
        return
      }
      el.style.display = 'block'
      // 设计坐标：与 paintDrag 保持一致，不再乘 zoom
      el.style.transform = `translate(${r.x}px, ${r.y}px)`
      el.style.width = `${r.w}px`
      el.style.height = `${r.h}px`
    }
    measure()
    // 布局稳定后再量一次（字体加载、图片加载可能导致尺寸变化）
    const t1 = setTimeout(measure, 80)
    const t2 = setTimeout(measure, 300)
    const ro = new ResizeObserver(measure)
    const target = document.querySelector(`[data-id="${CSS.escape(nodeId)}"]`)
    if (target) ro.observe(target)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      ro.disconnect()
    }
  }, [nodeId, zoom, readRect])

  return (
    <div
      id="__sel_overlay"
      ref={ref}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 10 }}
    >
      <div className="sel-ring" />
      {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as Handle[]).map((h) => (
        <span key={h} className={`sel-handle h-${h}`} data-handle={h} />
      ))}
    </div>
  )
}

/* ============================ 工具函数 ============================ */

/** 8px 网格取整 */
function snapRound(v: number): number {
  return Math.max(1, Math.round(v / 8) * 8)
}

/** 在候选值中找最近的（阈值内），返回「元素应落位到哪」与「辅助线画在哪」 */
function nearestBy<T extends { elemAt: number; lineAt: number }>(
  v: number,
  targets: T[],
  threshold: number,
): T | null {
  let best: { t: T; dist: number } | null = null
  for (const t of targets) {
    const dist = Math.abs(v - t.elemAt)
    if (dist <= threshold && (!best || dist < best.dist)) best = { t, dist }
  }
  return best?.t ?? null
}

/** 不可变地替换树中某个节点 */
export function patchNode(root: Node, id: string, fn: (n: Node) => Node): Node {
  if (root.id === id) return fn(root)
  if (!root.children?.length) return root
  let changed = false
  const children = root.children.map((c) => {
    const next = patchNode(c, id, fn)
    if (next !== c) changed = true
    return next
  })
  return changed ? { ...root, children } : root
}

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable
}
