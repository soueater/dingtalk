// scripts/stub-canvas-css.js
// 导出测试用的样式替身：读取真实的 canvas.css 内容
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const cssPath = path.join(here, '..', 'src', 'styles', 'canvas.css')

export const CANVAS_CSS = fs.readFileSync(cssPath, 'utf8')
