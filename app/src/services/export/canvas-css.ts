// src/services/export/canvas-css.ts
// 以字符串形式内联 canvas.css，供导出的 HTML 自包含
import raw from '@/styles/canvas.css?raw'

export const CANVAS_CSS = raw
