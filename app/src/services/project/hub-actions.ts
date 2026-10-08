// src/services/project/hub-actions.ts
// 项目中心（F-PM-01/02/03）的全部动作：创建 / 打开 / 复制 / 删除 / 组织 / 快照 / 自动保存。
//
// 分层：本文件是「面向 UI 的编排层」——
//   数据变换  →  shared/interfaces.ts（纯函数）
//   持久化    →  主进程 IPC
//   提示与确认 →  ui.store 的 toast / window.confirm
import type { DesignJSON, DesignSpec, Device, InterfaceQuota, ProjectFile, ProjectMeta } from '@shared/design'
import { DEFAULT_QUOTA, FILE_VERSION } from '@shared/design'
import {
  appendInterfaces,
  blankInterface,
  canvasOf,
  createPageGroup,
  PAGE_GAP_X,
} from '@shared/interfaces'
import { normalizeQuota, resolveQuota } from '@/services/project/quota'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { ApiError } from '@/services/config'
import { buildTemplatePageNodes, findTemplate } from '@/services/design/interface-templates'
import type { PageProposal } from '@/services/project/interface-sources'
import { refreshThumbnailAfterSave } from '@/services/project/thumbnail'

const LAST_PROJECT_KEY = 'dsa.lastProject'

const hasBridge = () => typeof window !== 'undefined' && !!window.dsa?.project

function unwrap<T>(r: { ok: true; data: T } | { ok: false; code: string; message: string; detail?: string }): T {
  if (r.ok) return r.data
  throw new ApiError(r.code, r.message, r.detail)
}

function setLastProject(path: string | null) {
  try {
    if (path) localStorage.setItem(LAST_PROJECT_KEY, path)
    else localStorage.removeItem(LAST_PROJECT_KEY)
  } catch {
    /* 忽略 */
  }
}

export function lastProjectPath(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY)
  } catch {
    return null
  }
}

/* --------------------------------- 进入编辑器 --------------------------------- */

/** 返回项目中心。先补一次自动保存，避免未落盘的改动丢失。 */
export async function goHub(): Promise<void> {
  await autoSaveOnce()
  const path = useProjectStore.getState().path
  useUiStore.getState().setRoute('hub', useProjectStore.getState().design.meta.id)
  void window.dsa?.win.setProject(null)
  void path
}

export async function enterEditor(path: string | null, project: ProjectFile): Promise<void> {
  const store = useProjectStore.getState()
  store.loadProject(path ?? '', project)
  useProjectStore.setState({ dirty: false })
  setLastProject(path)
  void window.dsa?.win.setProject(path)
  useUiStore.getState().setRoute('editor')
}

/** 从项目中心打开某个项目（若已在本窗口打开则直接进入，避免重复读盘） */
export async function openProjectFromHub(meta: ProjectMeta): Promise<void> {
  const cur = useProjectStore.getState()
  if (cur.path && meta.path && cur.path === meta.path) {
    useUiStore.getState().setRoute('editor')
    return
  }
  if (!meta.path) {
    // 索引里的占位（源文件已不存在）
    useUiStore.getState().toast('error', `「${meta.name}」的文件已不存在，请先移除该记录`)
    return
  }
  if (!hasBridge()) {
    useUiStore.getState().toast('error', '文件系统仅在桌面客户端中可用')
    return
  }
  try {
    const r = unwrap(await window.dsa.project.open(meta.path))
    await enterEditor(r.path, r.project)
  } catch (e) {
    useUiStore.getState().toast('error', e instanceof ApiError ? e.message : '打开项目失败')
  }
}

/** 在新窗口打开（F-PM-03）：大项目并行时互不阻塞，且崩溃隔离 */
export async function openProjectInNewWindow(path: string): Promise<void> {
  if (!hasBridge()) return
  try {
    await window.dsa.win.openProject(path)
    useUiStore.getState().toast('info', '已在新窗口打开')
  } catch (e) {
    useUiStore.getState().toast('error', e instanceof ApiError ? e.message : '打开新窗口失败')
  }
}

/* ---------------------------------- 创建 ---------------------------------- */

