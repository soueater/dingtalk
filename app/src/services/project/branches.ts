// src/services/project/branches.ts
// 方案分支（F-PM-07）的渲染层入口。
//
// 分支 = 「一套完整的备选方案」（多个界面 + 跳转 + Token），与「界面变体」不同：
//   界面变体是**单个界面**的几种画法，候选完直接采纳即可；
//   方案分支是**整个项目**的另一种走法（导航结构、信息密度、视觉气质都不同），
//   要先存下来对比，再决定采纳哪一套。
import type { DesignJSON, Page, ProjectBranch, ProjectBranchSummary, Tokens } from '@shared/design'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const hasBridge = () => typeof window !== 'undefined' && !!window.dsa?.branch

export async function listBranches(projectId: string): Promise<ProjectBranchSummary[]> {
  if (!hasBridge()) return []
  try {
    const r = await window.dsa.branch.list(projectId)
    return r.ok ? r.data : []
  } catch {
    return []
  }
}

export async function readBranch(projectId: string, branchId: string): Promise<ProjectBranch | null> {
  if (!hasBridge()) return null
  try {
    const r = await window.dsa.branch.read(projectId, branchId)
    return r.ok ? r.data : null
  } catch {
    return null
  }
}

/** 把当前项目的整套方案存成一条分支 */
export async function saveCurrentAsBranch(
  name: string,
  aspect?: string,
): Promise<ProjectBranchSummary | null> {
  const design = useProjectStore.getState().design
  return createBranchFrom(design, name, aspect)
}

export async function createBranchFrom(
  design: DesignJSON,
  name: string,
  aspect?: string,
): Promise<ProjectBranchSummary | null> {
  const toast = useUiStore.getState().toast
  if (!hasBridge()) {
    toast('error', '方案分支仅在桌面客户端中可用')
    return null
  }
  try {
    const r = await window.dsa.branch.create({
      projectId: design.meta.id,
      name,
      aspect,
      pages: JSON.parse(JSON.stringify(design.pages)) as Page[],
      flows: JSON.parse(JSON.stringify(design.flows)),
      tokens: JSON.parse(JSON.stringify(design.tokens)) as Tokens,
    })
    if (!r.ok) {
      toast('error', r.message)
      return null
    }
    toast('success', `已保存方案分支「${name}」`)
    return r.data
  } catch (e) {
    toast('error', (e as Error)?.message ?? '保存分支失败')
    return null
  }
}

export async function renameBranch(
  projectId: string,
  branchId: string,
  name: string,
  aspect?: string,
): Promise<ProjectBranchSummary[]> {
  if (!hasBridge()) return []
  try {
    const r = await window.dsa.branch.rename({ projectId, branchId, name, aspect })
    if (!r.ok) return []
    return listBranches(projectId)
  } catch {
    return []
  }
}

export async function removeBranch(projectId: string, branchId: string): Promise<ProjectBranchSummary[]> {
  if (!hasBridge()) return []
  try {
    await window.dsa.branch.remove(projectId, branchId)
    return listBranches(projectId)
  } catch {
    return []
  }
}

/**
 * 采纳某条分支：把分支的界面 / 跳转 / Token 覆盖回当前项目。
 *
 * 注意这里**替换的是整套方案**，不是合并 —— 合并两份互斥的导航结构只会造出四不像。
 * 覆盖前由调用方负责确认（UI 层会弹「当前改动将进入撤销栈」的提示）。
 */
export async function adoptBranch(
  projectId: string,
  branchId: string,
  branchName: string,
): Promise<boolean> {
  const toast = useUiStore.getState().toast
  const b = await readBranch(projectId, branchId)
  if (!b) {
    toast('error', '分支数据读取失败')
    return false
  }
  const store = useProjectStore.getState()
  store.commit(`采纳方案分支：${branchName}`, (d) => ({
    ...d,
    pages: JSON.parse(JSON.stringify(b.pages)) as Page[],
    flows: JSON.parse(JSON.stringify(b.flows)),
    tokens: b.tokens ? (JSON.parse(JSON.stringify(b.tokens)) as Tokens) : d.tokens,
    pageGroups: d.pageGroups ?? [],
  }))
  /* 采纳后活动界面可能已不存在，回落到第一个 */
  const after = useProjectStore.getState()
  if (!after.design.pages.some((p) => p.id === after.activePageId)) {
    const first = after.design.pages[0]
    if (first) after.setActivePage(first.id)
  }
  if (hasBridge()) {
    try {
      await window.dsa.branch.adopt(projectId, branchId)
    } catch {
      /* 标记失败不影响采纳本身 */
    }
  }
  toast('success', `已采纳方案分支「${branchName}」（可用 Ctrl+Z 撤销）`)
  return true
}
