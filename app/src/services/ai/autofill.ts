// src/services/ai/autofill.ts —— F-ST-02 页面自动补全
//
// 两个独立子能力：
//   2A · 页面补全：断链检测 → 建议补页清单 →（用户勾选后）复用阶段 C 生成
//   2B · 动效与交互补全：本地规则填充 Node.states + 自动推理 flows
//
// 设计原则（对齐 optimize.ts）：
//   · 纯函数、不 import store / react —— 便于单测，UI 层负责把结果交给 commit()
//   · 规则优先：2B 绝大部分零模型依赖（零延迟 / 零成本 / 100% 确定）
//   · 不做静默改写：所有产出都是「建议」，需用户勾选后才落盘
import type { DesignJSON, Node, Page, Flow, StateOverride, Style } from '@shared/design'
import type { TokenMap } from '@/services/render/tokens'
import { resolveColor } from '@/services/render/tokens'
import { normalizeFlows } from './parse'

/* ====================================================================== */
/*                              通用小工具                                 */
/* ====================================================================== */

/** 深度优先遍历子树（含自身） */
export function walkNodes(root: Node, visit: (n: Node) => void): void {
  if (!root) return
  visit(root)
  for (const c of root.children ?? []) walkNodes(c, visit)
}

/** 找节点——先查给定页，未指定则全项目查 */
export function findNode(design: Pick<DesignJSON, 'pages'>, id: string, pageId?: string): Node | null {
  const pages = pageId ? design.pages.filter((p) => p.id === pageId) : design.pages
  for (const p of pages) {
    let hit: Node | null = null
    walkNodes(p.root, (n) => {
      if (n.id === id) hit = n
    })
    if (hit) return hit
  }
  return null
}

/** 节点上最适合展示给用户的文案 */
export function nodeLabel(node: Node): string {
  const p = (node.props ?? {}) as Record<string, unknown>
  const raw = p.label ?? p.content ?? p.text ?? p.title ?? p.placeholder ?? p.value
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  if (node.name) return node.name
  return node.type
}

/** 深拷贝（结构简单，JSON 往返足够且不会引入分享引用） */
export function cloneTree<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/* ====================================================================== */
/*                       2B-① 本地规则：states 填充                        */
/* ====================================================================== */

/** 一条待填的 state 建议 */
export interface StateSuggestion {
  /** 稳定标识：`${pageId}:${nodeId}:${state}` */
  id: string
  pageId: string
  pageName: string
  nodeId: string
  nodePath: string
  nodeType: Node['type']
  nodeLabel: string
  state: 'hover' | 'active' | 'focus'
  /** 该状态将写入的样式（Token 引用形式，保证换肤一致） */
  style: Style
  /** 人类可读的说明 */
  label: string
}

/** 五类元素的规则映射（严格对应设计文档 §3.3.2 表格） */
type RuleFn = (node: Node, map: TokenMap) => Array<{ state: StateSuggestion['state']; style: Style; label: string }>

/** 取一个「比当前色深/浅一档」的兜底色 —— 优先用 Token 里现成的语义色 */
function pickColor(map: TokenMap, preferred: string[], fallback: string): string {
  for (const k of preferred) if (map.color[k]) return `$color.${k}`
  return fallback
}

function currentFill(node: Node): unknown {
  return node.style?.fill
}

