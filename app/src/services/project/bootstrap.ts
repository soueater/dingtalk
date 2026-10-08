// src/services/project/bootstrap.ts
// 首启引导（F-PM-01/03）：
//   1) 载入模型配置；
//   2) 若本窗口被要求打开某个项目（多窗口会话恢复 / 「用望舒打开」），直接进编辑器；
//   3) 否则进入**项目中心**（启动默认页）；
//   4) 浏览器调试环境降级为示例项目。
//
// 与旧实现的变化：不再"无条件自动打开最近一个项目"。项目中心成为默认入口后，
// 用户一进来就能看到自己有哪些项目，而不是被塞进上次那个。
import { useProjectStore } from '@/stores/project.store'
import { useConfigStore } from '@/stores/config.store'
import { useUiStore } from '@/stores/ui.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { MOCK_PROJECTS } from '@/services/mock/projects'

const FIRST_RUN_KEY = 'dsa.firstRunDone'
const LAST_PROJECT_KEY = 'dsa.lastProject'

const hasBridge = () => typeof window !== 'undefined' && !!window.dsa?.project

export async function bootstrapApp(): Promise<void> {
  const toast = useUiStore.getState().toast
  const cfgStore = useConfigStore.getState()

  /* 1) 载入配置 */
  try {
    await cfgStore.load()
  } catch {
    toast('warn', '读取模型配置失败，可稍后在设置中重新配置')
  }

  // 热重载时 store 里已有内容，不再重复引导
  if (useProjectStore.getState().design.pages.length > 0) return

  if (!hasBridge()) {
    // 浏览器调试：没有文件系统，退回示例项目直接进编辑器
    const mock = MOCK_PROJECTS[0]
    useProjectStore
      .getState()
      .loadProject('', { fileVersion: '1.0', design: JSON.parse(JSON.stringify(mock.design)) })
    useProjectStore.setState({ dirty: true })
    useUiStore.getState().setRoute('editor')
    return
  }

  /* 2) 本窗口被指定了项目（多窗口 / 从文件管理器打开） */
  const initial = window.dsa?.app?.initialProject ?? null
  if (initial) {
    const okOpened = await openAndEnter(initial, toast)
    if (okOpened) return
  }

  /* 3) 默认进入项目中心 */
  await useWorkspaceStore.getState().load()
  useUiStore.getState().setRoute('hub')

  if (!safeGet(FIRST_RUN_KEY)) {
    safeSet(FIRST_RUN_KEY, '1')
    setTimeout(() => {
      if (!useConfigStore.getState().current()) {
        toast('info', '配置模型后即可用 AI 生成界面；也可以先从模板开始')
      }
    }, 900)
  }
}

/** 打开指定项目并切到编辑器；失败返回 false */
async function openAndEnter(path: string, toast: (k: 'info' | 'warn' | 'error', m: string) => void): Promise<boolean> {
  try {
    const r = await window.dsa.project.open(path)
    if (!r.ok) {
      toast('warn', `打开项目失败：${r.message}`)
      return false
    }
    const store = useProjectStore.getState()
    store.loadProject(r.data.path, r.data.project)
    useProjectStore.setState({ dirty: false })
    safeSet(LAST_PROJECT_KEY, r.data.path)
    void window.dsa.win.setProject(r.data.path)
    useUiStore.getState().setRoute('editor')

    // 崩溃恢复：若存在比项目文件更新的自动快照，询问是否恢复
    void maybeOfferRecovery(r.data.project.design.meta.id, r.data.project.design.meta.updatedAt)
    return true
  } catch (e) {
    toast('warn', `打开项目失败：${(e as Error)?.message ?? e}`)
    return false
  }
}

/**
 * 崩溃恢复提示。
 * 只在「快照确实比项目文件新」时才问 —— 否则每次打开项目都弹一次会很烦。
 */
async function maybeOfferRecovery(projectId: string, updatedAt: string): Promise<void> {
  try {
    if (!window.dsa?.snapshot) return
    const r = await window.dsa.snapshot.readAuto(projectId, updatedAt)
    if (!r.ok || !r.data) return
    const auto = r.data
    const pages = auto.design.pages.length
    const okRestore = window.confirm(
      `检测到上次退出时「${auto.design.meta.name}」有未保存的更改（${pages} 个界面）。\n\n` +
        `是否恢复这些更改？\n（选择「取消」将丢弃，继续使用磁盘上的版本）`,
    )
    if (okRestore) {
      useProjectStore.getState().loadProject('', auto)
      useProjectStore.setState({ dirty: true })
      useUiStore.getState().toast('success', '已恢复未保存的更改，记得保存')
    } else {
      await window.dsa.snapshot.clearAuto(projectId)
    }
  } catch {
    /* 恢复提示失败不阻断流程 */
  }
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* file:// 下可能不可用 */
  }
}
