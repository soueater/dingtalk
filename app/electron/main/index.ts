// electron/main/index.ts
// 主进程入口：生命周期 / 会话加固 / IPC 注册 / 多窗口会话恢复
import { app, BrowserWindow, nativeTheme } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { registerIpc, abortAllInflight } from './ipc'
import { registerCloseGuardIpc } from './close-guard'
import { sessionStore } from './session-store'
import { appSettingsStore } from './app-settings-store'
import { mcpServer } from './mcp-server'
import {
  createWindow,
  disposeAllWindows,
  getPrimaryWindow,
  hardenSession,
  snapshotSession,
} from './window-manager'

/**
 * 改名兼容：旧版本以「产品设计助手」作为 userData 目录名（含模型配置、最近项目）。
 * 更名「望舒」后，若新目录尚未生成而旧目录存在，则一次性搬迁，避免用户配置丢失。
 * 失败不阻断启动——最坏情况只是需要重新填写模型配置。
 */
function migrateUserDataDir() {
  try {
    const next = app.getPath('userData')
    const prev = path.join(path.dirname(next), '产品设计助手')
    if (next !== prev && !fs.existsSync(next) && fs.existsSync(prev)) {
      fs.renameSync(prev, next)
    }
  } catch {
    /* 忽略：迁移失败仅影响旧配置复用 */
  }
}

// GPU 兼容性兜底：部分虚拟机 / 远程桌面 / 沙箱环境下 GPU 进程无法启动，
// 此时 Chromium 会反复崩溃并最终退出。通过环境变量或命令行开关降级为软件渲染。
if (process.env.DISABLE_GPU === '1' || process.argv.includes('--disable-gpu')) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('disable-software-rasterizer')
  app.commandLine.appendSwitch('no-sandbox')
}

migrateUserDataDir()

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    // 支持「用望舒打开某个 .dsproj」：第二次启动的命令行里带文件路径时，
    // 在新窗口打开它；否则聚焦主窗口。
    const target = argv.find((a) => a.toLowerCase().endsWith('.dsproj'))
    if (target && fs.existsSync(target)) {
      void import('./window-manager').then(({ openProjectWindow }) => openProjectWindow(target))
      return
    }
    const w = getPrimaryWindow()
    if (w) {
      if (w.isMinimized()) w.restore()
      w.focus()
    } else {
      createWindow()
    }
  })

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark'
    hardenSession()
    registerIpc()
    registerCloseGuardIpc()

    // 会话恢复（F-PM-03）：把上次退出时打开的项目窗口逐一还原。
    // 关闭探针 / 冒烟探针属于无人值守测试场景，不参与会话恢复。
    const unattended = !!(process.env.CLOSE_PROBE || process.env.SMOKE_TEST)
    const session = unattended ? { version: 1 as const, windows: [] } : sessionStore.load()

    if (session.windows.length) {
      session.windows.forEach((w) => createWindow({ projectPath: w.path, primary: false }))
      // 保证始终有一个「主窗口」，用于 second-instance 聚焦与无会话时的呈现
      if (!getPrimaryWindow()) createWindow()
    } else {
      createWindow()
    }

    // MCP 开放接口（F-PM-08）：默认关闭，仅当用户在设置里开启后才启动
    if (!unattended && appSettingsStore.get().mcp.enabled) {
      void mcpServer.start().catch(() => {
        /* 启动失败仅记录，不阻断应用 */
      })
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    // 关闭探针（CLOSE_PROBE）需要窗口关闭后继续自查并打印结论，故不自退
    if (process.env.CLOSE_PROBE) return
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    if (!process.env.CLOSE_PROBE && !process.env.SMOKE_TEST) {
      sessionStore.save(snapshotSession())
    }
    void mcpServer.stop()
    abortAllInflight()
    disposeAllWindows()
  })
}
