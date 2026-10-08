/**
 * 界面（Page）与界面分组（PageGroup）的纯逻辑操作层 —— F-PM-04 / F-PM-05。
 *
 * 为什么放在 `shared/` 而不是 `src/services/`：
 *   主进程也要用同一套逻辑 —— 「复制项目」需要在主进程里重排界面 id、节点 id、
 *   跳转引用（`remapProjectIds`），而主进程只能使用相对路径导入，走不到 `@/` 别名。
 *   放在 shared 后，渲染层 `src/services/project/pages.ts` 直接转发，实现唯一。
 *
 * 契约（对应设计文档 §4）：
 *   - 界面内嵌于项目：`DesignJSON.pages[]` 即归属，不存在"界面的项目外键"字段；
 *   - `Page.id` 约定全局唯一（便于 flows 与跨项目复制无歧义）；
 *   - 删除界面必须**级联清理** `flows` 中引用它的边，否则预览会出现死链；
 *   - 复制界面必须**递归重生成全部 Node.id**（历史缺陷 BUG-PM-2：旧实现只换了
 *     `Page.id`，副本与原界面节点 id 完全相同，导致跨界面查找与导出 key 冲突）。
 *
 * 全部函数**不可变**（返回新对象，不改入参），既能在 `commit(mutator)` 里直接用，
 * 也能在 Node 下离线单测。
 */
import type { DesignJSON, Device, Flow, Node, Page, PageGroup, PaintRef, ProjectFile } from './design'
import { DEVICE_CANVAS, FILE_VERSION } from './design'
import { uid, uniqueId } from './ids'

/* --------------------------------- 基础工具 --------------------------------- */

export function cloneDesign(d: DesignJSON): DesignJSON {
  return JSON.parse(JSON.stringify(d)) as DesignJSON
}

export function canvasOf(device: Device | string | undefined) {
  return DEVICE_CANVAS[device ?? 'MOBILE'] ?? DEVICE_CANVAS.MOBILE
}

/** 横向排布间距（与既有的 PageList.addPage 行为保持一致） */
export const PAGE_GAP_X = 40

/* --------------------------------- 界面工厂 --------------------------------- */

/**
 * 一个空白界面：只含一个纵向 flex 根容器。
 * 这是生产路径的**唯一**空白界面工厂（mock 数据的 emptyPage 亦转发到此）。
 */
export function blankInterface(
  device: Device = 'MOBILE',
  order = 0,
  pos?: { x: number; y: number },
): Page {
  const root: Node = {
    id: `root_${uid()}`,
    type: 'frame',
    name: '界面根容器',
    layout: {
      mode: 'flex',
      direction: 'column',
      width: 'fill',
      height: 'fill',
      padding: { t: 16, r: 16, b: 16, l: 16 },
      gap: 12,
    },
    style: { fill: '$color.bg' },
    children: [],
  }
  return {
    id: `page_${uid()}`,
    name: `界面 ${order + 1}`,
    order,
    pos: pos ?? { x: 0, y: 0 },
    background: '$color.bg',
    root,
  }
}

/** 下一个新界面的画布位置：接在最右侧界面右边 */
export function nextPosForNewInterface(design: DesignJSON): { x: number; y: number } {
  const w = canvasOf(design.meta.device).width
  const maxX = design.pages.reduce((m, p) => Math.max(m, p.pos?.x ?? 0), 0)
  return { x: maxX + w + PAGE_GAP_X, y: 0 }
}

/** 第 i 个（从 0 起）新界面的位置，用于批量追加时依次排开 */
export function posForIndex(design: DesignJSON, index: number): { x: number; y: number } {
  const w = canvasOf(design.meta.device).width
  const maxX = design.pages.reduce((m, p) => Math.max(m, p.pos?.x ?? 0), 0)
  return { x: maxX + (w + PAGE_GAP_X) * (index + 1), y: 0 }
}

/**
 * 递归重生成节点 id。
 * 用于复制界面 —— 不重生成会让副本与原界面共享节点 id。
 */
export function regenerateNodeIds(root: Node): Node {
  const walk = (n: Node): Node => ({
    ...n,
    id: `${n.type}_${uid()}`,
    children: n.children?.map(walk),
  })
  return walk(root)
}

