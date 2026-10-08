// src/services/ai/optimize.ts
// F-ST-04 页面 AI 优化能力 —— ops 应用器 / 载荷校验 / 规则化自动诊断 / 意图保全
//
// 设计要点（对应 docs/功能设计-对标Stitch能力增强.md §5，DoD 见 §5.6）：
//  · 两条入口（「自动优化」AI 主导 / 「提示词驱动优化」用户主导）最终都收敛为
//    **同一份 ops 补丁**，由**同一个应用器**落地 —— 因此只有一条正确性路径需要维护；
//  · 复用 prompt-templates 里长期零调用方的 `buildEditPrompt()`（本文件是它唯一调用点）；
//  · 本模块刻意「不 import store / 不 import react」：`applyOps` / `diagnosePage` /
//    `checkOpSafety` 全部是纯函数，供 scripts/test-optimize.mjs 直接单测；
//    真正落库（`commit` 单事务 + 撤销）由 UI 层负责，避免 AI 服务层反向依赖渲染层状态。

import type { DesignJSON, Node, NodeType, Page, Style, Layout } from '@shared/design'
import type { TokenMap } from '@/services/render/tokens'
import { askJson } from './ask-json'
import { repairNode } from './parse'
import { buildEditPrompt, TEMP } from './prompt-templates'
import { detectDrift, tokensForPage, type DriftIssue } from '@/services/design/specs'
import { buildTokenMap } from '@/services/render/tokens'

/* ================================================================= */
/* 1. ops 补丁类型                                                    */
/* ================================================================= */

/** `update`：对 style / layout / props 做合并（见 mergeStyle / mergeLayout 的合并粒度说明） */
export interface UpdateOp {
  op: 'update'
  id: string
  style?: Style
  layout?: Layout
  props?: Record<string, unknown>
}

/** `add`：在 parent 的 index 位置插入新节点（index 越界会被 clamp） */
export interface AddOp {
  op: 'add'
  parent: string
  index?: number
  node: unknown
}

/** `remove`：删除节点（根节点不可删；引用被删子树的 flows 会被级联清理） */
export interface RemoveOp {
  op: 'remove'
  id: string
}

/** `replaceContent`：改写内容文案（按节点类型写入对应字段，见 CONTENT_FIELD） */
export interface ReplaceContentOp {
  op: 'replaceContent'
  id: string
  content: string
}

export type EditOp = UpdateOp | AddOp | RemoveOp | ReplaceContentOp
export type EditOpKind = EditOp['op']

export const EDIT_OP_KINDS: EditOpKind[] = ['update', 'add', 'remove', 'replaceContent']

/* ================================================================= */
/* 2. 载荷校验与修补                                                  */
/* ================================================================= */

export interface OpsValidateResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

/** 结构校验：只要有**至少一条**可识别的 op 就放行（单条坏 op 由 repair 阶段丢弃） */
export function validateOpsPayload(o: unknown): OpsValidateResult {
  const errors: string[] = []
  const warnings: string[] = []
  const obj = o as Record<string, unknown> | null
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['输出不是对象'], warnings }

  const ops = obj.ops
  if (!Array.isArray(ops) || !ops.length) {
    // 文案直接面向用户：说清「模型没给任何改动」，而不是让他以为 JSON 语法坏了
    errors.push('未返回任何改动（ops 缺失或为空数组）')
    return { ok: false, errors, warnings }
  }

  const usable = ops.filter(
    (x) => x && typeof x === 'object' && !!(x as Record<string, unknown>).op,
  )
  if (!usable.length) {
    errors.push('所有改动项都缺少 op 字段')
    return { ok: false, errors, warnings }
  }
  if (usable.length < ops.length) {
    warnings.push(`${ops.length - usable.length} 条改动缺少 op，已忽略`)
  }
  if (obj.explanation != null && typeof obj.explanation !== 'string') {
    warnings.push('explanation 不是字符串，已忽略')
  }
  return { ok: true, errors, warnings }
}

