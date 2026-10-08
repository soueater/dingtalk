// electron/main/close-guard.ts
// 关闭守卫：把「关窗前是否保存」的决策权从渲染层收归主进程。
//
// 修复前后对比
//   修复前：渲染层 window.beforeunload 里 preventDefault() → 主进程没有监听
//          'will-prevent-unload' → Chromium 默认「尊重渲染层的取消」→ 窗口关不掉、
//          没有任何提示，用户只能强杀进程。
//   修复后：① 主进程在 close 事件里判断有无未保存改动，有则弹原生三选项对话框
//          （保存并关闭 / 不保存 / 取消）；② 无论走哪条路径，都会监听
//          'will-prevent-unload' 并在必要时 preventDefault()，保证窗口永远不会
//          「关不动」；③ 渲染层 beforeunload 退化为纯浏览器调试环境的兜底。
import { dialog, ipcMain, BrowserWindow } from 'electron'
import {
  CLOSE_DIALOG_BUTTONS,
  CLOSE_DIALOG_CANCEL_ID,
  CLOSE_DIALOG_DEFAULT_ID,
  decideClose,
  effectOfChoice,
  mapDialogResponse,
  shouldCloseAfterSave,
} from './close-guard-core'

interface GuardState {
  /** 已确认可以关闭（用户选了「不保存」或「保存并关闭」且保存成功） */
  confirmed: boolean
  /** 渲染层同步过来的未保存标记 */
  dirty: boolean
  /** 对话框是否正在展示 */
  dialogOpen: boolean
}

const state: GuardState = {
  confirmed: false,
  dirty: false,
  dialogOpen: false,
}

/** 渲染层保存完成后的回调（一次性） */
let saveResolver: ((ok: boolean) => void) | null = null

function reset() {
  state.confirmed = false
  state.dialogOpen = false
  saveResolver = null
}

/** 渲染层主动同步未保存标记；窗口重建后由渲染层首次挂载时推动 */
export function setCloseGuardDirty(dirty: boolean) {
  state.dirty = !!dirty
}

export function isCloseGuardDirty(): boolean {
  return state.dirty
}

/** 供测试与调试：读取/重置内部状态 */
export function _closeGuardState(): GuardState {
  return { ...state }
}

export function _resetCloseGuard() {
  state.dirty = false
  reset()
}

/**
 * 注册关闭守卫所需的 IPC 通道。
 * 独立于 ipc.ts 注册，避免「主进程入口 ← ipc.ts」与「ipc.ts → 窗口」的循环依赖。
 */
export function registerCloseGuardIpc() {
  // 渲染层同步 dirty：项目 store 每次变化都会推一次
  ipcMain.handle('app:setDirty', async (_e, dirty: boolean) => {
    setCloseGuardDirty(dirty)
    return { ok: true, data: true }
  })

  // 渲染层回报「保存并关闭」分支的保存结果
  ipcMain.handle('app:closeSaveResult', async (_e, ok: boolean) => {
    saveResolver?.(ok === true)
    saveResolver = null
    return { ok: true, data: true }
  })
}

/**
 * 给窗口挂上关闭守卫。
 * @returns 卸载函数（窗口销毁时由 closed 事件自然回收，这里仅作显式清理）
 */
export function attachCloseGuard(win: BrowserWindow) {
  /** 走完「询问」流程后真正关窗 */
  const closeNow = () => {
    state.confirmed = true
    state.dialogOpen = false
    if (!win.isDestroyed()) win.close()
  }

  const askUser = async () => {
    state.dialogOpen = true
    let response: number | undefined
    try {
      const r = await dialog.showMessageBox(win, {
        type: 'warning',
        title: '望舒',
        message: '当前项目有未保存的改动',
        detail: '关闭窗口前是否保存？',
        buttons: [...CLOSE_DIALOG_BUTTONS],
        defaultId: CLOSE_DIALOG_DEFAULT_ID,
        cancelId: CLOSE_DIALOG_CANCEL_ID,
        noLink: true,
      })
      response = r.response
    } catch {
      // 弹窗失败（窗口已销毁等）→ 按「取消」处理，绝不在未获用户确认时丢改动
      response = CLOSE_DIALOG_CANCEL_ID
    }
    state.dialogOpen = false

    const choice = mapDialogResponse(response)
    const effect = effectOfChoice(choice)

    if (effect === 'close-now') {
      closeNow()
      return
    }
    if (effect === 'stay') return

    // 「保存并关闭」：请渲染层执行一次保存，保存成功才放行
    if (win.isDestroyed()) return
    const saved = await new Promise<boolean>((resolve) => {
      let settled = false
      const timer = setTimeout(() => finish(false), 8000)
      function finish(ok: boolean) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        saveResolver = null
        resolve(ok === true)
      }
      saveResolver = finish
      if (win.isDestroyed()) {
        finish(false)
        return
      }
      win.webContents.send('app:closeSaveRequest')
    })

    if (shouldCloseAfterSave(saved)) closeNow()
  }

  const onClose = (e: Electron.Event) => {
    const decision = decideClose({
      confirmed: state.confirmed,
      dirty: state.dirty,
      dialogOpen: state.dialogOpen,
    })
    if (decision === 'allow') return // 放行，窗口正常关闭
    e.preventDefault()
    if (decision === 'ask') void askUser()
  }

  win.on('close', onClose)

  /**
   * 安全网：渲染层若仍有 beforeunload 取消卸载（例如浏览器调试环境误留），
   * 一律 preventDefault 让卸载继续，避免窗口变回「关不掉」。
   */
  win.webContents.on('will-prevent-unload', (e) => {
    e.preventDefault()
  })

  win.on('closed', () => {
    win.removeListener('close', onClose)
    reset()
  })
}

/** 退出前清理：避免残留的对话框回调悬挂 */
export function disposeCloseGuard() {
  reset()
}