const RULES: Partial<Record<Node['type'], RuleFn>> = {
  /** button —— hover 提亮、active 加深、focus 外发光 */
  button: (node, map) => {
    const base = currentFill(node)
    // 只有「主色系」按钮才提亮，避免把白底按钮改成蓝色
    const isPrimary = !base || base === '$color.primary'
    const out: Array<{ state: StateSuggestion['state']; style: Style; label: string }> = []
    if (isPrimary) {
      out.push({
        state: 'hover',
        style: { fill: pickColor(map, ['primaryHover'], 'rgba(0,0,0,0.06)') },
        label: '悬停时提亮底色，给出「可点击」反馈',
      })
      out.push({
        state: 'active',
        style: { fill: pickColor(map, ['primaryActive', 'primaryHover'], 'rgba(0,0,0,0.12)') },
        label: '按下时进一步加深，形成压感',
      })
    } else {
      out.push({
        state: 'hover',
        style: { fill: pickColor(map, ['surfaceAlt'], 'rgba(0,0,0,0.04)') },
        label: '悬停时轻微加底色',
      })
    }
    out.push({
      state: 'focus',
      style: {
        stroke: { color: '$color.primary' },
        shadow: [{ x: 0, y: 0, blur: 0, spread: 3, color: 'rgba(59,130,246,0.35)' }],
      },
      label: '聚焦时主色描边 + 外发光，满足键盘可达性',
    })
    return out
  },

  /** card / listItem —— hover 阴影升一档 + 手型光标 */
  card: (node) => [
    {
      state: 'hover',
      style: {
        shadow: [{ x: 0, y: 6, blur: 20, spread: 0, color: 'rgba(0,0,0,0.12)' }],
        cursor: 'pointer',
      },
      label: '悬停时阴影升一档并显示手型，暗示整卡可点',
    },
  ],
  listItem: (node) => [
    {
      state: 'hover',
      style: { fill: '$color.surfaceAlt', cursor: 'pointer' },
      label: '悬停时列表项加底色并显示手型',
    },
    {
      state: 'active',
      style: { fill: '$color.surfaceAlt' },
      label: '按下时保持底色，避免闪烁',
    },
  ],

  /** input / textarea / select —— focus 主色描边 + 光晕 */
  input: () => [
    {
      state: 'focus',
      style: {
        stroke: { color: '$color.primary' },
        shadow: [{ x: 0, y: 0, blur: 0, spread: 3, color: 'rgba(59,130,246,0.28)' }],
      },
      label: '聚焦时边框转主色并加光晕，明确输入位置',
    },
  ],
  textarea: () => [
    {
      state: 'focus',
      style: {
        stroke: { color: '$color.primary' },
        shadow: [{ x: 0, y: 0, blur: 0, spread: 3, color: 'rgba(59,130,246,0.28)' }],
      },
      label: '聚焦时边框转主色并加光晕',
    },
  ],
  select: () => [
    {
      state: 'focus',
      style: { stroke: { color: '$color.primary' } },
      label: '聚焦时边框转主色',
    },
  ],

  /** switch / checkbox / radio —— active 缩放 0.96 */
  switch: () => [
    { state: 'active', style: { transform: 'scale(0.96)' }, label: '按下时缩放 0.96，给出触感反馈' },
  ],
  checkbox: () => [
    { state: 'active', style: { transform: 'scale(0.96)' }, label: '按下时缩放 0.96，给出触感反馈' },
  ],
  radio: () => [
    { state: 'active', style: { transform: 'scale(0.96)' }, label: '按下时缩放 0.96，给出触感反馈' },
  ],

  /** tag / chip —— hover 背景加深 */
  tag: () => [
    { state: 'hover', style: { fill: '$color.surfaceAlt' }, label: '悬停时背景加深一档' },
  ],
  chip: () => [
    { state: 'hover', style: { fill: '$color.surfaceAlt' }, label: '悬停时背景加深一档' },
  ],
}

/** 规则可覆盖的元素类型（对应设计文档 §3.3.2 的 5 类 / 11 个 type） */
export const RULE_TYPES: Array<Node['type']> = [
  'button', 'card', 'listItem',
  'input', 'textarea', 'select',
  'switch', 'checkbox', 'radio',
  'tag', 'chip',
]

/** 节点是否已有某个 state（避免覆盖用户/模型已写的状态） */
function hasState(node: Node, state: string): boolean {
  return !!node.states?.[state]?.style
}

