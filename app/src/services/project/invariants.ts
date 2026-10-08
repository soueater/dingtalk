/**
 * 项目数据不变量校验（F-PM-04）。
 *
 * 设计文档 §4.2 列出的 8 条不变量在这里落地为可执行的检查，用途有二：
 *   1. 开发模式：`commit` 之后断言，尽早暴露破坏契约的改动；
 *   2. 保存前：全量检查一次，把问题以 toast 形式告知用户，而不是写出一个坏文件。
 *
 * 纯逻辑：不 import store / react / electron，可离线单测。
 */
import type { DesignJSON, Node, Page } from '@shared/design'
import { BUILTIN_SPECS } from '@/services/design/specs'

export type ViolationCode =
  | 'I1_NO_INTERFACE'
  | 'I2_DUPLICATE_PAGE_ID'
  | 'I3_ACTIVE_PAGE_MISSING'
  | 'I4_DANGLING_FLOW'
  | 'I5_PAGE_SPEC_MISSING'
  | 'I6_META_SPEC_MISSING'
  | 'I7_ASSET_MISSING'
  | 'I8_GROUP_MISSING'

export type ViolationLevel = 'error' | 'warn'

export interface Violation {
  code: ViolationCode
  level: ViolationLevel
  /** 面向用户的说明 */
  message: string
  /** 相关实体 id，便于一键定位 */
  refs?: string[]
}

export interface CheckContext {
  /** store 中的当前界面 id（不在 design 内，故显式传入） */
  activePageId?: string
}

/** 收集项目内全部节点 id（含重复计数） */
function collectNodeIds(root: Node, into: Map<string, number>) {
  into.set(root.id, (into.get(root.id) ?? 0) + 1)
  root.children?.forEach((c) => collectNodeIds(c, into))
}

/** 可达的规范 id 集合：内置 + 项目内自定义 */
export function resolvableSpecIds(design: Pick<DesignJSON, 'specs'>): Set<string> {
  const s = new Set<string>(BUILTIN_SPECS.map((x) => x.id))
  ;(design.specs ?? []).forEach((x) => s.add(x.id))
  return s
}

/**
 * 全量检查。返回空数组表示数据一致。
 * 顺序与设计文档 §4.2 的编号一致，便于对照。
 */
export function checkInvariants(design: DesignJSON, ctx: CheckContext = {}): Violation[] {
  const out: Violation[] = []
  const pages = design.pages ?? []

  /* I-1 至少保留 1 个界面 —— 无界面时画布与导出都会崩 */
  if (pages.length < 1) {
    out.push({
      code: 'I1_NO_INTERFACE',
      level: 'error',
      message: '项目至少需要保留 1 个界面。',
    })
  }

  /* I-2 界面 id 互不相同 —— 冲突会导致 React key 报警与选中错乱 */
  const seen = new Set<string>()
  const dup: string[] = []
  pages.forEach((p) => {
    if (seen.has(p.id)) dup.push(p.id)
    seen.add(p.id)
  })
  if (dup.length) {
    out.push({
      code: 'I2_DUPLICATE_PAGE_ID',
      level: 'error',
      message: `存在重复的界面 id：${dup.join('、')}`,
      refs: dup,
    })
  }

  /* I-3 activePageId 必须指向存在的界面 */
  if (ctx.activePageId && pages.length && !seen.has(ctx.activePageId)) {
    out.push({
      code: 'I3_ACTIVE_PAGE_MISSING',
      level: 'error',
      message: `当前选中的界面「${ctx.activePageId}」已不存在。`,
      refs: [ctx.activePageId],
    })
  }

  /* I-4 flows 两端必须指向存在的界面 —— 否则预览时跳转死链 */
  const dangling = (design.flows ?? []).filter((f) => !seen.has(f.fromPage) || !seen.has(f.to))
  if (dangling.length) {
    out.push({
      code: 'I4_DANGLING_FLOW',
      level: 'error',
      message: `有 ${dangling.length} 条跳转关系指向不存在的界面。`,
      refs: dangling.map((f) => f.id),
    })
  }

  /* I-5 / I-6 规范引用必须可达 */
  const specs = resolvableSpecIds(design)
  const badPages = pages.filter((p) => p.specId && !specs.has(p.specId))
  if (badPages.length) {
    out.push({
      code: 'I5_PAGE_SPEC_MISSING',
      level: 'error',
      message: `有 ${badPages.length} 个界面绑定了不存在的设计规范。`,
      refs: badPages.map((p) => p.id),
    })
  }
  if (design.meta.specId && !specs.has(design.meta.specId)) {
    out.push({
      code: 'I6_META_SPEC_MISSING',
      level: 'error',
      message: '项目默认设计规范指向的规范已不存在。',
      refs: [design.meta.specId],
    })
  }

  /* I-7 被引用的资源必须能在 assets 里找到（只警告，不阻断 —— 图片可能来自内联 data URL） */
  const assets = new Set((design.assets ?? []).map((a) => a.id))
  const missingAssets: string[] = []
  const checkAssets = (n: Node) => {
    const fill = n.style?.fill
    const src = typeof fill === 'string' ? fill : undefined
    if (src && src.startsWith('asset:') && !assets.has(src.slice(6))) missingAssets.push(src.slice(6))
    const propsSrc = n.props?.src
    if (typeof propsSrc === 'string' && propsSrc.startsWith('asset:') && !assets.has(propsSrc.slice(6))) {
      missingAssets.push(propsSrc.slice(6))
    }
    n.children?.forEach(checkAssets)
  }
  pages.forEach((p) => checkAssets(p.root))
  if (missingAssets.length) {
    out.push({
      code: 'I7_ASSET_MISSING',
      level: 'warn',
      message: `有 ${new Set(missingAssets).size} 个资源引用找不到对应素材。`,
      refs: [...new Set(missingAssets)],
    })
  }

  /* I-8 界面分组引用必须可达 —— 否则分组里出现"看不到的成员" */
  const groups = new Set((design.pageGroups ?? []).map((g) => g.id))
  const orphan = pages.filter((p) => p.groupId && !groups.has(p.groupId))
  if (orphan.length) {
    out.push({
      code: 'I8_GROUP_MISSING',
      level: 'error',
      message: `有 ${orphan.length} 个界面所属的分组已不存在。`,
      refs: orphan.map((p) => p.id),
    })
  }

  return out
}

