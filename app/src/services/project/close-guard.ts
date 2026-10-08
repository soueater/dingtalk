// src/services/project/close-guard.ts
// 渲染层「关闭守卫」协调器。
//
// 职责边界：
//   决策（要不要弹框 / 弹框结果怎么解释）在主进程 electron/main/close-guard.ts；
//   渲染层只做两件事：① 把 store 的 dirty 同步给主进程；② 主进程要求保存时执行保存并回报结果。
//
// 这样关窗链路不再依赖 window.beforeunload —— 后者在 Electron 里语义不对：
// 渲染层取消卸载后若主进程没有 will-prevent-unload 监听，窗口会彻底关不掉。
import { useProjectStore } from '@/stores/project.store'
import { saveProject } from '@/services/project/actions'

const hasBridge = () => typeof window !== 'undefined' && !!window.dsa?.app

/** 保存请求并发保护：同一时刻只处理一次保存 */
let saving = false

/**
 * 启动关闭守卫，返回卸载函数。
 * 在 App 挂载时调用一次即可。
 */
export function installCloseGuard(): () => void {
  const bridge = hasBridge() ? window.dsa.app : null
  if (!bridge) {
    // 纯浏览器调试环境：没有主进程，退回原生 confirm 兜底
    return installBrowserFallback()
  }

  // 1) 首次同步 + 后续变化同步。zustand 的 subscribe 返回卸载函数。
  const push = (dirty: boolean) => {
    void bridge.setDirty?.(dirty)
  }
  push(useProjectStore.getState().dirty)
  const unsubStore = useProjectStore.subscribe((s) => push(s.dirty))

  // 2) 主进程请求保存 → 执行保存 → 回报结果
  const unsubSave = bridge.onCloseSaveRequest?.(() => {
    if (saving) return
    saving = true
    void (async () => {
      let ok = false
      try {
        ok = await saveProject()
      } catch {
        ok = false
      } finally {
        saving = false
      }
      // 保存成功后 store.dirty 已置 false，再补一次同步，避免主进程拿到旧标记
      void bridge.setDirty?.(useProjectStore.getState().dirty)
      void bridge.reportCloseSaveResult?.(ok)
    })()
  })

  return () => {
    unsubStore()
    unsubSave?.()
  }
}

/**
 * 浏览器调试环境兜底：用原生 confirm 拦截刷新/关闭。
 * 桌面客户端下不再启用，因此不会复现「窗口关不掉」。
 */
function installBrowserFallback(): () => void {
  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (!useProjectStore.getState().dirty) return
    e.preventDefault()
    e.returnValue = ''
  }
  window.addEventListener('beforeunload', beforeUnload)
  return () => window.removeEventListener('beforeunload', beforeUnload)
}

/**
 * 关闭前的整体清理（当前仅释放保存中的标记）。
 * 预留给后续「退出前取消网络请求」等需求。
 */
export function disposeCloseGuard() {
  saving = false
}