/** 复制界面：新 id、新节点 id、名称追加「副本」；不复制 flows（新界面从无跳转开始） */
export function duplicateInterface(page: Page, order: number, pos: { x: number; y: number }): Page {
  const copy: Page = JSON.parse(JSON.stringify(page)) as Page
  copy.id = `page_${uid()}`
  copy.name = `${page.name} 副本`
  copy.order = order
  copy.pos = pos
  copy.root = regenerateNodeIds(copy.root)
  return copy
}

/* --------------------------------- 增 / 删 --------------------------------- */

/**
 * 追加 count 个空白界面（一次事务）。
 * 返回新 design；调用方负责先做配额校验（见 src/services/project/quota.ts）。
 */
export function appendInterfaces(
  design: DesignJSON,
  count: number,
  opts: { device?: Device; groupId?: string; namePrefix?: string } = {},
): DesignJSON {
  const n = Math.max(0, Math.trunc(count))
  if (n === 0) return design
  const d = cloneDesign(design)
  const device = opts.device ?? d.meta.device
  const base = d.pages.length
  for (let i = 0; i < n; i++) {
    const order = base + i
    const p = blankInterface(device, order, posForIndex(d, i))
    if (opts.groupId) {
      p.groupId = opts.groupId
      // 归入分组时用模块名做前缀，避免一堆「界面 N」看不出归属
      p.name = `${opts.namePrefix ?? '界面'} ${i + 1}`
    }
    d.pages = [...d.pages, p]
  }
  return d
}

/** 复制第 index 个界面并追加到末尾 */
export function duplicateInterfaceAt(design: DesignJSON, pageId: string): DesignJSON {
  const idx = design.pages.findIndex((p) => p.id === pageId)
  if (idx < 0) return design
  const d = cloneDesign(design)
  const src = d.pages[idx]
  const pos = nextPosForNewInterface(d)
  const copy = duplicateInterface(src, d.pages.length, pos)
  if (src.groupId) copy.groupId = src.groupId
  d.pages = [...d.pages, copy]
  return d
}

/**
 * 删除界面并级联清理 flows。
 * 不变量 I-1（至少保留 1 个界面）由调用方负责拦截并提示 —— 本函数只做数据变换，
 * 因此可以安全地用于"批量删除后校验"这类场景。
 */
export function deleteInterface(design: DesignJSON, pageId: string): DesignJSON {
  const d = cloneDesign(design)
  d.pages = d.pages.filter((p) => p.id !== pageId)
  d.flows = d.flows.filter((f) => f.fromPage !== pageId && f.to !== pageId)
  d.pages = normalizeOrders(d.pages)
  return d
}

/** 批量删除（仍会级联清理 flows） */
export function deleteInterfaces(design: DesignJSON, pageIds: string[]): DesignJSON {
  const kill = new Set(pageIds)
  const d = cloneDesign(design)
  d.pages = d.pages.filter((p) => !kill.has(p.id))
  d.flows = d.flows.filter((f) => !kill.has(f.fromPage) && !kill.has(f.to))
  d.pages = normalizeOrders(d.pages)
  return d
}

/** 把 order 重排为 0..n-1（保持原有相对顺序） */
export function normalizeOrders(pages: Page[]): Page[] {
  return pages.map((p, i) => (p.order === i ? p : { ...p, order: i }))
}

/** 移动界面顺序（拖拽排序） */
export function moveInterface(design: DesignJSON, pageId: string, toIndex: number): DesignJSON {
  const d = cloneDesign(design)
  const from = d.pages.findIndex((p) => p.id === pageId)
  if (from < 0) return design
  const to = Math.max(0, Math.min(d.pages.length - 1, Math.trunc(toIndex)))
  if (from === to) return design
  const [item] = d.pages.splice(from, 1)
  d.pages.splice(to, 0, item)
  d.pages = normalizeOrders(d.pages)
  return d
}

/** 重命名界面 */
export function renameInterface(design: DesignJSON, pageId: string, name: string): DesignJSON {
  const v = name.trim()
  if (!v) return design
  const d = cloneDesign(design)
  d.pages = d.pages.map((p) => (p.id === pageId ? { ...p, name: v } : p))
  return d
}

/* --------------------------------- 界面分组 --------------------------------- */

export const GROUP_COLORS = ['#4C8DFF', '#8B5CF6', '#38D39F', '#F5A524', '#F5566E', '#22B8CF']