/** 节点在页面中的可读路径，如「首页 / 顶部栏 / 按钮」 */
function pathOf(page: Page, nodeId: string): string {
  const parts: string[] = []
  const dfs = (n: Node, trail: string[]): boolean => {
    const next = [...trail, n.name || n.type]
    if (n.id === nodeId) {
      parts.push(...next)
      return true
    }
    for (const c of n.children ?? []) if (dfs(c, next)) return true
    return false
  }
  dfs(page.root, [])
  return [page.name, ...parts].join(' / ')
}

/**
 * 为整份设计产出 states 建议（**纯计算，不改动入参**）。
 * 已存在的 state 不会重复建议——用户/模型写过的优先。
 */
export function suggestStates(
  design: Pick<DesignJSON, 'pages'>,
  maps: Map<string, TokenMap>,
): StateSuggestion[] {
  const out: StateSuggestion[] = []
  for (const page of design.pages) {
    const map = maps.get(page.id) ?? { color: {}, space: {}, radius: {}, font: {}, shadow: {} }
    walkNodes(page.root, (n) => {
      const rule = RULES[n.type]
      if (!rule) return
      let produced: ReturnType<RuleFn>
      try {
        produced = rule(n, map)
      } catch {
        return
      }
      for (const p of produced) {
        if (hasState(n, p.state)) continue
        out.push({
          id: `${page.id}:${n.id}:${p.state}`,
          pageId: page.id,
          pageName: page.name,
          nodeId: n.id,
          nodePath: pathOf(page, n.id),
          nodeType: n.type,
          nodeLabel: nodeLabel(n),
          state: p.state,
          style: p.style,
          label: p.label,
        })
      }
    })
  }
  return out
}

/**
 * 把选中的 states 建议应用为一个「新 design」（不可变更新）。
 * 返回新对象，供 UI 层做并排预览 + commit。
 */
export function applyStates(
  design: DesignJSON,
  picked: StateSuggestion[],
): DesignJSON {
  if (!picked.length) return design
  const next = cloneTree(design)

  // 按页面分组，避免每页重复深拷贝
  const byPage = new Map<string, StateSuggestion[]>()
  for (const s of picked) {
    const arr = byPage.get(s.pageId) ?? []
    arr.push(s)
    byPage.set(s.pageId, arr)
  }

  for (const page of next.pages) {
    const list = byPage.get(page.id)
    if (!list?.length) continue
    const byNode = new Map<string, StateSuggestion[]>()
    for (const s of list) {
      const arr = byNode.get(s.nodeId) ?? []
      arr.push(s)
      byNode.set(s.nodeId, arr)
    }
    walkNodes(page.root, (n) => {
      const items = byNode.get(n.id)
      if (!items?.length) return
      const states: Record<string, StateOverride> = { ...(n.states ?? {}) }
      for (const it of items) {
        const prev = states[it.state] ?? {}
        states[it.state] = { ...prev, style: { ...(prev.style ?? {}), ...it.style } }
      }
      n.states = states
    })
  }

  return next
}

/** 统计：一份 design 里已带 states 的节点数（用于 UI 展示覆盖率） */
export function countStatedNodes(design: Pick<DesignJSON, 'pages'>): { nodes: number; stated: number } {
  let nodes = 0
  let stated = 0
  for (const p of design.pages) {
    walkNodes(p.root, (n) => {
      nodes++
      if (n.states && Object.keys(n.states).some((k) => n.states?.[k]?.style)) stated++
    })
  }
  return { nodes, stated }
}

/* ====================================================================== */
/*                        2B-② 本地规则：flows 推理                        */
/* ====================================================================== */

/** 跳转语义关键词 → 目标页名的匹配强度 */
const BACK_WORDS = ['返回', '回退', '←', '‹', 'back']
/** 层级推进语义：命中则用 slide-left 转场 */
const FORWARD_HINTS = ['去', '查看', '详情', '进入', '开始', '下一步', '立即', '提交', '确认', '购买', '下单', '结算', '登录']

/**
 * 文本与页面名的语义匹配（轻量：子串 + 去后缀 + 单字重叠）。
 * 不用模型——原型阶段页面名与 CTA 文案的重合度足够高。
 */
