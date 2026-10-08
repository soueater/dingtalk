// src/stores/project.store.ts
// Design JSON 的唯一持有者。所有变更必须经 commit 方法，禁止直接改对象。
import { create } from 'zustand'
import type {
  DesignJSON,
  DesignSpec,
  InterfaceQuota,
  Node,
  Page,
  PageGroup,
  ProjectFile,
} from '@shared/design'
import { DEFAULT_QUOTA, SCHEMA_VERSION } from '@shared/design'
import { createDefaultProject, MOCK_PROJECTS } from '@/services/mock/projects'
import {
  addGroupWithInterfaces,
  appendInterfaces,
  assignToGroup,
  bucketByGroup,
  deleteInterface as deleteInterfacePure,
  duplicateInterfaceAt,
  interfaceStats,
  moveInterface as moveInterfacePure,
  removeGroup as removeGroupPure,
  renameGroup as renameGroupPure,
  renameInterface as renameInterfacePure,
  setGroupCollapsed as setGroupCollapsedPure,
  type GroupBucket,
  type InterfaceStats,
} from '@/services/project/pages'
import {
  canAddInterfaces,
  normalizeQuota,
  resolveQuota,
  type QuotaDecision,
} from '@/services/project/quota'
import { checkInvariants, errorsOf } from '@/services/project/invariants'

interface HistoryEntry {
  label: string
  coalesceKey?: string
  undo: () => DesignJSON
  redo: () => DesignJSON
}

/** 界面数量相关操作的统一返回：把「允不允许」的理由一并带回 UI */
export interface InterfaceOpResult {
  ok: boolean
  decision?: QuotaDecision
  message?: string
}

interface ProjectState {
  /** 当前项目文件路径（未保存过为 null） */
  path: string | null
  /** 设计数据（唯一数据源） */
  design: DesignJSON
  /** 是否有未保存改动 */
  dirty: boolean
  /** 历史栈 */
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]

  /** 当前选中的页面 id */
  activePageId: string
  /** 当前选中的节点 id 集合 */
  selectedIds: string[]

  /* ---- actions ---- */
  newProject: (device?: DesignJSON['meta']['device']) => void
  loadProject: (path: string, project: ProjectFile) => void
  loadMock: (mockId: string) => void
  closeProject: () => void

  /** 事务化提交：mutator 返回新 design，自动入历史栈 */
  commit: (label: string, mutator: (d: DesignJSON) => DesignJSON, opts?: { coalesceKey?: string }) => void

  undo: () => void
  redo: () => void

  setActivePage: (id: string) => void
  select: (ids: string[]) => void
  toggleSelect: (id: string) => void
  clearSelection: () => void

  markSaved: (path: string) => void
  setDesignMeta: (patch: Partial<DesignJSON['meta']>) => void
  renameProject: (name: string) => void

  /* ---- F-ST-01 设计规范 ---- */
  /** 绑定/解绑项目级规范；绑定即整体替换 design.tokens（单次事务，可撤销） */
  bindSpec: (spec: DesignSpec | null) => void
  /** 绑定/解绑某页的规范覆盖 */
  bindPageSpec: (pageId: string, spec: DesignSpec | null) => void
  /** 新增或覆盖一份项目内的自定义规范 */
  upsertSpec: (spec: DesignSpec) => void
  /** 删除项目内的自定义规范（内置规范不可删） */
  removeSpec: (specId: string) => void

  /* ---- F-PM-04/05 界面数量与分组 ---- */
  /** 读取当前项目的有效配额（单点兜底，全 UI 统一从这里取） */
  quota: () => InterfaceQuota
  /** 修改配额（自动做一致性归一化） */
  setQuota: (patch: Partial<InterfaceQuota>) => void
  /** 追加 count 个空白界面；返回配额判定结果供 UI 提示 */
  addInterfaces: (count: number, opts?: { groupId?: string; namePrefix?: string }) => InterfaceOpResult
  /** 复制指定界面（自动重生成全部节点 id） */
  copyInterface: (pageId: string) => InterfaceOpResult
  /** 删除界面；至少保留 1 个，违反时返回失败并说明原因 */
  removeInterface: (pageId: string) => InterfaceOpResult
  renameInterface: (pageId: string, name: string) => void
  moveInterface: (pageId: string, toIndex: number) => void

  addGroup: (name: string, pageIds?: string[]) => void
  renameGroup: (groupId: string, name: string) => void
  removeGroup: (groupId: string) => void
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void
  assignToGroup: (pageIds: string[], groupId: string | undefined) => void

  /** 界面按分组切分（含未分组桶） */
  groupBuckets: () => GroupBucket[]
  /** 界面统计摘要 */
  stats: () => InterfaceStats
  /** 当前数据的不变量问题（供界面顶部警条与保存前校验使用） */
  violations: () => ReturnType<typeof checkInvariants>

  /** 读取当前页 */
  currentPage: () => Page | undefined
  /** 按 id 查找节点 */
  findNode: (id: string, pageId?: string) => { node: Node; parent: Node | null; page: Page } | null
}

