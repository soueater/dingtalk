// src/stores/workspace.store.ts
// 项目中心（F-PM-01/02）的数据来源：项目列表 + 工作区索引 + 检索/排序/筛选状态。
//
// 与 project.store 的分工：
//   project.store     —— 当前正在编辑的**那一个**项目的 Design JSON（唯一数据源）
//   workspace.store   —— **所有**项目的元信息与组织方式（收藏/分组/标签）
// 两者互不 import，避免"打开项目"与"列出项目"互相牵扯。
import { create } from 'zustand'
import type { ProjectMeta, WorkspaceEntry, WorkspaceIndex } from '@shared/design'
import { EMPTY_WORKSPACE } from '@shared/design'

export type HubSort = 'updated' | 'created' | 'name' | 'interfaces'
export type HubView = 'grid' | 'list'
/** 侧栏筛选：全部 / 收藏 / 最近 / 未落盘 / 某分组 / 某标签（前缀 tag:） */
export type HubFilter = string

export interface WorkspaceState {
  projects: ProjectMeta[]
  workspace: WorkspaceIndex
  defaultDir: string
  loading: boolean
  loaded: boolean
  error: string | null

  query: string
  sort: HubSort
  view: HubView
  filter: HubFilter
  /** 当前选中的项目 id（右键菜单 / 详情面板作用于它） */
  selectedId: string | null

  load: () => Promise<void>
  setQuery: (q: string) => void
  setSort: (s: HubSort) => void
  setView: (v: HubView) => void
  setFilter: (f: HubFilter) => void
  select: (id: string | null) => void

  patchEntry: (id: string, patch: Partial<WorkspaceEntry>) => Promise<void>
  forget: (id: string) => Promise<void>
  addGroup: (name: string) => Promise<void>
  renameGroup: (id: string, name: string) => Promise<void>
  removeGroup: (id: string) => Promise<void>
  ensureTag: (tag: string) => Promise<void>

  /** 应用检索 / 排序 / 筛选后的项目集合 */
  visible: () => ProjectMeta[]
}

function hasBridge(): boolean {
  return typeof window !== 'undefined' && !!window.dsa?.project
}

const SORTS: Record<HubSort, (a: ProjectMeta, b: ProjectMeta) => number> = {
  updated: (a, b) => (a.updatedAt < b.updatedAt ? 1 : -1),
  created: (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
  name: (a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'),
  interfaces: (a, b) => b.pageCount - a.pageCount,
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  projects: [],
  workspace: { ...EMPTY_WORKSPACE, entries: {}, groups: [], tags: [] },
  defaultDir: '',
  loading: false,
  loaded: false,
  error: null,

  query: '',
  sort: 'updated',
  view: 'grid',
  filter: 'all',
  selectedId: null,

  load: async () => {
    if (!hasBridge()) {
      // 浏览器调试环境：没有文件系统，给出空列表而不是报错
      set({ loaded: true, projects: [], error: null })
      return
    }
    set({ loading: true, error: null })
    try {
      const r = await window.dsa.project.list()
      if (r.ok) {
        set({
          projects: r.data.projects,
          workspace: r.data.workspace,
          defaultDir: r.data.defaultDir,
          loaded: true,
        })
      } else {
        set({ error: r.message, loaded: true })
      }
    } catch (e) {
      set({ error: (e as Error)?.message ?? '读取项目列表失败', loaded: true })
    } finally {
      set({ loading: false })
    }
  },

  setQuery: (query) => set({ query }),
  setSort: (sort) => set({ sort }),
  setView: (view) => set({ view }),
  setFilter: (filter) => set({ filter }),
  select: (selectedId) => set({ selectedId }),

  patchEntry: async (id, patch) => {
    if (!hasBridge()) return
    const r = await window.dsa.workspace.patchEntry(id, patch)
    if (r.ok) set({ workspace: r.data })
  },

  forget: async (id) => {
    if (!hasBridge()) return
    const r = await window.dsa.workspace.forget(id)
    if (r.ok) {
      set({ workspace: r.data, projects: get().projects.filter((p) => p.id !== id) })
    }
  },

  addGroup: async (name) => {
    if (!hasBridge()) return
    const r = await window.dsa.workspace.addGroup(name)
    if (r.ok) set({ workspace: r.data })
  },

  renameGroup: async (id, name) => {
    if (!hasBridge()) return
    const r = await window.dsa.workspace.renameGroup(id, name)
    if (r.ok) set({ workspace: r.data })
  },

  removeGroup: async (id) => {
    if (!hasBridge()) return
    const r = await window.dsa.workspace.removeGroup(id)
    if (r.ok) {
      set({
        workspace: r.data,
        filter: get().filter === id ? 'all' : get().filter,
      })
    }
  },

  ensureTag: async (tag) => {
    if (!hasBridge()) return
    const r = await window.dsa.workspace.ensureTag(tag)
    if (r.ok) set({ workspace: r.data })
  },

  visible: () => {
    const { projects, query, sort, filter } = get()
    const q = query.trim().toLowerCase()
    let list = projects.filter((p) => {
      // 已归档默认不展示，除非正在筛选收藏（便于找回）
      if (p.workspace?.archived && filter !== 'archived') return false
      if (q && !p.name.toLowerCase().includes(q) && !p.path.toLowerCase().includes(q)) return false
      switch (filter) {
        case 'all':
          return true
        case 'favorite':
          return !!p.workspace?.favorite
        case 'recent':
          return !!p.workspace?.lastOpenedAt
        case 'unsaved':
          return !p.path
        case 'archived':
          return !!p.workspace?.archived
        default:
          if (filter.startsWith('tag:')) return (p.workspace?.tags ?? []).includes(filter.slice(4))
          return p.workspace?.groupId === filter
      }
    })
    list = [...list].sort((a, b) => {
      // 置顶优先于排序规则
      const pa = a.workspace?.pinned ? 1 : 0
      const pb = b.workspace?.pinned ? 1 : 0
      if (pa !== pb) return pb - pa
      return SORTS[sort](a, b)
    })
    return list
  },
}))