export function matchPageByText(text: string, pages: Page[], fromPageId: string): Page | null {
  const t = (text ?? '').trim()
  if (!t || t.length > 24) return null
  const norm = (s: string) => s.replace(/[\s·—-]/g, '')
  const nt = norm(t)

  let best: { page: Page; score: number } | null = null
  for (const p of pages) {
    if (p.id === fromPageId) continue
    const np = norm(p.name)
    if (!np) continue

    let score = 0
    // ① 页面名完整出现在文案里（「去结算」含「结算」）—— 最强信号
    if (nt.includes(np)) score = 100 - np.length
    // ② 文案去掉动词前缀后等于页面名
    else {
      const stripped = nt.replace(/^(去|进入|查看|打开|跳转到|回到|前往|立即|马上)/, '')
      if (stripped && (stripped === np || np === stripped)) score = 90
      // ③ 页面名去掉「页」后缀后包含
      else {
        const bare = np.replace(/(页|页面|界面)$/, '')
        if (bare.length >= 2 && nt.includes(bare)) score = 70 - bare.length
        else if (np.length >= 2 && nt.includes(np.slice(0, 2))) score = 40
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { page: p, score }
  }
  return best?.page ?? null
}

/** 节点是否携带「返回」语义 */
export function isBackNode(node: Node): boolean {
  const label = nodeLabel(node)
  return BACK_WORDS.some((w) => label.includes(w))
}

/** 一条待确认的 flow 建议 */
export interface FlowSuggestion {
  id: string
  flow: Flow
  fromPageName: string
  toPageName: string
  /** 触发文案，用于 UI 展示「点『去结算』→ 结算页」 */
  triggerLabel: string
  /** 触发分类，UI 可分组 */
  kind: 'back' | 'forward' | 'plain'
  label: string
}

/** 可作为跳转源的节点类型 */
const CLICKABLE: Array<Node['type']> = [
  'button', 'listItem', 'card', 'navbar', 'tabbar', 'breadcrumb', 'pagination', 'text', 'icon',
]

/**
 * 自动推理 flows（**纯计算**）。产出后交给调用方过 `normalizeFlows` 校验。
 * 已存在同 (from,to) 的 flow 不再建议。
 */
export function suggestFlows(design: Pick<DesignJSON, 'pages' | 'flows'>): FlowSuggestion[] {
  const pages = design.pages
  if (pages.length < 2) return []
  const existing = new Set(design.flows.map((f) => `${f.from}->${f.to}`))
  const out: FlowSuggestion[] = []

  for (const page of pages) {
    walkNodes(page.root, (n) => {
      if (!CLICKABLE.includes(n.type)) return
      const label = nodeLabel(n)

      // ① 返回语义 → 优先回到「上一个页面」（按 order 取前一页）
      if (isBackNode(n)) {
        const idx = pages.findIndex((p) => p.id === page.id)
        const prev = pages[idx - 1] ?? pages.find((p) => p.id !== page.id)
        if (prev && !existing.has(`${n.id}->${prev.id}`)) {
          existing.add(`${n.id}->${prev.id}`)
          out.push({
            id: `flow_s_${n.id}`,
            flow: {
              id: `flow_${n.id}`,
              from: n.id,
              fromPage: page.id,
              to: prev.id,
              trigger: 'back',
              transition: 'slide-right',
            },
            fromPageName: page.name,
            toPageName: prev.name,
            triggerLabel: label,
            kind: 'back',
            label: `点「${label}」→ 返回「${prev.name}」`,
          })
        }
        return
      }

      // ② 文案语义匹配
      if (!label || label.length > 24) return
      const target = matchPageByText(label, pages, page.id)
      if (!target) return
      if (existing.has(`${n.id}->${target.id}`)) return

      const forward = FORWARD_HINTS.some((h) => label.includes(h))
      existing.add(`${n.id}->${target.id}`)
      out.push({
        id: `flow_s_${n.id}`,
        flow: {
          id: `flow_${n.id}`,
          from: n.id,
          fromPage: page.id,
          to: target.id,
          trigger: 'click',
          // 层级推进用 slide-left，平级用 fade
          transition: forward ? 'slide-left' : 'fade',
        },
        fromPageName: page.name,
        toPageName: target.name,
        triggerLabel: label,
        kind: forward ? 'forward' : 'plain',
        label: `点「${label}」→ 跳转「${target.name}」`,
      })
    })
  }
  return out
}

/**
 * 校验流程建议：过滤悬空跳转 / 截断至 40 条。
 * 直接复用生成流水线的 normalizeFlows，保证两处口径完全一致。
 */
export function validateFlowSuggestions(
  items: FlowSuggestion[],
  pages: Page[],
): { ok: FlowSuggestion[]; dropped: number } {
  const flows = items.map((i) => i.flow)
  const normalized = normalizeFlows(flows, pages)
  const keep = new Set(normalized.map((f) => f.id))
  const ok = items.filter((i) => keep.has(i.flow.id))
  return { ok, dropped: items.length - ok.length }
}

/** 把选中的 flow 建议合并进 design（去重 + 走 normalizeFlows） */
export function applyFlows(design: DesignJSON, picked: FlowSuggestion[]): DesignJSON {
  if (!picked.length) return design
  const next = cloneTree(design)
  const existing = new Set(next.flows.map((f) => `${f.from}->${f.to}`))
  for (const s of picked) {
    const key = `${s.flow.from}->${s.flow.to}`
    if (existing.has(key)) continue
    existing.add(key)
    next.flows.push(cloneTree(s.flow))
  }
  next.flows = normalizeFlows(next.flows, next.pages)
  return next
}

/* ====================================================================== */
/*                          2A 断链检测与补页建议                          */
/* ====================================================================== */

/** 一条断链 */
export interface BrokenLink {
  /** 'dangling' = flows 指向了不存在的页；'missing-page' = CTA 文案暗示应有页面但不存在 */
  kind: 'dangling' | 'missing-page'
  /** 源页面（dangling 时可能为空，因为目标页没了） */
  fromPageId?: string
  fromPageName?: string
  /** 源节点（missing-page 时有值） */
  fromNodeId?: string
  triggerLabel?: string
  /** dangling：被指向但不存在的 pageId */
  missingPageId?: string
  /** 期望的页面名（用于生成建议） */
  expectedName: string
  detail: string
}

/** 一份补页建议 */
export interface PageSuggestion {
  /** 稳定标识 */
  id: string
  /** 建议新增的页面 id */
  suggestedId: string
  name: string
  purpose: string
  keySections: string[]
  /** 触发本建议的原因 */
  reasons: string[]
  /** 关联的断链 */
  links: BrokenLink[]
  /** 建议页面的落位顺序 */
  order: number
}

/** CTA 文案中「暗示存在某个页面」的动词前缀 */
const CTA_HINTS: Array<{ re: RegExp; purpose: (t: string) => string }> = [
  { re: /^(去|前往|进入|打开)?结算|下单|去支付|立即支付|确认支付|购买|立即购买/, purpose: () => '完成结算与支付' },
  { re: /登录|注册|登入/, purpose: () => '完成身份验证' },
  { re: /详情|查看详情|了解详情/, purpose: () => '展示单条内容的完整信息' },
  { re: /设置|偏好|账号管理/, purpose: () => '管理账号与偏好设置' },
  { re: /我的|个人中心|个人主页/, purpose: () => '用户中心与资产总览' },
  { re: /消息|通知|私信/, purpose: () => '查看消息与通知' },
  { re: /搜索|筛选|查找/, purpose: () => '检索与筛选内容' },
  { re: /编辑|修改|发布|新建|创建/, purpose: () => '创建或编辑内容' },
  { re: /帮助|客服|反馈/, purpose: () => '获取帮助与提交反馈' },
]

/** 从 CTA 文案推断「应该存在」的页面名（返回 null 表示无需补页） */
export function inferMissingPage(text: string): { name: string; purpose: string } | null {
  const t = (text ?? '').trim()
  if (!t || t.length > 20) return null
  for (const hint of CTA_HINTS) {
    if (hint.re.test(t)) {
      // 页面名直接用按钮文案（去掉「去 / 立即」等纯动作前缀），保证用户一眼能对上
      const name = t.replace(/^(去|立即|马上|前往|进入|打开|查看|了解)/, '')
      return { name: name || t, purpose: hint.purpose(t) }
    }
  }
  return null
}

/**
 * 由页面名派生一个安全的 id。
 *
 * 中文无法转写成 ascii slug，而且用时间戳会让 id 每次不同——那样用户重复
 * 打开补全面板、重复采纳同一条建议时，会生成一堆语义重复的页面。
 * 因此改用「名字的稳定哈希」：同名页面永远得到同一个 id，
 * 只有该 id 已被占用时才追加序号（stabilty + collision safety 兼得）。
 */
export function slugifyPageId(name: string, taken: Set<string>): string {
  const base = `page_${hashName(name)}`
  let id = base
  let i = 1
  while (taken.has(id)) id = `${base}_${i++}`
  return id
}

/** djb2 → base36，取 5 位；同名稳定，不同名碰撞概率极低 */
function hashName(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36).padStart(5, '0').slice(-5)
}

/**
 * 断链检测（对应设计文档 §3.3.1）：
 *   ① 遍历 design.flows，收集所有 to 指向的 pageId；
 *   ② 被引用但不存在的页 → 断链（dangling）；
 *   ③ CTA 文案暗示应有页面但不存在 → 建议补页（missing-page）。
 */
export function detectBrokenLinks(design: Pick<DesignJSON, 'pages' | 'flows'>): BrokenLink[] {
  const out: BrokenLink[] = []
  const pageIds = new Set(design.pages.map((p) => p.id))
  const nameOf = (id: string) => design.pages.find((p) => p.id === id)?.name ?? id

  /* ① + ② flows 指向不存在的页 */
  for (const f of design.flows) {
    if (!pageIds.has(f.to)) {
      out.push({
        kind: 'dangling',
        fromPageId: f.fromPage,
        fromPageName: f.fromPage ? nameOf(f.fromPage) : undefined,
        fromNodeId: f.from,
        missingPageId: f.to,
        expectedName: f.to,
        detail: `跳转指向不存在的页面「${f.to}」（源页面「${nameOf(f.fromPage)}」）`,
      })
    }
  }

  /* ③ CTA 文案语义 */
  const suggestedNames = new Set<string>()
  for (const page of design.pages) {
    walkNodes(page.root, (n) => {
      if (!CLICKABLE.includes(n.type)) return
      // 已有跳转的节点不重复建议
      const hasFlow = design.flows.some((f) => f.from === n.id)
      if (hasFlow) return
      const label = nodeLabel(n)
      const inferred = inferMissingPage(label)
      if (!inferred) return
      // 项目里已有语义相近的页面 → 不是缺页，只是没连起来（交给 suggestFlows）。
      // 注意这里刻意传空 fromPageId：判断口径是「全局是否已存在该语义的页面」，
      // 而不是「除当前页之外是否存在」。否则「详情页」里那句描述性文案「详情」，
      // 会因为在 详情页 自身内部而被误判成「缺一个详情页」。
      if (matchPageByText(label, design.pages, '')) return
      const key = inferred.name
      if (suggestedNames.has(key)) return
      suggestedNames.add(key)
      out.push({
        kind: 'missing-page',
        fromPageId: page.id,
        fromPageName: page.name,
        fromNodeId: n.id,
        triggerLabel: label,
        expectedName: inferred.name,
        detail: `「${page.name}」中的「${label}」需要一个「${inferred.name}」承载，但项目中没有该页面`,
      })
    })
  }

  return out
}

/**
 * 断链 → 补页建议清单（按期望页面名聚合，一个缺失页只出一条建议）。
 * 不做静默插入——产出仅用于 UI 勾选。
 */
export function buildPageSuggestions(
  design: Pick<DesignJSON, 'pages' | 'flows' | 'meta'>,
): PageSuggestion[] {
  const links = detectBrokenLinks(design)
  const grouped = new Map<string, PageSuggestion>()
  const taken = new Set(design.pages.map((p) => p.id))

  for (const link of links) {
    const name = link.expectedName
    let item = grouped.get(name)
    if (!item) {
      const inferred = inferMissingPage(name) ?? { name, purpose: '补齐访问链路' }
      item = {
        id: `pg_${name}`,
        suggestedId: slugifyPageId(name, taken),
        name,
        purpose: inferred.purpose,
        keySections: defaultSectionsFor(name, inferred.purpose),
        reasons: [],
        links: [],
        order: design.pages.length + grouped.size,
      }
      taken.add(item.suggestedId)
      grouped.set(name, item)
    }
    item.links.push(link)
    if (!item.reasons.includes(link.detail)) item.reasons.push(link.detail)
  }

  return [...grouped.values()]
}

/** 依据页面用途给出默认区块骨架，喂给阶段 C 的 keySections */
function defaultSectionsFor(name: string, purpose: string): string[] {
  const p = `${name}${purpose}`
  if (/支付|结算|下单/.test(p)) return ['订单摘要', '收货信息', '支付方式', '支付按钮']
  if (/登录|注册/.test(p)) return ['品牌区', '账号输入', '密码输入', '登录按钮', '辅助链接']
  if (/详情/.test(p)) return ['头部图片', '标题与价格', '内容详情', '操作按钮']
  if (/设置|偏好/.test(p)) return ['账号信息', '偏好选项', '退出登录']
  if (/我的|个人中心/.test(p)) return ['用户信息', '资产概览', '功能列表']
  if (/消息|通知/.test(p)) return ['消息列表', '筛选标签']
  if (/搜索/.test(p)) return ['搜索框', '筛选条件', '结果列表']
  if (/编辑|发布|创建|新建/.test(p)) return ['表单区', '提交按钮']
  return ['页面标题', '主要内容区', '操作按钮']
}

/* ====================================================================== */
/*                              与服务层对接                                */
/* ====================================================================== */

/** 调用方需注入的依赖：给定页面 id 返回其生效 TokenMap */
export type MapResolver = (page: Page) => TokenMap

/** 一次性汇总当前设计的全部补全建议（UI 打开浮层时调用） */
export interface AutofillPlan {
  pages: PageSuggestion[]
  brokenLinks: BrokenLink[]
  states: StateSuggestion[]
  flows: FlowSuggestion[]
  /** flows 被 normalizeFlows 丢弃的条数（透明告知用户） */
  droppedFlows: number
}

export function buildAutofillPlan(design: DesignJSON, resolveMap: MapResolver): AutofillPlan {
  const maps = new Map<string, TokenMap>()
  for (const p of design.pages) maps.set(p.id, resolveMap(p))

  const rawFlows = suggestFlows(design)
  const { ok, dropped } = validateFlowSuggestions(rawFlows, design.pages)

  return {
    pages: buildPageSuggestions(design),
    brokenLinks: detectBrokenLinks(design),
    states: suggestStates(design, maps),
    flows: ok,
    droppedFlows: dropped,
  }
}

/** 供 UI 显示：把 states 建议里的 Token 引用解成真实色值（预览用） */
export function resolveStateStyle(style: Style | undefined, map: TokenMap): Record<string, string> {
  const out: Record<string, string> = {}
  if (!style) return out
  if (typeof style.fill === 'string' || style.fill != null) {
    out.background = resolveColor(style.fill, map, 'transparent')
  }
  if (style.stroke?.color) out.borderColor = resolveColor(style.stroke.color, map, 'transparent')
  if (style.cursor) out.cursor = style.cursor
  if (style.opacity != null) out.opacity = String(style.opacity)
  return out
}
