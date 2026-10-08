// electron/main/window-manager.ts
// 窗口管理（F-PM-03 多项目并行）：创建、按项目定位、会话保存/恢复。
//
// 为什么把窗口创建从 index.ts 抽出来：
//   `ipc.ts` 需要「在新窗口打开项目」，而 index.ts 又 import 了 ipc.ts ——
//   直接互相引用会形成循环。抽出本模块后，两者都只依赖它，方向单一。
import { app, BrowserWindow, session, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { attachCloseGuard, disposeCloseGuard } from './close-guard'
import { attachCloseProbe } from './close-probe'
import { attachSmokeProbe } from './smoke-probe'
import type { SessionFile } from '../../shared/design'

const DEV_URL = process.env.DEV_SERVER_URL || 'http://localhost:5273'
/**
 * 是否使用开发服务器。
 * 注意：不能用 `!app.isPackaged` 判断——未打包直接运行 dist 产物时它同样为 true，
 * 会错误地去连接并不存在的 Vite 服务。开发模式必须由 dev 脚本显式注入环境变量。
 */
export const useDevServer = process.env.NODE_ENV === 'development' && !!process.env.DEV_SERVER_URL

/** 窗口 → 该项目文件路径（null 表示尚未落盘的新项目） */
const projectOf = new WeakMap<BrowserWindow, string | null>()

let primaryWindow: BrowserWindow | null = null

/**
 * 应用图标。
 * 打包后由 electron-builder 通过 extraResources 放到 resources/icon.png；
 * 开发态回落到仓库里的 build/icon.png。
 *
 * 注意路径层级：本模块被打包到 dist/electron/main/index.js，
 * `__dirname` 已是 .../dist/electron/main，故需要走三级 `..` 才回到 app/ 根。
 * 用 app.getAppPath() 作为首选更稳（它直接指向含 package.json 的应用根）。
 */
export function resolveIconPath(): string | undefined {
  const appRoot = (() => {
    try {
      return app.getAppPath()
    } catch {
      return path.join(__dirname, '../../..')
    }
  })()
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.png'), path.join(process.resourcesPath, 'icon.ico')]
    : [
        path.join(appRoot, 'build', 'icon.png'),
        path.join(appRoot, 'build', 'icon.ico'),
        // 兼容 __dirname 定位（dist/electron/main → 上三级）
        path.join(__dirname, '../../../build/icon.png'),
        path.join(__dirname, '../../../build/icon.ico'),
      ]
  return candidates.find((p) => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  })
}

interface CreateOptions {
  /** 该窗口初始要打开的项目文件；不传则为「未落盘会话」 */
  projectPath?: string
  /** 是否作为主窗口（记录到 primaryWindow，用于 second-instance 聚焦） */
  primary?: boolean
}

export function createWindow(opts: CreateOptions = {}): BrowserWindow {
  const icon = resolveIconPath()
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    title: '望舒',
    backgroundColor: '#0F1115',
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: { color: '#0F1115', symbolColor: '#9AA4B2', height: 48 },
        }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      devTools: true,
      // 把"本窗口要打开哪个项目"传给 preload（渲染层据此决定首屏打开谁）
      additionalArguments: opts.projectPath ? [`--wshu-project=${opts.projectPath}`] : [],
    },
  })

  projectOf.set(win, opts.projectPath ?? null)
  if (opts.primary !== false && !primaryWindow) primaryWindow = win

  win.once('ready-to-show', () => {
    if (icon && process.platform === 'linux') win.setIcon(icon)
    win.show()
  })
  win.on('closed', () => {
    if (primaryWindow === win) primaryWindow = null
  })

  // 关闭守卫：拦截未保存改动的关窗动作，弹「保存并关闭 / 不保存 / 取消」三选项。
  // 同时兜住渲染层可能残留的 beforeunload 取消，避免窗口「关不掉」。
  attachCloseGuard(win)

  // 外链一律交给系统浏览器，窗口内不允许打开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 禁止应用内导航到外部站点
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = useDevServer ? url.startsWith(DEV_URL) : url.startsWith('file://')
    if (!allowed) {
      e.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  if (useDevServer) {
    void win.loadURL(DEV_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../../renderer/index.html'))
  }

  attachSmokeProbe(win)
  attachCloseProbe(win)

  return win
}

/* ------------------------------- 多窗口操作 ------------------------------- */

export function getPrimaryWindow(): BrowserWindow | null {
  return primaryWindow
}

export function projectPathOf(win: BrowserWindow): string | null {
  return projectOf.get(win) ?? null
}

/** 记录/更新某窗口正在编辑的项目（渲染层打开项目后回报） */
export function rememberProject(win: BrowserWindow, projectPath: string | null) {
  projectOf.set(win, projectPath)
}

export function windowsFor(projectPath: string): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((w) => projectOf.get(w) === projectPath)
}

/**
 * 在（新或已存在的）窗口打开项目。
 * 已有一个窗口正在编辑同一项目时直接聚焦它，避免同一项目被两个窗口同时写。
 */
export function openProjectWindow(projectPath: string, opts: { focusExisting?: boolean } = {}) {
  const existed = windowsFor(projectPath)
  if (existed.length && opts.focusExisting !== false) {
    const w = existed[0]
    if (w.isMinimized()) w.restore()
    w.focus()
    return w
  }
  return createWindow({ projectPath, primary: false })
}

/* ------------------------------- 会话保存/恢复 ------------------------------- */

export function snapshotSession(): SessionFile {
  const windows: SessionFile['windows'] = []
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue
    const p = projectOf.get(w)
    if (!p) continue
    // 只记项目路径；「上次停在哪个界面」由渲染层自己的 localStorage 负责，
    // 主进程不去猜渲染态，职责更干净。
    windows.push({ path: p })
  }
  return { version: 1, windows }
}

export function disposeAllWindows() {
  disposeCloseGuard()
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.destroy()
  }
}

/** 开发环境放宽 CSP（Vite HMR 需要 inline script 与 ws）；生产环境以 index.html 的 meta 为准 */
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:5273 http://localhost:5273 https:",
].join('; ')

/**
 * 会话加固：本地客户端不需要任何系统权限；开发态额外放宽 CSP。
 * 所有窗口共享 defaultSession，故只需在应用启动时执行一次。
 */
export function hardenSession() {
  const s = session.defaultSession
  s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  s.setPermissionCheckHandler(() => false)
  if (useDevServer) {
    s.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [DEV_CSP],
        },
      })
    })
  }
}
