// src/lib/canvas-layout.ts —— 画布上「界面摆放」的唯一计算口径（F-PM-09）
//
// 为什么必须收口到一处：
//   画布渲染、分组框、流程连线、缩略导航图、一键排布 —— 五处都要知道"第 i 个界面在哪"。
//   任何一处自己算，都会在改间距/加换行时出现"框和内容错位"。
import type { Page } from '@shared/design'

/* 间距常量复用 shared/interfaces 里那一份，避免"数据层一个值、画布另一个值" */
export { PAGE_GAP_X } from '@shared/interfaces'
import { PAGE_GAP_X } from '@shared/interfaces'

/** 界面之间的垂直间距（横向间距见 PAGE_GAP_X） */
export const PAGE_GAP_Y = 56
/** 每行最多摆几个界面（与画布宽度无关，纯粹为了可读性） */
export const PAGES_PER_ROW = 6

export interface PageBox {
  id: string
  /** 该界面在 pages 数组中的序号 */
  index: number
  x: number
  y: number
  w: number
  h: number
}

export interface CanvasSize {
  width: number
  height: number
}

/**
 * 计算全部界面的位置：按行铺开，每行 PAGES_PER_ROW 个，行内左对齐。
 * 注意：**忽略 page.pos**。原因是 pos 是"上一次拖拽留下的痕迹"，
 * 一旦引入就会在设备切换、批量新增后出现大量重叠与空洞；
 * 对齐交给显式的「一键排布」，而不是隐式的残留数据。
 */
export function layoutPages(pages: Page[], canvas: CanvasSize, perRow = PAGES_PER_ROW): PageBox[] {
  const strideX = canvas.width + PAGE_GAP_X
  const strideY = canvas.height + PAGE_GAP_Y
  return pages.map((p, index) => {
    const col = index % perRow
    const row = Math.floor(index / perRow)
    return {
      id: p.id,
      index,
      x: col * strideX,
      y: row * strideY,
      w: canvas.width,
      h: canvas.height,
    }
  })
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 一组矩形的并集外框 */
export function boundsOf(boxes: Rect[]): Rect | null {
  if (!boxes.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const b of boxes) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** 外扩 */
export function inflate(r: Rect, dx: number, dy = dx): Rect {
  return { x: r.x - dx, y: r.y - dy, w: r.w + dx * 2, h: r.h + dy * 2 }
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/**
 * 一键排布：把同分组的界面排到一起（组内保持原有相对顺序）。
 *
 * 「排布」不只是把网格摆整齐 —— 真正的痛点是**同组界面被其它组的界面隔开**，
 * 导致分组框没法画、眼睛要来回跳。所以这里做的是"按分组重排顺序"，
 * 几何位置交给 layoutPages。
 */
export function tidyOrder(pages: Page[], groupOrder?: string[]): string[] {
  const rank = new Map<string, number>()
  ;(groupOrder ?? []).forEach((g, i) => rank.set(g, i))

  const withRank = pages.map((p, i) => ({ p, i, g: p.groupId ?? null }))
  withRank.sort((a, b) => {
    const ra = a.g ? (rank.get(a.g) ?? 999) : 1000
    const rb = b.g ? (rank.get(b.g) ?? 999) : 1000
    if (ra !== rb) return ra - rb
    return a.i - b.i
  })
  return withRank.map((w) => w.p.id)
}

/** 计算适配视口所需的缩放与平移 */
export function fitTransform(
  content: Rect | null,
  viewport: { w: number; h: number },
  padding = 48,
  minZoom = 0.1,
  maxZoom = 2,
): { zoom: number; pan: { x: number; y: number } } {
  if (!content || content.w <= 0 || content.h <= 0) {
    return { zoom: 1, pan: { x: 60, y: 60 } }
  }
  const sx = (viewport.w - padding * 2) / content.w
  const sy = (viewport.h - padding * 2) / content.h
  const zoom = Math.max(minZoom, Math.min(maxZoom, Math.min(sx, sy)))
  const pan = {
    x: (viewport.w - content.w * zoom) / 2 - content.x * zoom,
    y: (viewport.h - content.h * zoom) / 2 - content.y * zoom,
  }
  return { zoom, pan }
}
