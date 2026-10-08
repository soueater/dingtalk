// electron/main/png-render.ts
// 用隐藏窗口（Chromium 自身）把页面 HTML 光栅化为 PNG —— 不依赖任何第三方渲染库
import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

export interface PngPage {
  id: string
  name: string
  width: number
  height: number
  /** 完整的、自包含的页面 HTML（含内联样式与内联资源） */
  html: string
}

function wrap(html: string, width: number, height: number, transparent: boolean): string {
  if (/<html[\s>]/i.test(html)) return html
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;${transparent ? 'background:transparent;' : ''}}
  #__png_root{width:${width}px;height:${height}px;overflow:hidden;position:relative}
  *,*::before,*::after{box-sizing:border-box}
  </style></head><body><div id="__png_root">${html}</div></body></html>`
}

async function renderOne(
  page: PngPage,
  scale: number,
  transparent: boolean,
  timeoutMs: number,
): Promise<string> {
  const w = Math.max(1, Math.round(page.width * scale))
  const h = Math.max(1, Math.round(page.height * scale))
  const tmp = path.join(os.tmpdir(), `dsa-png-${crypto.randomUUID()}.html`)

  fs.writeFileSync(tmp, wrap(page.html, page.width, page.height, transparent), 'utf8')

  const win = new BrowserWindow({
    width: w,
    height: h,
    show: false,
    frame: false,
    resizable: false,
    transparent,
    backgroundColor: transparent ? '#00000000' : '#FFFFFF',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      javascript: true,
      images: true,
      devTools: false,
    },
  })

  try {
    await win.loadFile(tmp)
    // 让字体与图片完成一次布局
    await win.webContents.insertCSS(`html,body{zoom:${scale}}`)
    await waitForPaint(win, timeoutMs)
    const image = await win.webContents.capturePage()
    return image.toPNG().toString('base64')
  } finally {
    if (!win.isDestroyed()) win.destroy()
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* 忽略临时文件清理失败 */
    }
  }
}

function waitForPaint(win: BrowserWindow, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    win.webContents.once('did-finish-load', () => {
      // 再等两帧，确保字体度量稳定
      setTimeout(done, 180)
    })
  })
}

/** 批量渲染。任何一页失败只影响该页，不影响其余页面 */
export async function renderPagesToPng(
  pages: PngPage[],
  scale = 2,
  transparent = false,
  timeoutMs = 15000,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const p of pages) {
    try {
      out[p.id] = await renderOne(p, scale, transparent, timeoutMs)
    } catch {
      // 跳过失败页；调用方可对比 pageIds 得到缺失清单
    }
  }
  return out
}
