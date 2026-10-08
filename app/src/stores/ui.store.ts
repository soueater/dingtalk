// src/stores/ui.store.ts —— 瞬时 UI 态（模态、Toast、加载）
import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'warn' | 'error'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
}

export type OverlayKind =
  | null
  | 'settings'
  | 'export'
  | 'preview'
  | 'variants'
  | 'optimize'
  | 'autofill'
  | 'enhancer'
  | 'about'
  | 'help'
  /* F-PM：项目管理相关浮层 */
  | 'create-project'
  | 'project-settings'
  | 'snapshots'
  | 'project-branches'

/** 顶层路由：项目中心（工作台）与编辑器二选一 */
export type Route = 'hub' | 'editor'

interface UiState {
  overlay: OverlayKind
  toasts: Toast[]
  /** 生成中状态 */
  generating: boolean
  generatingStage: string
  generatingProgress: { done: number; total: number }
  /** F-PM-01：当前顶层路由 */
  route: Route
  /** 项目中心要「聚焦」的项目 id（从编辑器返回项目中心时高亮它） */
  hubFocusProjectId: string | null

  openOverlay: (k: OverlayKind) => void
  closeOverlay: () => void
  toast: (kind: ToastKind, message: string) => void
  dismissToast: (id: string) => void
  setGenerating: (v: boolean, stage?: string) => void
  setGeneratingProgress: (done: number, total: number) => void
  setRoute: (r: Route, focusProjectId?: string | null) => void
}

let toastSeq = 0

export const useUiStore = create<UiState>((set) => ({
  overlay: null,
  toasts: [],
  generating: false,
  generatingStage: '',
  generatingProgress: { done: 0, total: 0 },
  route: 'hub',
  hubFocusProjectId: null,

  openOverlay: (k) => set({ overlay: k }),
  closeOverlay: () => set({ overlay: null }),

  toast: (kind, message) => {
    const id = `t${++toastSeq}`
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
    const ttl = kind === 'error' ? 6000 : 3200
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, ttl)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setGenerating: (v, stage) => set({ generating: v, generatingStage: stage ?? '' }),
  setGeneratingProgress: (done, total) => set({ generatingProgress: { done, total } }),

  setRoute: (route, focusProjectId = null) =>
    set({ route, hubFocusProjectId: focusProjectId, overlay: null }),
}))