export type CreateSource = 'blank' | 'template' | 'import' | 'ai'

export interface CreateProjectOptions {
  name: string
  device: Device
  source: CreateSource
  /** 计划界面数 N */
  planned: number
  softLimit?: number
  hardLimit?: number
  strategy?: InterfaceQuota['strategy']
  /** 绑定的规范（内置 id 或自定义 spec 对象） */
  spec?: DesignSpec | null
  /** 模板来源 */
  templateId?: string
  /** 预置的界面提案（模板 / HTML 导入产出的骨架） */
  proposals?: PageProposal[]
  /** AI 生成的需求描述；有值时创建后进入编辑器由用户点「生成」 */
  prompt?: string
}

/**
 * 创建项目并落盘到默认目录。
 *
 * 落盘策略（与设计文档 §3.1 一致）：**创建即落盘**。
 * 理由是"用户点了创建却什么都没生成"的挫败感远大于"多了一个文件"。
 * 只有 AI 生成路径在创建后仍可能失败，所以它的落盘放在生成成功之后由调用方决定。
 */
export async function createProject(opts: CreateProjectOptions): Promise<string | null> {
  const ui = useUiStore.getState()
  if (!hasBridge()) {
    ui.toast('error', '文件系统仅在桌面客户端中可用')
    return null
  }

  const quota = normalizeQuota(
    {
      planned: opts.planned,
      softLimit: opts.softLimit ?? DEFAULT_QUOTA.softLimit,
      hardLimit: opts.hardLimit ?? DEFAULT_QUOTA.hardLimit,
      strategy: opts.strategy ?? 'single',
    },
    { ...DEFAULT_QUOTA },
    1,
  )

  const canvas = canvasOf(opts.device)
  const now = new Date().toISOString()
  const design: DesignJSON = {
    schemaVersion: '1.2',
    meta: {
      id: `proj_${Date.now().toString(36)}`,
      name: opts.name.trim() || '未命名项目',
      device: opts.device,
      canvas: { width: canvas.width, height: canvas.height },
      createdAt: now,
      updatedAt: now,
      source: opts.source === 'ai' ? 'ai' : opts.source === 'import' ? 'import' : 'blank',
      quota,
      ...(opts.prompt ? { prompt: opts.prompt } : {}),
    },
    tokens: {},
    assets: [],
    pages: [],
    flows: [],
    pageGroups: [],
  }

  // 规范：内置/自定义都写进项目，保证换机器后风格一致
  if (opts.spec) {
    design.meta.specId = opts.spec.id
    design.tokens = JSON.parse(JSON.stringify(opts.spec.tokens))
    if (opts.spec.source !== 'builtin') design.specs = [JSON.parse(JSON.stringify(opts.spec))]
  }

  // 界面骨架：优先用提案，其次按 planned 造空白界面
  const proposals = opts.proposals ?? proposalsFromTemplate(opts.templateId, opts.planned)
  if (proposals?.length) {
    let designWithPages = design
    const groupNames = [...new Set(proposals.map((p) => p.groupName).filter((x): x is string => !!x))]
    const groups = groupNames.map((n, i) => createPageGroup(n, i))
    designWithPages.pageGroups = groups
    let idx = 0
    for (const p of proposals) {
      const page = blankInterface(opts.device, idx, {
        x: idx * (canvas.width + PAGE_GAP_X),
        y: 0,
      })
      page.name = p.name
      if (p.root) page.root = p.root
      const g = p.groupName ? groups.find((x) => x.name === p.groupName) : undefined
      if (g) page.groupId = g.id
      designWithPages.pages = [...designWithPages.pages, page]
      idx += 1
    }
    design.pages = designWithPages.pages
    design.pageGroups = designWithPages.pageGroups
  } else {
    const count = Math.max(1, quota.planned)
    const filled = appendInterfaces(design, count, { device: opts.device })
    design.pages = filled.pages
  }

  try {
    const r = unwrap(
      await window.dsa.project.create(design.meta.name, { fileVersion: FILE_VERSION, design }),
    )
    await useWorkspaceStore.getState().load()
    await enterEditor(r.path, { fileVersion: FILE_VERSION, design })
    ui.toast('success', `已创建项目「${design.meta.name}」`)
    // 异步补一张缩略图，不阻塞进入编辑器
    refreshThumbnailAfterSave(design.meta.id, design)
    return r.path
  } catch (e) {
    ui.toast('error', e instanceof ApiError ? e.message : '创建项目失败')
    return null
  }
}

