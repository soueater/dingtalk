// src/services/ai/parse.ts
// 五级容错：抽取 → 宽松解析 → 结构校验 → 语义修补 → 修复重试
import type { DesignJSON, InterfaceQuota, Node, Page, PageGroup } from '@shared/design'
import { DEFAULT_QUOTA, SCHEMA_VERSION } from '@shared/design'
import { emptyPage } from '@/services/mock/projects'
import { DEVICE_CANVAS } from '@/services/design/style-presets'

/* ---------------------------- 1. 抽取 ---------------------------- */

/** 从模型输出中抠出 JSON 片段 */
export function extractJson(raw: string): string | null {
  let s = raw.trim()

  // 去代码围栏
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(s)
  if (fence) s = fence[1].trim()

  // 直接是 JSON
  if (s.startsWith('{') || s.startsWith('[')) {
    const balanced = balanceSlice(s)
    if (balanced) return balanced
  }

  // 扫描第一个 { 到配对的 }
  const start = s.indexOf('{')
  if (start < 0) return null
  const candidate = s.slice(start)
  return balanceSlice(candidate)
}

/** 括号配对截取（跳过字符串内的括号） */
function balanceSlice(s: string): string | null {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return s.slice(0, i + 1)
    }
  }
  return null
}

/* ------------------------- 2. 宽松解析 ------------------------- */

/** 修复常见 JSON 瑕疵后解析 */
export function lenientParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    /* 继续尝试修复 */
  }

  let fixed = s
    // 去掉行尾逗号
    .replace(/,\s*([}\]])/g, '$1')
    // 中文引号 → 英文
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    // 单引号键 → 双引号（简单场景）
    .replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3')
    // 未转义换行
    .replace(/:\s*"([^"]*)\n([^"]*)"/g, (_m, a, b) => `: "${a}\\n${b}"`)

  // 截断补救：补齐未闭合的括号
  fixed = closeBrackets(fixed)

  try {
    return JSON.parse(fixed)
  } catch {
    return null
  }
}

function closeBrackets(s: string): string {
  let inStr = false
  let esc = false
  const stack: string[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{' || c === '[') stack.push(c)
    else if (c === '}' || c === ']') stack.pop()
  }
  if (inStr) s += '"'
  while (stack.length) {
    const open = stack.pop()
    s += open === '{' ? '}' : ']'
  }
  // 再次去掉可能新产生的尾逗号
  return s.replace(/,\s*([}\]])/g, '$1')
}

/* ------------------------- 3. 结构校验 ------------------------- */

export interface ValidateResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

export function validatePagePayload(o: unknown): ValidateResult {
  const errors: string[] = []
  const warnings: string[] = []
  const obj = o as Record<string, unknown> | null

  if (!obj || typeof obj !== 'object') {
    return { ok: false, errors: ['输出不是对象'], warnings }
  }
  const page = obj.page as Record<string, unknown> | undefined
  if (!page) errors.push('缺少 page 字段')
  else {
    if (!page.root) errors.push('page 缺少 root')
    else if ((page.root as Node).type !== 'frame') warnings.push('root 不是 frame，已自动包裹')
  }
  if (obj.flows && !Array.isArray(obj.flows)) warnings.push('flows 不是数组，已忽略')

  return { ok: errors.length === 0, errors, warnings }
}

export function validatePlanPayload(o: unknown): ValidateResult {
  const errors: string[] = []
  const warnings: string[] = []
  const obj = o as Record<string, unknown> | null
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['输出不是对象'], warnings }
  if (!Array.isArray(obj.pages) || !(obj.pages as unknown[]).length) {
    // 文案需明确指向「页面规划缺失」，避免用户误以为是 JSON 语法错误
    errors.push('规划结果未包含任何页面（pages 缺失或为空数组）')
  } else if ((obj.pages as Array<{ keySections?: unknown }>).some((p) => !Array.isArray(p.keySections))) {
    warnings.push('部分页面缺少 keySections，已补空数组')
  }
  return { ok: errors.length === 0, errors, warnings }
}

/**
 * 校验变体载荷。
 * 与 validatePagePayload 的差别：变体是「一次产出多个页面树」，
 * 只要有**至少一个**能用的变体就算通过——某个变体残缺不应该让整批失败
 * （残缺的个体在 repairVariantsPayload 里降级成带 error 的占位项）。
 */
export function validateVariantPayload(o: unknown): ValidateResult {
  const errors: string[] = []
  const warnings: string[] = []
  const obj = o as Record<string, unknown> | null
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['输出不是对象'], warnings }

  const list = obj.variants
  if (!Array.isArray(list) || !list.length) {
    // 这条文案会直接显示给用户，需说清「模型没给变体」而不是「JSON 坏了」
    errors.push('未返回任何变体（variants 缺失或为空数组）')
    return { ok: false, errors, warnings }
  }

  const usable = list.filter((v) => v && typeof v === 'object' && (v as Record<string, unknown>).root)
  if (!usable.length) {
    errors.push('所有变体都缺少 root 字段')
    return { ok: false, errors, warnings }
  }
  if (usable.length < list.length) {
    warnings.push(`${list.length - usable.length} 个变体缺少 root，已忽略`)
  }
  return { ok: true, errors, warnings }
}