export interface OpsRepairResult {
  ops: EditOp[]
  warnings: string[]
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * 逐条宽容修补 ops：
 * 非法/残缺的条目直接丢弃并记账，不让单条坏 op 拖垮整批（与 repairVariantsPayload 同一哲学）。
 */
export function repairOpsPayload(o: unknown, limit = 120): OpsRepairResult {
  const warnings: string[] = []
  const ops: EditOp[] = []
  const obj = asRecord(o)
  const list = Array.isArray(obj?.ops) ? (obj!.ops as unknown[]) : []
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : list.length

  let dropped = 0
  for (const raw of list) {
    if (ops.length >= cap) break
    const r = asRecord(raw)
    if (!r) {
      dropped++
      continue
    }
    const kind = String(r.op ?? '')

    if (kind === 'update') {
      if (!isNonEmptyString(r.id)) {
        dropped++
        continue
      }
      const style = asRecord(r.style)
      const layout = asRecord(r.layout)
      const props = asRecord(r.props)
      if (!style && !layout && !props) {
        dropped++
        continue
      }
      const op: UpdateOp = { op: 'update', id: r.id }
      if (style) op.style = style as Style
      if (layout) op.layout = layout as Layout
      if (props) op.props = props
      ops.push(op)
      continue
    }

    if (kind === 'add') {
      if (!isNonEmptyString(r.parent) || !asRecord(r.node)) {
        dropped++
        continue
      }
      const idx = typeof r.index === 'number' && Number.isFinite(r.index) ? Math.floor(r.index) : undefined
      ops.push({ op: 'add', parent: r.parent, index: idx, node: r.node })
      continue
    }

    if (kind === 'remove') {
      if (!isNonEmptyString(r.id)) {
        dropped++
        continue
      }
      ops.push({ op: 'remove', id: r.id })
      continue
    }

    if (kind === 'replaceContent') {
      if (!isNonEmptyString(r.id) || typeof r.content !== 'string') {
        dropped++
        continue
      }
      ops.push({ op: 'replaceContent', id: r.id, content: r.content })
      continue
    }

    dropped++
  }

  if (list.length > cap) warnings.push(`改动条目超出上限，已截取前 ${cap} 条`)
  if (dropped > 0) warnings.push(`${dropped} 条改动格式非法，已忽略`)

  return { ops, warnings }
}

/* ================================================================= */
/* 3. ops 应用器（核心）                                              */
/* ================================================================= */

export interface ApplyOpsResult {
  root: Node
  /** 实际生效的 op */
  applied: EditOp[]
  /** 被跳过的 op 及原因 */
  skipped: Array<{ op: EditOp; reason: string }>
  /** 所有被改动/新增/删除的节点 id（供 UI 高亮与 diff 统计） */
  touchedIds: string[]
  /** 被删除的节点 id（含子树） */
  removedIds: string[]
}

const CONTENT_FIELD: Partial<Record<NodeType, string>> = {
  button: 'label',
  badge: 'label',
  tag: 'label',
  chip: 'label',
  navbar: 'title',
  input: 'placeholder',
  textarea: 'placeholder',
  searchbar: 'placeholder',
  tooltip: 'content',
  toast: 'content',
}

let opSeq = 0
function uid(prefix: string): string {
  opSeq += 1
  return `${prefix}_${Date.now().toString(36)}${opSeq.toString(36)}`
}

/**
 * style 合并。
 * 顶层浅合并（只改 op 里出现的字段，未提及字段一律保留），
 * 对 **已知嵌套对象组**（font / stroke）再做一层合并 —— 否则模型只给 `font.size`
 * 时会连同 `font.family` 一起抹掉，渲染层随即回退到默认字体，属于「越优化越坏」。
 * `shadow` 是数组，语义为整体替换，不做合并。
 */
function mergeStyle(base: Style | undefined, patch: Style | undefined): Style | undefined {
  if (!patch) return base
  const out: Style = { ...(base ?? {}), ...patch }
  if (patch.font && base?.font) out.font = { ...base.font, ...patch.font }
  if (patch.stroke && base?.stroke) out.stroke = { ...base.stroke, ...patch.stroke }
  return out
}

/** layout 合并：同 mergeStyle，对 padding / margin 两个边距组再做一层合并 */
function mergeLayout(base: Layout | undefined, patch: Layout | undefined): Layout | undefined {
  if (!patch) return base
  const out: Layout = { ...(base ?? {}), ...patch }
  if (patch.padding && base?.padding) out.padding = { ...base.padding, ...patch.padding }
  if (patch.margin && base?.margin) out.margin = { ...base.margin, ...patch.margin }
  return out
}

/** 在树中按 id 查找节点 */
export function findNodeInTree(root: Node, id: string): Node | null {
  if (root.id === id) return root
  for (const c of root.children ?? []) {
    const hit = findNodeInTree(c, id)
    if (hit) return hit
  }
  return null
}

/** 收集子树全部 id */
export function collectIds(node: Node, into: string[] = []): string[] {
  into.push(node.id)
  node.children?.forEach((c) => collectIds(c, into))
  return into
}

/** 收集树中所有已用 id */
function collectIdSet(node: Node, into: Set<string> = new Set()): Set<string> {
  into.add(node.id)
  node.children?.forEach((c) => collectIdSet(c, into))
  return into
}

/** 为新增节点补 id 并避免与既有 id 冲突 */
function assignFreshIds(node: Node, used: Set<string>): Node {
  const out: Node = { ...node }
  if (!out.id || used.has(out.id)) out.id = uid(node.type || 'node')
  used.add(out.id)
  if (node.children?.length) out.children = node.children.map((c) => assignFreshIds(c, used))
  return out
}

/**
 * 对节点树应用一条 op（纯函数，返回新树；不改动入参）。
 * 每次只重建「路径上的节点」，未涉及的子树保持引用共享。
 */
function applyOne(root: Node, op: EditOp): { root: Node; ok: boolean; reason?: string; touched: string[] } {
  if (op.op === 'update') {
    let found = false
    const walk = (n: Node): Node => {
      if (n.id === op.id) {
        found = true
        const next: Node = { ...n }
        const style = mergeStyle(n.style, op.style)
        const layout = mergeLayout(n.layout, op.layout)
        if (style) next.style = style
        if (layout) next.layout = layout
        if (op.props) next.props = { ...(n.props ?? {}), ...op.props }
        return next
      }
      if (n.children?.length) {
        const kids = n.children.map(walk)
        if (kids.some((k, i) => k !== n.children![i])) return { ...n, children: kids }
      }
      return n
    }
    const nextRoot = walk(root)
    if (!found) return { root, ok: false, reason: `找不到节点 ${op.id}`, touched: [] }
    return { root: nextRoot, ok: true, touched: [op.id] }
  }

  if (op.op === 'remove') {
    if (root.id === op.id) return { root, ok: false, reason: '根节点不可删除', touched: [] }
    let found = false
    let removed: string[] = []
    const walk = (n: Node): Node => {
      if (!n.children?.length) return n
      const kept: Node[] = []
      let dropped = false
      for (const c of n.children) {
        if (c.id === op.id) {
          found = true
          dropped = true
          removed = collectIds(c)
          continue
        }
        kept.push(c)
      }
      const kids = kept.map(walk)
      if (!dropped && kids.every((k, i) => k === kept[i])) return n
      return { ...n, children: kids }
    }
    const nextRoot = walk(root)
    if (!found) return { root, ok: false, reason: `找不到节点 ${op.id}`, touched: [] }
    return { root: nextRoot, ok: true, touched: removed }
  }

  if (op.op === 'replaceContent') {
    let found = false
    const walk = (n: Node): Node => {
      if (n.id === op.id) {
        found = true
        const field = CONTENT_FIELD[n.type] ?? 'content'
        const props: Record<string, unknown> = { ...(n.props ?? {}), content: op.content }
        // 让改动「看得见」：多数组件的文案并非读 props.content（按钮读 label、导航栏读 title…），
        // 只写 content 会变成静默空操作。两种字段都写，既有规范记录、又能立即生效。
        props[field] = op.content
        return { ...n, props }
      }
      if (n.children?.length) {
        const kids = n.children.map(walk)
        if (kids.some((k, i) => k !== n.children![i])) return { ...n, children: kids }
      }
      return n
    }
    const nextRoot = walk(root)
    if (!found) return { root, ok: false, reason: `找不到节点 ${op.id}`, touched: [] }
    return { root: nextRoot, ok: true, touched: [op.id] }
  }

  // add
  const used = collectIdSet(root)
  const fresh = assignFreshIds(repairNode(op.node, 1), used)
  let found = false
  const walk = (n: Node): Node => {
    if (n.id === op.parent) {
      found = true
      const kids = [...(n.children ?? [])]
      // index 越界 clamp 到 [0, len]
      const at = op.index == null ? kids.length : Math.max(0, Math.min(kids.length, op.index))
      kids.splice(at, 0, fresh)
      return { ...n, children: kids }
    }
    if (n.children?.length) {
      const next = n.children.map(walk)
      if (next.some((k, i) => k !== n.children![i])) return { ...n, children: next }
    }
    return n
  }
  const nextRoot = walk(root)
  if (!found) return { root, ok: false, reason: `找不到父节点 ${op.parent}`, touched: [] }
  return { root: nextRoot, ok: true, touched: collectIds(fresh) }
}

/** 依序应用一批 op */
export function applyOps(root: Node, ops: EditOp[]): ApplyOpsResult {
  let cur = root
  const applied: EditOp[] = []
  const skipped: ApplyOpsResult['skipped'] = []
  const touchedIds: string[] = []
  const removedIds: string[] = []

  for (const op of ops) {
    const r = applyOne(cur, op)
    if (!r.ok) {
      skipped.push({ op, reason: r.reason ?? '未知原因' })
      continue
    }
    cur = r.root
    applied.push(op)
    touchedIds.push(...r.touched)
    if (op.op === 'remove') removedIds.push(...r.touched)
  }

  return { root: cur, applied, skipped, touchedIds: [...new Set(touchedIds)], removedIds }
}

/* ================================================================= */
/* 4. 落到项目（含 flows 级联清理）                                   */
/* ================================================================= */

export interface ApplyToDesignResult extends ApplyOpsResult {
  design: DesignJSON
  /** 被级联清理的跳转条数 */
  droppedFlows: number
}

/**
 * 把 ops 应用到指定页面，并级联清理「源节点已被删除」的 flows。
 * 纯函数：返回新 design，调用方负责 `commit` 入栈（单事务可撤销）。
 */
export function applyOpsToDesign(design: DesignJSON, pageId: string, ops: EditOp[]): ApplyToDesignResult {
  const cloned = JSON.parse(JSON.stringify(design)) as DesignJSON
  const page = cloned.pages.find((p) => p.id === pageId)
  if (!page) {
    return {
      design: cloned, root: { id: '', type: 'frame' }, applied: [], skipped: [],
      touchedIds: [], removedIds: [], droppedFlows: 0,
    }
  }

  const res = applyOps(page.root, ops)
  page.root = res.root

  const dead = new Set(res.removedIds)
  const before = cloned.flows.length
  if (dead.size) cloned.flows = cloned.flows.filter((f) => !dead.has(f.from))
  const droppedFlows = before - cloned.flows.length

  return { ...res, design: cloned, droppedFlows }
}

/**
 * 仅把 ops 应用到单页（不碰 flows），用于 UI 的「优化后」实时预览。
 */
export function previewOps(page: Page, ops: EditOp[]): Node {
  return applyOps(page.root, ops).root
}

/* ================================================================= */
/* 5. 规则化自动诊断（「自动优化」的本地可用路径）                     */
/* ================================================================= */

export type DiagnosticDimension = 'hierarchy' | 'spacing' | 'consistency' | 'spec' | 'readability' | 'redundancy'

export const DIMENSION_META: Array<{ id: DiagnosticDimension; label: string; desc: string }> = [
  { id: 'hierarchy', label: '视觉层次', desc: '字阶数量与对比是否服务于信息优先级' },
  { id: 'spacing', label: '间距节奏', desc: '间距是否落在 Token 阶梯或 4px 栅格上' },
  { id: 'consistency', label: '一致性', desc: '同类元素（按钮、卡片…）样式是否统一' },
  { id: 'spec', label: '规范符合度', desc: '复用 F-ST-01 的规范漂移检测' },
  { id: 'readability', label: '可读性', desc: '行高比、字号下限' },
  { id: 'redundancy', label: '冗余结构', desc: '空占位与无意义嵌套' },
]

export interface Suggestion {
  id: string
  dimension: DiagnosticDimension
  severity: 'info' | 'warn'
  /** 问题 */
  title: string
  /** 建议 */
  advice: string
  /** 影响元素 id */
  nodeIds: string[]
  /** 可直接应用的补丁；为空表示「仅供参考，需人工处理」 */
  op?: EditOp
}

/** 单页建议上限，避免大页面把面板刷爆 */
export const MAX_SUGGESTIONS = 60

/** 判断数值是否落在「间距阶梯」上：Token space 值，或 4 的倍数（常见栅格） */
export function onSpacingScale(v: number, spaceValues: number[]): boolean {
  if (!Number.isFinite(v) || v <= 0) return true
  if (spaceValues.some((s) => Math.abs(s - v) < 0.01)) return true
  return Math.abs(v % 4) < 0.01
}

/** 最近的 space Token 值 */
export function nearestSpaceToken(v: number, spaceValues: number[]): number | null {
  if (!spaceValues.length || !Number.isFinite(v)) return null
  let best = spaceValues[0]
  for (const s of spaceValues) if (Math.abs(s - v) < Math.abs(best - v)) best = s
  return best
}

/** 按 `style.fill` / `style.textColor` / `style.stroke.color` 路径构造 style 补丁 */
function stylePatchFor(path: string, value: unknown): Style | null {
  if (path === 'style.fill') return { fill: value as Style['fill'] }
  if (path === 'style.textColor') return { textColor: value as Style['textColor'] }
  if (path === 'style.stroke.color') return { stroke: { color: value as never } }
  return null
}

/** 由漂移 issue 推导可执行补丁（无法安全自动修的返回 null） */
function opForDriftIssue(issue: DriftIssue): EditOp | null {
  if (issue.kind === 'literal-color' && issue.suggestion) {
    const style = stylePatchFor(issue.path, issue.suggestion)
    return style ? { op: 'update', id: issue.nodeId, style } : null
  }
  if (issue.kind === 'rule-violation') {
    const id = issue.suggestion
    if (id === 'no-uppercase') return { op: 'update', id: issue.nodeId, style: { textTransform: 'none' } }
    if (id === 'no-shadow') return { op: 'update', id: issue.nodeId, style: { shadow: [] } }
    if (id === 'no-italic') return { op: 'update', id: issue.nodeId, style: { font: { italic: false } } }
    if (id === 'radius-limit') return { op: 'update', id: issue.nodeId, style: { radius: '$radius.md' } }
  }
  // missing-token 需要人工决定替换成什么；off-palette 属规范外新色，不能瞎猜
  return null
}

interface WalkItem {
  node: Node
  parent: Node | null
}

function flatten(root: Node): WalkItem[] {
  const out: WalkItem[] = []
  const walk = (n: Node, parent: Node | null) => {
    out.push({ node: n, parent })
    n.children?.forEach((c) => walk(c, n))
  }
  walk(root, null)
  return out
}

/** 取节点的人话名称，便于建议清单里指认 */
export function nodeLabel(n: Node): string {
  return n.name || String((n.props?.content ?? n.props?.label ?? n.props?.title ?? n.type) ?? n.id)
}

/**
 * 规则化诊断单页，产出「可勾选采纳」的建议清单。
 * 纯函数；不调用模型 —— 没有模型配置时「自动优化」依然可用。
 */
export function diagnosePage(design: DesignJSON, page: Page): Suggestion[] {
  const out: Suggestion[] = []
  const items = flatten(page.root)
  const tokens = tokensForPage(design, page)
  const spaceValues = Object.values(tokens.space ?? {}).filter((v): v is number => typeof v === 'number')
  const push = (s: Omit<Suggestion, 'id'>) => {
    if (out.length >= MAX_SUGGESTIONS) return
    out.push({ ...s, id: `sg_${out.length + 1}` })
  }

  /* ---- ① 视觉层次：字阶数量与对比 ---- */
  const textNodes = items.filter((i) => i.node.type === 'text' && typeof i.node.style?.font?.size === 'number')
  const sizes = [...new Set(textNodes.map((i) => i.node.style!.font!.size!))].sort((a, b) => a - b)
  if (sizes.length > 5) {
    push({
      dimension: 'hierarchy',
      severity: 'info',
      title: `字阶过多（${sizes.length} 种：${sizes.join('/')}）`,
      advice: '建议收敛到 4 档以内（标题 / 小标题 / 正文 / 说明），层次更清晰',
      nodeIds: textNodes.map((i) => i.node.id).slice(0, 12),
    })
  }
  if (sizes.length >= 2) {
    const ratio = sizes[sizes.length - 1] / sizes[0]
    if (ratio < 1.3) {
      push({
        dimension: 'hierarchy',
        severity: 'warn',
        title: `字阶对比不足（最大/最小 = ${ratio.toFixed(2)}）`,
        advice: '标题与正文的对比建议大于 1.5 倍，否则层级难以一眼分辨',
        nodeIds: textNodes.map((i) => i.node.id).slice(0, 12),
      })
    }
  }

  /* ---- ② 间距节奏：不在阶梯 / 4px 栅格上的间距 ---- */
  for (const { node } of items) {
    const gap = node.layout?.gap
    if (typeof gap === 'number' && !onSpacingScale(gap, spaceValues)) {
      const near = nearestSpaceToken(gap, spaceValues)
      push({
        dimension: 'spacing',
        severity: 'warn',
        title: `间距 ${gap} 不在节奏上（${nodeLabel(node)}）`,
        advice: near != null ? `吸附到最近的间距档位 ${near}` : '建议使用统一的间距阶梯',
        nodeIds: [node.id],
        op: near != null ? { op: 'update', id: node.id, layout: { gap: near } } : undefined,
      })
    }
    for (const key of ['t', 'r', 'b', 'l'] as const) {
      const v = node.layout?.padding?.[key]
      if (typeof v === 'number' && !onSpacingScale(v, spaceValues)) {
        const near = nearestSpaceToken(v, spaceValues)
        push({
          dimension: 'spacing',
          severity: 'warn',
          title: `内边距 ${v} 不在节奏上（${nodeLabel(node)}）`,
          advice: near != null ? `吸附到最近的间距档位 ${near}` : '建议使用统一的间距阶梯',
          nodeIds: [node.id],
          op: near != null ? { op: 'update', id: node.id, layout: { padding: { [key]: near } } } : undefined,
        })
      }
    }
  }

  /* ---- ③ 一致性：同类元素样式不统一 ---- */
  const CONSISTENT_TYPES: NodeType[] = ['button', 'input', 'badge', 'tag', 'chip', 'card', 'listItem', 'avatar']
  for (const type of CONSISTENT_TYPES) {
    const group = items.filter((i) => i.node.type === type)
    if (group.length < 2) continue
    for (const field of ['radius', 'fill', 'textColor'] as const) {
      const withField = group.filter((i) => i.node.style?.[field] != null)
      if (withField.length < 2) continue
      const values = [...new Set(withField.map((i) => JSON.stringify(i.node.style![field])))]
      if (values.length < 2) continue
      // 取出现次数最多的值作为统一基准
      const counts = new Map<string, number>()
      withField.forEach((i) => {
        const k = JSON.stringify(i.node.style![field])
        counts.set(k, (counts.get(k) ?? 0) + 1)
      })
      const [majority] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
      const majorityValue = JSON.parse(majority)
      const minority = withField.filter((i) => JSON.stringify(i.node.style![field]) !== majority)
      push({
        dimension: 'consistency',
        severity: minority.length > withField.length / 2 ? 'warn' : 'info',
        title: `${group.length} 个「${type}」的 ${field} 有 ${values.length} 种取值`,
        advice: `统一为最常用的 ${String(majorityValue)}，同类元素外观保持一致`,
        nodeIds: minority.map((i) => i.node.id),
        op:
          minority.length === 1
            ? { op: 'update', id: minority[0].node.id, style: { [field]: majorityValue } as Style }
            : undefined,
      })
    }
  }

  /* ---- ④ 可读性：行高比 / 字号下限 ---- */
  for (const { node } of textNodes) {
    const f = node.style!.font!
    if (typeof f.lineHeight === 'number' && f.size! > 0) {
      const r = f.lineHeight / f.size!
      if (r < 1.25) {
        const target = Math.round(f.size! * 1.5)
        push({
          dimension: 'readability',
          severity: 'warn',
          title: `行高偏紧（${r.toFixed(2)} 倍，${nodeLabel(node)}）`,
          advice: `正文行高建议 1.4~1.6 倍，可调整为 ${target}px`,
          nodeIds: [node.id],
          op: { op: 'update', id: node.id, style: { font: { lineHeight: target } } },
        })
      }
    }
    if (f.size! < 12) {
      push({
        dimension: 'readability',
        severity: 'info',
        title: `字号过小（${f.size}px，${nodeLabel(node)}）`,
        advice: '移动端正文建议不小于 12px，以免影响可读性',
        nodeIds: [node.id],
      })
    }
  }

  /* ---- ⑤ 冗余结构：空容器 ---- */
  for (const { node, parent } of items) {
    if (!parent) continue
    if ((node.type === 'frame' || node.type === 'group') && !(node.children ?? []).length) {
      push({
        dimension: 'redundancy',
        severity: 'info',
        title: `空容器「${nodeLabel(node)}」`,
        advice: '没有子节点的容器不产生任何视觉输出，可删除以减少嵌套层级',
        nodeIds: [node.id],
        op: { op: 'remove', id: node.id },
      })
    }
  }

  /* ---- ⑥ 规范符合度：复用 F-ST-01 漂移检测 ---- */
  const drift = detectDrift(design, [page.id])
  for (const issue of drift.issues) {
    const op = opForDriftIssue(issue)
    push({
      dimension: 'spec',
      severity: op ? 'warn' : 'info',
      title: `${issue.message}（${issue.nodeName || issue.nodeId}）`,
      advice: op ? '可一键改为规范内的 Token 引用' : '需要人工确认目标值',
      nodeIds: [issue.nodeId],
      op: op ?? undefined,
    })
  }

  return out
}

/** 从建议清单里收集可执行的 ops */
export function opsFromSuggestions(suggestions: Suggestion[]): EditOp[] {
  return suggestions.filter((s) => s.op).map((s) => s.op as EditOp)
}

/* ================================================================= */
/* 6. 意图保全与二次确认                                              */
/* ================================================================= */

export interface SafetyReport {
  /** 丢失的文案信息点（优化前有、优化后没有） */
  removedInfoPoints: string[]
  /** 语义类型被改变的节点 */
  typeChanges: Array<{ id: string; from: NodeType; to: NodeType }>
  /** 变更（新增/删除/内容不同）的节点数 */
  changedNodes: number
  totalBefore: number
  totalAfter: number
  /** 变更节点占优化前节点数的比例 */
  changeRatio: number
  /** 是否满足「信息点未丢失 + 语义类型未改变」 */
  safe: boolean
  /** 是否需要二次确认（不安全，或改动幅度超过阈值） */
  needsConfirm: boolean
}

/** 大改阈值：变更节点数占比超过该值即需二次确认 */
export const BIG_CHANGE_RATIO = 0.5

function textPointsOf(root: Node): Map<string, string> {
  const out = new Map<string, string>()
  for (const { node } of flatten(root)) {
    const p = node.props ?? {}
    const raw = [p.content, p.label, p.title, p.placeholder].find((v) => typeof v === 'string' && v.trim())
    if (typeof raw === 'string' && raw.trim()) out.set(node.id, raw.trim())
  }
  return out
}

/**
 * 节点「自身」签名（不含子树）。
 *
 * 为什么不能直接 `JSON.stringify(node)`：那样父节点的字符串里必然包含子节点，
 * 于是**任意一个叶子被改动都会把它的全部祖先也标成「已改动」**，
 * 改动比例被系统性地放大（3 个节点改 1 个叶子 → 2/3 > 0.5 → 误报「大改」）。
 * 去掉 children 后，统计的才是「真正被改动/新增/删除的节点数」。
 */
function nodeSignature(n: Node): string {
  const { children: _children, ...rest } = n
  return JSON.stringify(rest)
}

/**
 * 意图保全校验（对齐 enhancer.ts 的 R-13 红线思路）：
 *  · 信息点：原有文案不得凭空消失；
 *  · 语义类型：按钮还是按钮（不得把 button 变成 text）；
 *  · 改动幅度：变更节点数 > 50% 时视为大改，需二次确认。
 */
export function checkOpSafety(before: Node, after: Node): SafetyReport {
  const beforePoints = textPointsOf(before)
  const afterTexts = new Set([...textPointsOf(after).values()])
  const removedInfoPoints = [...beforePoints.values()].filter((t) => !afterTexts.has(t))

  const beforeNodes = flatten(before)
  const afterNodes = flatten(after)
  const beforeMap = new Map(beforeNodes.map((i) => [i.node.id, i.node]))
  const afterMap = new Map(afterNodes.map((i) => [i.node.id, i.node]))

  const typeChanges: SafetyReport['typeChanges'] = []
  for (const [id, nb] of afterMap) {
    const na = beforeMap.get(id)
    if (na && na.type !== nb.type) typeChanges.push({ id, from: na.type, to: nb.type })
  }

  let changedNodes = 0
  for (const [id, nb] of afterMap) {
    const na = beforeMap.get(id)
    if (!na) changedNodes++
    else if (nodeSignature(na) !== nodeSignature(nb)) changedNodes++
  }
  for (const id of beforeMap.keys()) if (!afterMap.has(id)) changedNodes++

  const totalBefore = beforeNodes.length
  const changeRatio = totalBefore ? changedNodes / totalBefore : 0
  const safe = removedInfoPoints.length === 0 && typeChanges.length === 0

  return {
    removedInfoPoints,
    typeChanges,
    changedNodes,
    totalBefore,
    totalAfter: afterNodes.length,
    changeRatio,
    safe,
    needsConfirm: !safe || changeRatio > BIG_CHANGE_RATIO,
  }
}

/* ================================================================= */
/* 7. op 的人类可读描述（勾选清单用）                                 */
/* ================================================================= */

export interface OpDescription {
  kind: EditOpKind
  /** 面向用户的一句话 */
  label: string
  /** 目标节点 id 列表 */
  targets: string[]
}

const OP_KIND_LABEL: Record<EditOpKind, string> = {
  update: '修改样式',
  add: '新增元素',
  remove: '删除元素',
  replaceContent: '改写文案',
}

export function describeOp(op: EditOp, root?: Node): OpDescription {
  const nameOf = (id: string) => {
    const n = root ? findNodeInTree(root, id) : null
    return n ? nodeLabel(n) : id
  }

  if (op.op === 'update') {
    const parts: string[] = []
    if (op.style) parts.push(`样式 ${Object.keys(op.style).join('、')}`)
    if (op.layout) parts.push(`布局 ${Object.keys(op.layout).join('、')}`)
    if (op.props) parts.push(`属性 ${Object.keys(op.props).join('、')}`)
    return { kind: op.op, label: `修改「${nameOf(op.id)}」的 ${parts.join('，')}`, targets: [op.id] }
  }
  if (op.op === 'add') {
    return {
      kind: op.op,
      label: `在「${nameOf(op.parent)}」${op.index == null ? '末尾' : `第 ${op.index} 位`}新增元素`,
      targets: [op.parent],
    }
  }
  if (op.op === 'remove') {
    return { kind: op.op, label: `删除「${nameOf(op.id)}」`, targets: [op.id] }
  }
  const brief = op.content.length > 18 ? `${op.content.slice(0, 18)}…` : op.content
  return { kind: op.op, label: `把「${nameOf(op.id)}」文案改为「${brief}」`, targets: [op.id] }
}

export function opKindLabel(kind: EditOpKind): string {
  return OP_KIND_LABEL[kind]
}

/* ================================================================= */
/* 8. AI 优化（走 buildEditPrompt + askJson）                         */
/* ================================================================= */

export interface OptimizePlan {
  ops: EditOp[]
  explanation: string
  /** 模型输出被丢弃的条目告警 */
  warnings: string[]
  /** 本次若为自动优化，附上本地诊断结果 */
  diagnosis?: Suggestion[]
}

const OPTIMIZE_SYSTEM = '你是 Design JSON 编辑助手，只输出 JSON 补丁。'

/** 把设计裁剪到「与当前页相关」的子集，避免整库页面把上下文撑爆 */
function slimDesign(design: DesignJSON, page: Page): DesignJSON {
  const tokens = tokensForPage(design, page)
  return {
    schemaVersion: design.schemaVersion,
    meta: design.meta,
    tokens: tokens as DesignJSON['tokens'],
    assets: [],
    pages: [page],
    flows: design.flows.filter((f) => f.fromPage === page.id),
    ...(design.specs ? { specs: design.specs } : {}),
  } as DesignJSON
}

/** 把本地诊断结果转成给模型的指令（自动优化路径） */
export function instructionFromDiagnosis(suggestions: Suggestion[], limit = 20): string {
  if (!suggestions.length) {
    return '请在不改变任何信息点的前提下，提升本页面的视觉层次（字阶对比）、间距节奏与元素一致性，只做最小必要的调整。'
  }
  const lines = suggestions.slice(0, limit).map((s, i) => `${i + 1}. [${s.dimension}] ${s.title} → ${s.advice}`)
  return `请针对下列诊断结果做**最小改动**的优化（不要顺手改其它内容，不要删除任何信息点）：\n${lines.join('\n')}`
}

export interface OptimizeArgs {
  configId: string
  design: DesignJSON
  pageId: string
  /** 用户指令；自动优化路径可不传（由诊断结果合成） */
  instruction?: string
  /** 用户当前选中的节点 id（提示模型聚焦范围） */
  selectedIds?: string[]
  /** 自动优化：无指令时用本地诊断结果合成指令 */
  auto?: boolean
}

/**
 * 调用模型产出一份 ops 补丁（两条入口共用的唯一出口）。
 * 复用 `buildEditPrompt()`（此前零调用方的死代码）+ `TEMP.edit` 温度档 + askJson 容错范式。
 */
export async function optimizePage(args: OptimizeArgs): Promise<OptimizePlan> {
  const { configId, design, pageId, selectedIds = [], auto = false } = args
  const page = design.pages.find((p) => p.id === pageId)
  if (!page) throw new Error('页面不存在')

  let diagnosis: Suggestion[] | undefined
  let instruction = (args.instruction ?? '').trim()

  if (!instruction) {
    if (!auto) throw new Error('请先输入优化指令')
    diagnosis = diagnosePage(design, page)
    instruction = instructionFromDiagnosis(diagnosis)
  }

  const payload = await askJson({
    configId,
    system: OPTIMIZE_SYSTEM,
    user: buildEditPrompt(slimDesign(design, page), instruction, selectedIds),
    temperature: TEMP.edit,
    validate: (o) => {
      const v = validateOpsPayload(o)
      return { ok: v.ok, errors: v.errors }
    },
    maxTokens: 4096,
    stageName: '页面优化',
  })

  const { ops, warnings } = repairOpsPayload(payload)
  if (!ops.length) throw new Error('模型未返回任何可用的改动')

  const explanation =
    typeof (payload as Record<string, unknown>).explanation === 'string'
      ? String((payload as Record<string, unknown>).explanation)
      : 'AI 优化'

  return { ops, explanation, warnings, diagnosis }
}

/** 本次优化的操作类型分布（UI 摘要用） */
export function opKindCounts(ops: EditOp[]): Record<EditOpKind, number> {
  const out: Record<EditOpKind, number> = { update: 0, add: 0, remove: 0, replaceContent: 0 }
  ops.forEach((o) => {
    out[o.op] += 1
  })
  return out
}

/** 供测试与 UI 复用：当前页生效的 TokenMap */
export function tokenMapOfPage(design: DesignJSON, page: Page): TokenMap {
  return buildTokenMap(tokensForPage(design, page))
}
