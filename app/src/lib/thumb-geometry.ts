// src/lib/thumb-geometry.ts
// 变体缩略图的尺寸计算 —— 纯函数，便于单测覆盖极端窗口宽度。
//
// 背景：原实现写在 VariantModal 内联表达式里，
//   const thumbW = Math.min(300, Math.floor((Math.min(1100, innerWidth - 200) - (cols-1)*20 - 48) / cols))
// 当窗口较窄（innerWidth 偏小）且变体数量较多时，分子会变成负数，
// 于是 thumbW / thumbH 为负、transform: scale(负数) 让预览整体翻转，
// 呈现为「点开变体对话框后一片空白/错位」。这里补下限并集中计算。

export interface ThumbGeometry {
  /** 单个缩略图宽度（px） */
  width: number
  /** 单个缩略图高度（px） */
  height: number
  /** 缩放比 = 缩略图宽 / 画布宽 */
  scale: number
}

export const THUMB_MIN_W = 96
export const THUMB_MAX_W = 300
/** 缩略图之间的水平间距（与容器 gap 保持一致） */
export const THUMB_GAP = 20
/** 对话框左右内边距 + 滚动条预留 */
export const THUMB_CHROME = 48

/**
 * 计算缩略图几何。
 * @param cols 列数（基线 + 变体数量），至少按 1 处理
 * @param viewportW 视口宽度
 * @param canvasW 画布宽度
 * @param canvasH 画布高度
 */
export function computeThumbGeometry(
  cols: number,
  viewportW: number,
  canvasW: number,
  canvasH: number,
): ThumbGeometry {
  const safeCols = Number.isFinite(cols) && cols >= 1 ? Math.floor(cols) : 1
  const vw = Number.isFinite(viewportW) && viewportW > 0 ? viewportW : 1280
  const w = Number.isFinite(canvasW) && canvasW > 0 ? canvasW : 390
  const h = Number.isFinite(canvasH) && canvasH > 0 ? canvasH : 844

  // 可用宽度：对话框本身也被限制在 1100 以内
  const avail = Math.min(1100, Math.max(360, vw - 200)) - (safeCols - 1) * THUMB_GAP - THUMB_CHROME
  const raw = Math.floor(avail / safeCols)
  const width = Math.max(THUMB_MIN_W, Math.min(THUMB_MAX_W, raw))
  const scale = width / w
  return { width, height: Math.round(h * scale), scale }
}