/* ------------------------- 4. 语义修补 ------------------------- */

let seq = 0
const uid = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`

const CONTAINER_TYPES = new Set([
  'frame', 'group', 'card', 'list', 'listItem', 'modal', 'drawer', 'tabs', 'accordion',
  'table', 'tableRow', 'tableCell', 'page',
])

const KNOWN_TYPES = new Set([
  'frame', 'group', 'text', 'image', 'icon', 'divider', 'shape', 'button', 'input',
  'textarea', 'checkbox', 'radio', 'switch', 'slider', 'select', 'avatar', 'badge',
  'tag', 'chip', 'progress', 'skeleton', 'navbar', 'tabbar', 'sidebar', 'breadcrumb',
  'stepper', 'card', 'list', 'listItem', 'table', 'tableRow', 'tableCell', 'modal',
  'drawer', 'tooltip', 'toast', 'accordion', 'tabs', 'chart', 'map', 'calendar',
  'searchbar', 'pagination', 'empty',
])

/** 修正单个节点及其子树：补 id / 补 type / 递归 children */
export function repairNode(input: unknown, depth = 0): Node {
  const n = (input ?? {}) as Record<string, unknown>
  const rawType = String(n.type ?? 'frame')
  const type = (KNOWN_TYPES.has(rawType) ? rawType : 'frame') as Node['type']

  const node: Node = {
    id: typeof n.id === 'string' && n.id ? n.id : uid(type),
    type,
  }

  if (typeof n.name === 'string') node.name = n.name

  // layout
  const l = (n.layout ?? {}) as Record<string, unknown>
  const layout: Node['layout'] = {}
  if (l.mode === 'flex' || l.mode === 'grid' || l.mode === 'absolute') layout.mode = l.mode
  if (depth > 0 && !layout.mode) layout.mode = CONTAINER_TYPES.has(type) ? 'flex' : undefined
  if (l.direction === 'row' || l.direction === 'column') layout.direction = l.direction
  if (l.width !== undefined) layout.width = l.width as never
  if (l.height !== undefined) layout.height = l.height as never
  if (typeof l.gap === 'number') layout.gap = l.gap
  if (typeof l.grow === 'number') layout.grow = l.grow
  if (typeof l.x === 'number') layout.x = l.x
  if (typeof l.y === 'number') layout.y = l.y
  if (typeof l.justify === 'string') layout.justify = l.justify as never
  if (typeof l.align === 'string') layout.align = l.align as never
  if (l.padding && typeof l.padding === 'object') layout.padding = l.padding as never

  // 根容器兜底：撑满画布
  if (depth === 0) {
    layout.mode = 'flex'
    layout.direction = layout.direction ?? 'column'
    layout.width = 'fill'
    layout.height = 'fill'
  }

  if (Object.keys(layout).length) node.layout = layout

  // style
  if (n.style && typeof n.style === 'object') node.style = n.style as Node['style']
  if (n.props && typeof n.props === 'object') node.props = n.props as Record<string, unknown>

  // children
  if (Array.isArray(n.children) && n.children.length) {
    node.children = n.children.map((c) => repairNode(c, depth + 1))
  } else if (CONTAINER_TYPES.has(type) && depth > 0 && (n.children == null || Array.isArray(n.children))) {
    node.children = []
  }

  return node
}

/** 修补单个页面的载荷 */
export function repairPagePayload(o: unknown, fallbackPageId: string): {
  page: Page
  flows: DesignJSON['flows']
  warnings: string[]
} {
  const warnings: string[] = []
  const obj = (o ?? {}) as Record<string, unknown>
  const raw = (obj.page ?? {}) as Record<string, unknown>

  const id = typeof raw.id === 'string' && raw.id ? raw.id : fallbackPageId
  const name = typeof raw.name === 'string' && raw.name ? raw.name : '页面'
  const order = typeof raw.order === 'number' ? raw.order : 0

  let root: Node
  if (raw.root && typeof raw.root === 'object') {
    root = repairNode(raw.root, 0)
  } else if (raw.root) {
    root = repairNode({ type: 'frame', children: [raw.root] }, 0)
    warnings.push('root 结构异常，已包裹为 frame')
  } else {
    root = emptyPage().root
    warnings.push('缺少 root，已生成空白根容器')
  }

  const flows: DesignJSON['flows'] = []
  if (Array.isArray(obj.flows)) {
    for (const f of obj.flows as Array<Record<string, unknown>>) {
      if (typeof f.from !== 'string' || typeof f.to !== 'string') continue
      flows.push({
        id: typeof f.id === 'string' ? f.id : uid('flow'),
        from: f.from,
        fromPage: typeof f.fromPage === 'string' ? f.fromPage : id,
        to: f.to,
        trigger: (f.trigger as DesignJSON['flows'][number]['trigger']) ?? 'click',
        transition: (f.transition as DesignJSON['flows'][number]['transition']) ?? 'slide-left',
      })
    }
  }

  return {
    page: { id, name, order, pos: { x: 0, y: 0 }, background: '$color.bg', root },
    flows,
    warnings,
  }
}

/** 修补变体载荷：逐个变体宽容处理，单个坏掉的只降级为占位，不拖垮整批 */
export function repairVariantsPayload(
  o: unknown,
  limit: number,
): {
  items: Array<{ aspects: string[]; rationale: string; root: Node | null; error?: string }>
  warnings: string[]
} {
  const warnings: string[] = []
  const items: Array<{ aspects: string[]; rationale: string; root: Node | null; error?: string }> = []
  const obj = (o ?? {}) as Record<string, unknown>
  const list = Array.isArray(obj.variants) ? (obj.variants as Array<Record<string, unknown>>) : []

  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : list.length

  for (let i = 0; i < list.length && items.length < cap; i++) {
    const raw = list[i] ?? {}
    const aspects = Array.isArray(raw.aspects)
      ? (raw.aspects as unknown[]).filter((a): a is string => typeof a === 'string')
      : []
    const rationale = typeof raw.rationale === 'string' && raw.rationale ? raw.rationale : '变体方案'
    if (!raw.root || typeof raw.root !== 'object') {
      items.push({ aspects, rationale: '生成失败', root: null, error: '该变体缺少 root' })
      continue
    }
    try {
      items.push({ aspects, rationale, root: repairNode(raw.root, 0) })
    } catch (e) {
      items.push({ aspects, rationale: '生成失败', root: null, error: (e as Error).message })
    }
  }

  if (list.length > cap) warnings.push(`变体数量超出上限，已截取前 ${cap} 个`)
  return { items, warnings }
}

/**
 * 过滤掉指向不存在页面 / 非存在源节点的跳转，补齐 id，截断至 40 条。
 *
 * 从 generate.ts 下沉至此：本函数是纯逻辑，而 F-ST-02 的 flows 推理
 * （autofill.ts）需要复用它做合法性校验。若留在 generate.ts，
 * autofill 就会被牵连导入 project.store / ui.store，破坏「服务层纯函数」的边界。
 */
export function normalizeFlows(flows: DesignJSON['flows'], pages: Page[]): DesignJSON['flows'] {
  const pageIds = new Set(pages.map((p) => p.id))
  const nodeIds = new Set<string>()
  pages.forEach((p) => {
    const walk = (n: Node) => {
      nodeIds.add(n.id)
      n.children?.forEach(walk)
    }
    walk(p.root)
  })

  return flows
    .filter((f) => pageIds.has(f.to) && nodeIds.has(f.from))
    .map((f, i) => ({ ...f, id: f.id || `flow_${i}` }))
    .slice(0, 40)
}

/** 组装最终项目 */
export function assembleProject(args: {  name: string
  device: string
  canvas: { width: number; height: number }
  tokens: DesignJSON['tokens']
  pages: Page[]
  flows: DesignJSON['flows']
  prompt: string
  /** F-ST-01：绑定的项目级设计规范 id（可选，未绑定则省略该字段） */
  specId?: string
  /** F-ST-01：随项目携带的规范集合（内置规范不写入，仅存自定义） */
  specs?: DesignJSON['specs']
  /** F-PM-05：界面配额（计划数 / 软上限 / 硬上限） */
  quota?: InterfaceQuota
  /** F-PM-05：生成时自动建立的界面分组 */
  pageGroups?: PageGroup[]
}): DesignJSON {
  const now = new Date().toISOString()
  const canvas =
    args.canvas?.width && args.canvas?.height
      ? args.canvas
      : DEVICE_CANVAS[args.device] ?? DEVICE_CANVAS.MOBILE

  // 重新排布页面坐标
  const pages = args.pages.map((p, i) => ({
    ...p,
    order: i,
    pos: { x: i * (canvas.width + 40), y: 0 },
  }))

  const design: DesignJSON = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: `proj_${Date.now().toString(36)}`,
      name: args.name || 'AI 生成项目',
      device: (['MOBILE', 'TABLET', 'DESKTOP', 'RESPONSIVE'].includes(args.device)
        ? args.device
        : 'MOBILE') as DesignJSON['meta']['device'],
      canvas,
      createdAt: now,
      updatedAt: now,
      source: 'ai',
      prompt: args.prompt,
    },
    tokens: args.tokens ?? {},
    assets: [],
    pages,
    flows: args.flows,
  }

  // F-PM-05：配额始终写入 —— 它是"这个项目打算做几屏"的显式声明，
  // 缺了就只能靠读取时兜底，用户无法在项目设置里看到真实意图。
  design.meta.quota = args.quota
    ? { ...DEFAULT_QUOTA, ...args.quota }
    : { ...DEFAULT_QUOTA, planned: Math.max(1, pages.length) }
  if (args.pageGroups?.length) design.pageGroups = args.pageGroups

  // 仅在确有时才写入，避免给未使用该能力的项目留下空字段（保持旧文件形态干净）
  if (args.specId) design.meta.specId = args.specId
  if (args.specs?.length) design.specs = args.specs

  return design
}