export function createPageGroup(name: string, order: number): PageGroup {
  return {
    id: `grp_${uid()}`,
    name: name.trim() || `分组 ${order + 1}`,
    order,
    color: GROUP_COLORS[order % GROUP_COLORS.length],
  }
}

export function groupsOf(design: DesignJSON): PageGroup[] {
  return [...(design.pageGroups ?? [])].sort((a, b) => a.order - b.order)
}

export function findGroup(design: DesignJSON, groupId: string | undefined): PageGroup | undefined {
  if (!groupId) return undefined
  return (design.pageGroups ?? []).find((g) => g.id === groupId)
}

/** 把若干界面归入某分组（groupId 为空表示移出分组） */
export function assignToGroup(
  design: DesignJSON,
  pageIds: string[],
  groupId: string | undefined,
): DesignJSON {
  const ids = new Set(pageIds)
  const d = cloneDesign(design)
  d.pages = d.pages.map((p) => {
    if (!ids.has(p.id)) return p
    if (groupId) return { ...p, groupId }
    const { groupId: _drop, ...rest } = p
    return rest as Page
  })
  return d
}

/** 新增分组并把若干界面归入其中 */
export function addGroupWithInterfaces(
  design: DesignJSON,
  name: string,
  pageIds: string[],
): DesignJSON {
  const list = design.pageGroups ?? []
  const g = createPageGroup(name, list.length)
  const withGroup: DesignJSON = { ...cloneDesign(design), pageGroups: [...list, g] }
  return assignToGroup(withGroup, pageIds, g.id)
}

/** 删除分组：成员界面回到「未分组」，不留孤儿 groupId（不变量 I-8） */
export function removeGroup(design: DesignJSON, groupId: string): DesignJSON {
  const d = cloneDesign(design)
  d.pageGroups = (d.pageGroups ?? []).filter((g) => g.id !== groupId)
  d.pages = d.pages.map((p) => {
    if (p.groupId !== groupId) return p
    const { groupId: _drop, ...rest } = p
    return rest as Page
  })
  return d
}

export function renameGroup(design: DesignJSON, groupId: string, name: string): DesignJSON {
  const v = name.trim()
  if (!v) return design
  const d = cloneDesign(design)
  d.pageGroups = (d.pageGroups ?? []).map((g) => (g.id === groupId ? { ...g, name: v } : g))
  return d
}

export function setGroupCollapsed(
  design: DesignJSON,
  groupId: string,
  collapsed: boolean,
): DesignJSON {
  const d = cloneDesign(design)
  d.pageGroups = (d.pageGroups ?? []).map((g) => (g.id === groupId ? { ...g, collapsed } : g))
  return d
}

/** 按分组切分界面（末尾附「未分组」桶，其 group 为 null） */
export interface GroupBucket {
  group: PageGroup | null
  pages: Page[]
}

export function bucketByGroup(design: DesignJSON): GroupBucket[] {
  const groups = groupsOf(design)
  const buckets: GroupBucket[] = groups.map((g) => ({
    group: g,
    pages: design.pages.filter((p) => p.groupId === g.id).sort((a, b) => a.order - b.order),
  }))
  const orphan = design.pages
    .filter((p) => !findGroup(design, p.groupId))
    .sort((a, b) => a.order - b.order)
  if (orphan.length) buckets.push({ group: null, pages: orphan })
  return buckets
}

/* --------------------------------- 查询工具 --------------------------------- */

/** 项目内全部界面 id 集合 */
export function pageIdSet(design: DesignJSON): Set<string> {
  return new Set(design.pages.map((p) => p.id))
}

/** 项目内全部节点 id 集合 */
export function nodeIdSet(design: DesignJSON): Set<string> {
  const out = new Set<string>()
  const walk = (n: Node) => {
    out.add(n.id)
    n.children?.forEach(walk)
  }
  design.pages.forEach((p) => walk(p.root))
  return out
}

/** 统计每个节点 id 出现次数（用于检出重复 —— BUG-PM-2 的回归断言） */
export function nodeIdCounts(design: DesignJSON): Map<string, number> {
  const m = new Map<string, number>()
  const walk = (n: Node) => {
    m.set(n.id, (m.get(n.id) ?? 0) + 1)
    n.children?.forEach(walk)
  }
  design.pages.forEach((p) => walk(p.root))
  return m
}