const MAX_HISTORY = 100

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export const useProjectStore = create<ProjectState>((set, get) => {
  const initial = createDefaultProject()

  return {
    path: null,
    design: initial,
    dirty: false,
    undoStack: [],
    redoStack: [],
    activePageId: initial.pages[0]?.id ?? '',
    selectedIds: [],

    newProject: (device = 'MOBILE') => {
      const d = createDefaultProject()
      d.meta.device = device
      d.meta.id = `proj_${Date.now().toString(36)}`
      set({
        path: null,
        design: d,
        dirty: false,
        undoStack: [],
        redoStack: [],
        activePageId: d.pages[0]?.id ?? '',
        selectedIds: [],
      })
    },

    loadProject: (path, project) => {
      const d = project.design
      set({
        path,
        design: d,
        dirty: false,
        undoStack: [],
        redoStack: [],
        activePageId: d.pages[0]?.id ?? '',
        selectedIds: [],
      })
    },

    loadMock: (mockId) => {
      const mock = MOCK_PROJECTS.find((m) => m.id === mockId)
      const d = mock ? (JSON.parse(JSON.stringify(mock.design)) as DesignJSON) : createDefaultProject()
      set({
        path: null,
        design: d,
        dirty: true,
        undoStack: [],
        redoStack: [],
        activePageId: d.pages[0]?.id ?? '',
        selectedIds: [],
      })
    },

    closeProject: () => {
      const d = createDefaultProject()
      set({
        path: null,
        design: d,
        dirty: false,
        undoStack: [],
        redoStack: [],
        activePageId: d.pages[0]?.id ?? '',
        selectedIds: [],
      })
    },

    commit: (label, mutator, opts) => {
      const { design, undoStack } = get()
      const before = clone(design)
      const after = mutator(clone(design))
      after.meta.updatedAt = new Date().toISOString()

      // 不变量守卫（F-PM-04）：尽早暴露破坏数据契约的改动。
      // 高频路径（拖拽等带 coalesceKey 的连续操作）跳过，避免热路径开销；
      // 这里只告警不抛出 —— 抛出会让用户的编辑动作直接失败，体验更差。
      if (!opts?.coalesceKey) {
        const errs = errorsOf(checkInvariants(after, { activePageId: get().activePageId }))
        if (errs.length) {
          console.warn(`[invariants] 「${label}」后出现 ${errs.length} 处一致性问题：`, errs)
        }
      }

      // 合并连续同类操作（如拖拽全过程）
      const entry: HistoryEntry = {
        label,
        coalesceKey: opts?.coalesceKey,
        undo: () => before,
        redo: () => after,
      }

      let stack = undoStack
      const top = stack[stack.length - 1]
      if (opts?.coalesceKey && top && top.coalesceKey === opts.coalesceKey) {
        // 合并：保留更早的 undo，更新 redo
        stack = stack.slice(0, -1)
        entry.undo = top.undo
      }
      stack = [...stack, entry]
      if (stack.length > MAX_HISTORY) stack = stack.slice(stack.length - MAX_HISTORY)

      set({
        design: after,
        dirty: true,
        undoStack: stack,
        redoStack: [],
      })
    },

    undo: () => {
      const { undoStack, redoStack } = get()
      if (!undoStack.length) return
      const entry = undoStack[undoStack.length - 1]
      set({
        design: entry.undo(),
        undoStack: undoStack.slice(0, -1),
        redoStack: [...redoStack, entry],
        dirty: true,
      })
    },

    redo: () => {
      const { undoStack, redoStack } = get()
      if (!redoStack.length) return
      const entry = redoStack[redoStack.length - 1]
      set({
        design: entry.redo(),
        undoStack: [...undoStack, entry],
        redoStack: redoStack.slice(0, -1),
        dirty: true,
      })
    },

    setActivePage: (id) => set({ activePageId: id, selectedIds: [] }),
    select: (ids) => set({ selectedIds: ids }),
    toggleSelect: (id) =>
      set((s) => ({
        selectedIds: s.selectedIds.includes(id)
          ? s.selectedIds.filter((x) => x !== id)
          : [...s.selectedIds, id],
      })),
    clearSelection: () => set({ selectedIds: [] }),

    markSaved: (path) => set({ path, dirty: false }),

    setDesignMeta: (patch) =>
      get().commit('修改项目信息', (d) => {
        d.meta = { ...d.meta, ...patch }
        return d
      }),

    renameProject: (name) =>
      get().commit('重命名项目', (d) => {
        d.meta.name = name
        return d
      }),

    /* ---------------------- F-ST-01 设计规范 ---------------------- */

    bindSpec: (spec) =>
      get().commit(
        spec ? `切换设计规范：${spec.name}` : '解除设计规范绑定',
        (d) => {
          if (spec) {
            d.meta.specId = spec.id
            // 切换规范 = 整体替换 Token：节点里存的是 $color.x 引用，会随之整体改写
            d.tokens = JSON.parse(JSON.stringify(spec.tokens)) as DesignJSON['tokens']
            // 自定义规范随项目落盘（内置规范由代码提供，无需写入）
            if (spec.source !== 'builtin' && !(d.specs ?? []).some((s) => s.id === spec.id)) {
              d.specs = [...(d.specs ?? []), JSON.parse(JSON.stringify(spec))]
            }
          } else {
            delete d.meta.specId
          }
          return d
        },
        { coalesceKey: 'switch-spec' },
      ),

    bindPageSpec: (pageId, spec) =>
      get().commit(
        spec ? `页面绑定规范：${spec.name}` : '取消页面规范覆盖',
        (d) => {
          const page = d.pages.find((p) => p.id === pageId)
          if (!page) return d
          if (spec) {
            page.specId = spec.id
            if (spec.source !== 'builtin' && !(d.specs ?? []).some((s) => s.id === spec.id)) {
              d.specs = [...(d.specs ?? []), JSON.parse(JSON.stringify(spec))]
            }
          } else {
            delete page.specId
          }
          return d
        },
        { coalesceKey: `page-spec:${pageId}` },
      ),

    upsertSpec: (spec) =>
      get().commit(`保存规范：${spec.name}`, (d) => {
        const list = [...(d.specs ?? [])]
        const at = list.findIndex((s) => s.id === spec.id)
        if (at >= 0) list[at] = JSON.parse(JSON.stringify(spec))
        else list.push(JSON.parse(JSON.stringify(spec)))
        d.specs = list
        return d
      }),

    removeSpec: (specId) =>
      get().commit('删除规范', (d) => {
        d.specs = (d.specs ?? []).filter((s) => s.id !== specId)
        // 解绑所有引用它的位置，避免留下悬空 id
        if (d.meta.specId === specId) delete d.meta.specId
        d.pages.forEach((p) => {
          if (p.specId === specId) delete p.specId
        })
        return d
      }),

    /* ---------------------- F-PM-04/05 界面数量与分组 ---------------------- */

    quota: () => resolveQuota(get().design.meta),

    setQuota: (patch) => {
      const { design } = get()
      const next = normalizeQuota(patch, resolveQuota(design.meta), design.pages.length)
      get().commit('修改界面配额', (d) => {
        d.meta.quota = next
        return d
      })
    },

    addInterfaces: (count, opts) => {
      const { design } = get()
      const q = resolveQuota(design.meta)
      const decision = canAddInterfaces(design.pages.length, count, q)
      if (!decision.allowed) return { ok: false, decision, message: decision.message }

      get().commit(count > 1 ? `批量新增 ${count} 个界面` : '新增界面', (d) =>
        appendInterfaces(d, count, {
          groupId: opts?.groupId,
          namePrefix: opts?.namePrefix,
          device: d.meta.device,
        }),
      )
      // 选中第一个新界面
      const after = get().design
      const created = after.pages[after.pages.length - count]
      if (created) get().setActivePage(created.id)
      return { ok: true, decision, message: decision.message }
    },

    copyInterface: (pageId) => {
      const { design } = get()
      const q = resolveQuota(design.meta)
      const decision = canAddInterfaces(design.pages.length, 1, q)
      if (!decision.allowed) return { ok: false, decision, message: decision.message }

      if (!design.pages.some((p) => p.id === pageId)) {
        return { ok: false, message: '要复制的界面已不存在。' }
      }
      get().commit('复制界面', (d) => duplicateInterfaceAt(d, pageId))
      const after = get().design
      const created = after.pages[after.pages.length - 1]
      if (created) get().setActivePage(created.id)
      return { ok: true, decision, message: decision.message }
    },

    removeInterface: (pageId) => {
      const { design } = get()
      // 不变量 I-1：项目至少保留 1 个界面
      if (design.pages.length <= 1) {
        return { ok: false, message: '项目至少需要保留 1 个界面，无法删除。' }
      }
      if (!design.pages.some((p) => p.id === pageId)) {
        return { ok: false, message: '要删除的界面已不存在。' }
      }
      get().commit('删除界面', (d) => deleteInterfacePure(d, pageId))
      if (get().activePageId === pageId) {
        const rest = get().design.pages
        if (rest[0]) get().setActivePage(rest[0].id)
      }
      return { ok: true }
    },

    renameInterface: (pageId, name) => {
      const v = name.trim()
      if (!v) return
      get().commit('重命名界面', (d) => renameInterfacePure(d, pageId, v))
    },

    moveInterface: (pageId, toIndex) =>
      get().commit('调整界面顺序', (d) => moveInterfacePure(d, pageId, toIndex)),

    addGroup: (name, pageIds) =>
      get().commit(`新建分组：${name}`, (d) => addGroupWithInterfaces(d, name, pageIds ?? [])),

    renameGroup: (groupId, name) =>
      get().commit('重命名分组', (d) => renameGroupPure(d, groupId, name)),

    removeGroup: (groupId) =>
      get().commit('删除分组', (d) => removeGroupPure(d, groupId)),

    setGroupCollapsed: (groupId, collapsed) =>
      get().commit('折叠分组', (d) => setGroupCollapsedPure(d, groupId, collapsed), {
        coalesceKey: `group-collapse:${groupId}`,
      }),

    assignToGroup: (pageIds, groupId) =>
      get().commit(groupId ? '移入分组' : '移出分组', (d) => assignToGroup(d, pageIds, groupId)),

    groupBuckets: () => bucketByGroup(get().design),
    stats: () => interfaceStats(get().design),
    violations: () => checkInvariants(get().design, { activePageId: get().activePageId }),

    currentPage: () => {
      const { design, activePageId } = get()
      return design.pages.find((p) => p.id === activePageId) ?? design.pages[0]
    },
    findNode: (id, pageId) => {
      const { design, activePageId } = get()
      const page = design.pages.find((p) => p.id === (pageId ?? activePageId))
      if (!page) return null
      let found: { node: Node; parent: Node | null; page: Page } | null = null
      const walk = (n: Node, parent: Node | null) => {
        if (found) return
        if (n.id === id) {
          found = { node: n, parent, page }
          return
        }
        n.children?.forEach((c) => walk(c, n))
      }
      walk(page.root, null)
      return found
    },
  }
})

export function emptyDesign(device: DesignJSON['meta']['device'] = 'MOBILE'): DesignJSON {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: `proj_${Date.now().toString(36)}`,
      name: '未命名项目',
      device,
      canvas: { width: 390, height: 844 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'blank',
      quota: { ...DEFAULT_QUOTA },
    },
    tokens: {},
    assets: [],
    pages: [],
    flows: [],
    pageGroups: [],
  }
}