function proposalsFromTemplate(templateId: string | undefined, planned: number): PageProposal[] | undefined {
  if (!templateId) return undefined
  const tpl = findTemplate(templateId)
  if (!tpl) return undefined
  // 模板页数超过计划数时截断；不足时不补（模板本身就是明确的结构）
  const pages = tpl.pages.slice(0, Math.max(1, planned))
  return pages.map((p) => ({
    name: p.name,
    root: buildTemplatePageNodes(p.blocks),
    groupName: tpl.groupName,
  }))
}

/** 打开系统文件对话框导入 .dsproj 并进入编辑器 */
export async function importProjectFromDialog(): Promise<void> {
  if (!hasBridge()) return
  try {
    const r = unwrap(await window.dsa.project.openByDialog())
    if (!r) return
    await useWorkspaceStore.getState().load()
    await enterEditor(r.path, r.project)
    useUiStore.getState().toast('success', `已打开「${r.project.design.meta.name}」`)
  } catch (e) {
    useUiStore.getState().toast('error', e instanceof ApiError ? e.message : '打开失败')
  }
}

/* ---------------------------------- 管理 ---------------------------------- */

export async function duplicateProject(meta: ProjectMeta): Promise<void> {
  if (!hasBridge() || !meta.path) return
  try {
    const r = unwrap(await window.dsa.project.duplicate(meta.path))
    await useWorkspaceStore.getState().load()
    useUiStore.getState().toast('success', `已创建副本：${r.meta?.name ?? '副本'}`)
  } catch (e) {
    useUiStore.getState().toast('error', e instanceof ApiError ? e.message : '复制失败')
  }
}

/**
 * 删除项目。
 * 走系统回收站（可恢复），并在确认对话框里明确说明这一点 ——
 * 用户知道"能找回来"，才敢放心清理。
 */
export async function deleteProject(meta: ProjectMeta): Promise<void> {
  if (!hasBridge()) return
  if (!meta.path) {
    // 已失效的占位记录：只从工作区索引里移除
    await useWorkspaceStore.getState().forget(meta.id)
    return
  }
  const okDelete = window.confirm(
    `确定删除项目「${meta.name}」？\n\n` +
      `文件：${meta.path}\n` +
      `共 ${meta.pageCount} 个界面。\n\n` +
      `文件会被移入系统回收站（可恢复），不会立即永久删除。`,
  )
  if (!okDelete) return
  try {
    unwrap(await window.dsa.project.remove(meta.path, true, meta.id))
    const store = useProjectStore.getState()
    if (store.path === meta.path) {
      store.closeProject()
    }
    await useWorkspaceStore.getState().load()
    useUiStore.getState().toast('success', `已删除「${meta.name}」（可在回收站找回）`)
  } catch (e) {
    useUiStore.getState().toast('error', e instanceof ApiError ? e.message : '删除失败')
  }
}

export async function forgetProject(meta: ProjectMeta): Promise<void> {
  await useWorkspaceStore.getState().forget(meta.id)
  useUiStore.getState().toast('info', `已从列表移除「${meta.name}」（文件仍在原处）`)
}

export async function revealProject(path: string): Promise<void> {
  if (!hasBridge() || !path) return
  try {
    await window.dsa.project.revealInFolder(path)
  } catch {
    useUiStore.getState().toast('error', '无法打开所在文件夹')
  }
}

/* --------------------------------- 组织操作 --------------------------------- */

export async function toggleFavorite(meta: ProjectMeta): Promise<void> {
  await useWorkspaceStore.getState().patchEntry(meta.id, {
    favorite: !meta.workspace?.favorite,
    name: meta.name,
  })
}

export async function togglePinned(meta: ProjectMeta): Promise<void> {
  await useWorkspaceStore.getState().patchEntry(meta.id, {
    pinned: !meta.workspace?.pinned,
    name: meta.name,
  })
}