/** 界面统计摘要（项目中心卡片用） */
export interface InterfaceStats {
  total: number
  grouped: number
  ungrouped: number
  flowCount: number
  /** 没有任何跳转关系的界面数（流程视角下的孤岛） */
  isolated: number
}

export function interfaceStats(design: DesignJSON): InterfaceStats {
  const linked = new Set<string>()
  design.flows.forEach((f) => {
    linked.add(f.fromPage)
    linked.add(f.to)
  })
  const grouped = design.pages.filter((p) => !!findGroup(design, p.groupId)).length
  return {
    total: design.pages.length,
    grouped,
    ungrouped: design.pages.length - grouped,
    flowCount: design.flows.length,
    isolated: design.pages.filter((p) => !linked.has(p.id)).length,
  }
}

/* --------------------------- 整项目 id 重排（复制项目） --------------------------- */

/**
 * 深拷贝一个项目文件并把**所有实体 id 换成新的**，
 * 使副本与原项目在 id 空间上完全隔离（否则两个项目会共享界面/节点 id，
 * 在"同时打开两个项目"的场景下会造成难以排查的串页）。
 *
 * 同步重排的引用：flows.from/fromPage/to、page.groupId、asset.id 引用。
 */
export function remapProjectIds(
  pf: ProjectFile,
  opts: { name?: string; id?: string } = {},
): ProjectFile {
  const design = JSON.parse(JSON.stringify(pf.design)) as DesignJSON
  const taken = new Set<string>()

  // 1) 界面 id 与节点 id
  const pageIdMap = new Map<string, string>()
  const nodeIdMap = new Map<string, string>()
  design.pages = design.pages.map((p) => {
    const next = { ...p }
    next.id = uniqueId('page', taken)
    pageIdMap.set(p.id, next.id)
    const walk = (n: Node): Node => {
      const id = uniqueId(n.type, taken)
      nodeIdMap.set(n.id, id)
      return { ...n, id, children: n.children?.map(walk) }
    }
    next.root = walk(p.root)
    return next
  })

  // 2) 分组 id
  const groupIdMap = new Map<string, string>()
  if (design.pageGroups?.length) {
    design.pageGroups = design.pageGroups.map((g) => {
      const id = uniqueId('grp', taken)
      groupIdMap.set(g.id, id)
      return { ...g, id }
    })
  }

  // 3) 资源 id（节点 props.src / style.fill 里的 `asset:<id>` 引用一并改写）
  const assetIdMap = new Map<string, string>()
  if (design.assets?.length) {
    design.assets = design.assets.map((a) => {
      const id = uniqueId('asset', taken)
      assetIdMap.set(a.id, id)
      return { ...a, id }
    })
  }

  // 4) 回写引用
  design.pages = design.pages.map((p) => {
    const next: Page = { ...p }
    if (next.groupId) next.groupId = groupIdMap.get(next.groupId) ?? next.groupId
    const walk = (n: Node): Node => {
      const out: Node = { ...n }
      if (out.children) out.children = out.children.map(walk)
      const rewrite = (v: unknown): unknown => {
        if (typeof v !== 'string') return v
        if (v.startsWith('asset:')) {
          const id = v.slice(6)
          const mapped = assetIdMap.get(id)
          return mapped ? `asset:${mapped}` : v
        }
        return v
      }
      if (out.style?.fill !== undefined) {
        out.style = { ...out.style, fill: rewrite(out.style.fill) as PaintRef }
      }
      if (out.props?.src !== undefined) {
        out.props = { ...out.props, src: rewrite(out.props.src) }
      }
      return out
    }
    next.root = walk(next.root)
    return next
  })

  // 5) flows
  design.flows = design.flows.map((f) => {
    const next: Flow = { ...f }
    next.id = uniqueId('flow', taken)
    next.from = nodeIdMap.get(f.from) ?? f.from
    next.fromPage = pageIdMap.get(f.fromPage) ?? f.fromPage
    next.to = pageIdMap.get(f.to) ?? f.to
    return next
  })

  // 6) 项目元数据
  design.meta = {
    ...design.meta,
    id: opts.id ?? uniqueId('proj', taken),
    name: opts.name ?? `${design.meta.name} 副本`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  return { fileVersion: pf.fileVersion || FILE_VERSION, design }
}