/** 仅取 error 级问题 */
export function errorsOf(v: Violation[]): Violation[] {
  return v.filter((x) => x.level === 'error')
}

/** 是否可安全保存 */
export function isSaveable(design: DesignJSON, ctx: CheckContext = {}): boolean {
  return errorsOf(checkInvariants(design, ctx)).length === 0
}

/**
 * 自愈：把可自动修复的问题修掉（悬空引用清空、重复 id 重命名、分组孤儿摘除）。
 * 明确**不修** I-1（无界面）与 I-3（选中态），因为这两者需要用户决策。
 */
export function repairInvariants(design: DesignJSON): { design: DesignJSON; fixed: ViolationCode[] } {
  const fixed: ViolationCode[] = []
  const d = JSON.parse(JSON.stringify(design)) as DesignJSON

  // I-4：删除悬空 flows
  const pageIds = new Set(d.pages.map((p) => p.id))
  const beforeFlows = d.flows.length
  d.flows = d.flows.filter((f) => pageIds.has(f.fromPage) && pageIds.has(f.to))
  if (d.flows.length !== beforeFlows) fixed.push('I4_DANGLING_FLOW')

  // I-2：重复界面 id 加后缀
  const seen = new Set<string>()
  d.pages = d.pages.map((p) => {
    if (!seen.has(p.id)) {
      seen.add(p.id)
      return p
    }
    const next = `${p.id}_${Math.random().toString(36).slice(2, 6)}`
    seen.add(next)
    return { ...p, id: next }
  })
  if (new Set(design.pages.map((p) => p.id)).size !== design.pages.length) fixed.push('I2_DUPLICATE_PAGE_ID')

  // I-5/I-6：不可达规范引用清空
  const specs = resolvableSpecIds(d)
  if (d.meta.specId && !specs.has(d.meta.specId)) {
    delete d.meta.specId
    fixed.push('I6_META_SPEC_MISSING')
  }
  let clearedPageSpec = false
  d.pages = d.pages.map((p) => {
    if (p.specId && !specs.has(p.specId)) {
      const { specId: _drop, ...rest } = p
      clearedPageSpec = true
      return rest as Page
    }
    return p
  })
  if (clearedPageSpec) fixed.push('I5_PAGE_SPEC_MISSING')

  // I-8：分组孤儿摘除
  const groups = new Set((d.pageGroups ?? []).map((g) => g.id))
  d.pages = d.pages.map((p) => {
    if (p.groupId && !groups.has(p.groupId)) {
      const { groupId: _drop, ...rest } = p
      return rest as Page
    }
    return p
  })
  if (design.pages.some((p) => p.groupId && !groups.has(p.groupId))) fixed.push('I8_GROUP_MISSING')

  return { design: d, fixed }
}

/** 节点 id 重复检查（独立于上面 8 条 —— 它属于"界面内"而非"项目级"） */
export function duplicateNodeIds(design: DesignJSON): string[] {
  const counts = new Map<string, number>()
  design.pages.forEach((p) => collectNodeIds(p.root, counts))
  return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id)
}