export async function setArchived(meta: ProjectMeta, archived: boolean): Promise<void> {
  await useWorkspaceStore.getState().patchEntry(meta.id, { archived, name: meta.name })
  useUiStore.getState().toast('info', archived ? `已归档「${meta.name}」` : `已取消归档「${meta.name}」`)
}

export async function moveToGroup(meta: ProjectMeta, groupId: string | undefined): Promise<void> {
  await useWorkspaceStore.getState().patchEntry(meta.id, { groupId, name: meta.name })
}

export async function setProjectTags(meta: ProjectMeta, tags: string[]): Promise<void> {
  const list = [...new Set(tags.map((t) => t.trim()).filter(Boolean))]
  await useWorkspaceStore.getState().patchEntry(meta.id, { tags: list, name: meta.name })
  for (const t of list) await useWorkspaceStore.getState().ensureTag(t)
}

export async function renameProjectRecord(meta: ProjectMeta, name: string): Promise<void> {
  const v = name.trim()
  if (!v) return
  await useWorkspaceStore.getState().patchEntry(meta.id, { name: v })
}

/* ---------------------------------- 快照 ---------------------------------- */

export async function listSnapshots(projectId: string) {
  if (!hasBridge()) return []
  try {
    const r = await window.dsa.snapshot.list(projectId)
    return r.ok ? r.data : []
  } catch {
    return []
  }
}

export async function createSnapshot(projectId: string, design: DesignJSON, name: string) {
  if (!hasBridge()) return null
  try {
    const r = await window.dsa.snapshot.create(projectId, design, name)
    if (r.ok && r.data) useUiStore.getState().toast('success', '已创建快照')
    else useUiStore.getState().toast('error', '创建快照失败')
    return r.ok ? r.data : null
  } catch {
    useUiStore.getState().toast('error', '创建快照失败')
    return null
  }
}

/** 恢复快照：把当前内容开成「未保存状态」，用户可撤销 / 另存，不会直接覆盖磁盘 */
export async function restoreSnapshot(projectId: string, snapshotId: string, label: string) {
  if (!hasBridge()) return
  try {
    const r = await window.dsa.snapshot.read(projectId, snapshotId)
    if (!r.ok || !r.data) {
      useUiStore.getState().toast('error', '快照已损坏或不存在')
      return
    }
    if (!window.confirm(`恢复到「${label}」？\n\n当前未保存的改动会被替换（可用 Ctrl+Z 撤销）。`)) return
    const st = useProjectStore.getState()
    st.loadProject(st.path ?? '', r.data)
    useProjectStore.setState({ dirty: true })
    useUiStore.getState().toast('success', '已恢复快照，记得保存')
  } catch {
    useUiStore.getState().toast('error', '恢复快照失败')
  }
}

/* -------------------------------- 自动保存 -------------------------------- */

/**
 * 自动保存（F-PM-03）。
 *
 * 规则：
 *   · 只有**已绑定磁盘路径**的项目才自动保存（未落盘项目自动保存会突然弹对话框）；
 *   · 防抖由调用方（App）用一个定时器实现，这里只做单次落盘；
 *   · 落盘前先写一份自动快照，保证「写坏了还能捞回来」。
 */
let saving = false

export async function autoSaveOnce(): Promise<void> {
  const { path, design, dirty, markSaved } = useProjectStore.getState()
  if (!path || !dirty || saving) return
  saving = true
  try {
    if (window.dsa?.snapshot) {
      await window.dsa.snapshot.writeAuto(design.meta.id, design)
    }
    const r = await window.dsa.project.save(path, { fileVersion: FILE_VERSION, design })
    if (r.ok) {
      markSaved(path)
      refreshThumbnailAfterSave(design.meta.id, design)
    }
  } catch {
    /* 自动保存失败留给下一次周期重试，不打断用户 */
  } finally {
    saving = false
  }
}

/** 界面配额读写（UI 用） */
export function currentQuota(): InterfaceQuota {
  return resolveQuota(useProjectStore.getState().design.meta)
}
