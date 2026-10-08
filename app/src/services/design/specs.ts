// src/services/design/specs.ts
// F-ST-01 设计规范引用能力 —— 规范实体的建立 / 绑定 / 切换 / 校验 / 导入导出
//
// 设计要点（对应 docs/功能设计-对标Stitch能力增强.md §2）：
//  · 规范 = 「Tokens + 负面规则」的不可变声明，与项目解耦，可跨项目复用；
//  · 绑定两级：meta.specId（项目级默认）→ page.specId（页面级覆盖）；
//  · 切换规范 = 整体替换 design.tokens（节点 style 里存的是 $color.x 引用，自动跟着变）；
//  · 校验 = 漂移检测（未用引用 / 引用不存在 / 违反负面规则 / 规范外颜色），可一键修正。
//
// 本模块刻意「不 import store / 不 import react」，全部为纯函数，
// 便于 scripts/test-specs.mjs 直接单测（对齐 F-ST-03 沉淀的测试范式）。
import type { DesignJSON, DesignSpec, Node, Page, SpecRules, Tokens } from '@shared/design'
import { STYLE_PRESETS } from './style-presets'
import type { TokenMap } from '@/services/render/tokens'
import { buildTokenMap, parseTokenRef, resolveValue } from '@/services/render/tokens'

/* ============================== 内置规范 ============================== */

/** 内置规范的四条通用负面规则（可直接作为 Prompt 的负向约束） */
export const DEFAULT_DONTS = [
  '不要使用规范 color 集合之外的颜色',
  '不要用全大写呈现正文与标题',
] as const

/** 把 STYLE_PRESETS 直接提升为内置规范 —— 零成本拿到四套完整 Token */
export const BUILTIN_SPECS: DesignSpec[] = STYLE_PRESETS.map((p) => ({
  id: `builtin:${p.id}`,
  name: p.name,
  desc: p.desc,
  source: 'builtin' as const,
  tokens: JSON.parse(JSON.stringify(p.tokens)) as Tokens,
  rules: { donts: [...DEFAULT_DONTS] },
  createdAt: '2024-01-01T00:00:00.000Z',
}))

/** 内置规范的原始 preset id（`builtin:clear-blue` → `clear-blue`），非内置返回 null */
export function presetIdOf(specId: string | undefined): string | null {
  if (!specId || !specId.startsWith('builtin:')) return null
  const raw = specId.slice('builtin:'.length)
  return STYLE_PRESETS.some((p) => p.id === raw) ? raw : null
}

export function isBuiltinSpecId(specId: string | undefined): boolean {
  return presetIdOf(specId) != null
}

/* ============================ 规范集合与查找 ============================ */

/** 项目内全部可用规范 = 内置 + 项目自带 */
export function listSpecs(design: Pick<DesignJSON, 'specs'>): DesignSpec[] {
  const custom = Array.isArray(design.specs) ? design.specs : []
  return [...BUILTIN_SPECS, ...custom]
}

/** 按 id 查找规范；内置 id 与项目规范都能命中 */
export function findSpec(design: Pick<DesignJSON, 'specs'>, id: string | undefined): DesignSpec | undefined {
  if (!id) return undefined
  const builtin = BUILTIN_SPECS.find((s) => s.id === id)
  if (builtin) return builtin
  return (design.specs ?? []).find((s) => s.id === id)
}

/**
 * 解析某页「实际生效」的规范：
 *   页面级 specId → 项目级 specId → undefined（未绑定）
 * 缺失/失效的 id 视为未绑定，不抛错（保证旧文件与脏数据可用）。
 */
export function resolveSpecForPage(
  design: Pick<DesignJSON, 'meta' | 'specs'>,
  page?: Pick<Page, 'specId'> | null,
): DesignSpec | undefined {
  const pageLevel = findSpec(design, page?.specId)
  if (pageLevel) return pageLevel
  return findSpec(design, design.meta.specId)
}

/** 未被任何页面/项目绑定的规范 id 集合（用于提示「孤规范」） */
export function orphanSpecIds(design: Pick<DesignJSON, 'meta' | 'pages' | 'specs'>): string[] {
  const used = new Set<string>()
  if (design.meta.specId) used.add(design.meta.specId)
  design.pages.forEach((p) => p.specId && used.add(p.specId))
  return (design.specs ?? []).map((s) => s.id).filter((id) => !used.has(id))
}

/**
 * 取某页渲染时应使用的 TokenMap。
 * 未绑定任何规范（旧文件 / 未启用该能力）→ 退回 design.tokens，行为与改造前完全一致。
 * 这是渲染层（画布 / 预览 / 变体 / 导出）唯一的取 map 入口，保证四处永远同源。
 */
export function tokenMapForPage(
  design: Pick<DesignJSON, 'meta' | 'specs' | 'tokens'>,
  page?: Pick<Page, 'specId'> | null,
): TokenMap {
  return buildTokenMap(tokensForPage(design, page))
}

/**
 * 取某页生效的 Tokens（原始声明，未展开为 map）。
 * 属性面板的「可引用颜色/圆角清单」用它，保证候选列表与画布渲染同源。
 */
export function tokensForPage(
  design: Pick<DesignJSON, 'meta' | 'specs' | 'tokens'>,
  page?: Pick<Page, 'specId'> | null,
): Tokens {
  const spec = resolveSpecForPage(design, page)
  return spec ? spec.tokens : design.tokens
}

/* ============================== 规范构造 ============================== */

let specSeq = 0

function uidSpec(): string {
  specSeq += 1
  return `spec_${Date.now().toString(36)}${specSeq.toString(36)}`
}

/** 深拷贝一份 Token，避免规范与项目共享引用后互相污染 */
export function cloneTokens(tokens: Tokens | undefined): Tokens {
  return JSON.parse(JSON.stringify(tokens ?? {})) as Tokens
}

export function createSpec(input: {
  name: string
  tokens: Tokens
  desc?: string
  rules?: SpecRules
  source?: DesignSpec['source']
  id?: string
}): DesignSpec {
  return {
    id: input.id ?? uidSpec(),
    name: input.name.trim() || '未命名规范',
    desc: input.desc,
    source: input.source ?? 'imported',
    tokens: cloneTokens(input.tokens),
    rules: input.rules,
    createdAt: new Date().toISOString(),
  }
}

/** 从当前项目 Token 派生规范（「把这一版风格存下来」） */
export function deriveSpec(design: Pick<DesignJSON, 'tokens' | 'meta'>, name: string, desc?: string): DesignSpec {
  return createSpec({
    name: name || `${design.meta.name} 的规范`,
    desc,
    tokens: design.tokens,
    source: 'derived',
    rules: { donts: [...DEFAULT_DONTS] },
  })
}

/** 由内置 preset id 生成一份「可编辑的副本」（导入到项目里再改，不动内置） */
export function forkBuiltinSpec(specId: string, name?: string): DesignSpec | null {
  const presetId = presetIdOf(specId)
  if (!presetId) return null
  const preset = STYLE_PRESETS.find((p) => p.id === presetId)
  if (!preset) return null
  return createSpec({
    name: name ?? `${preset.name} · 副本`,
    desc: preset.desc,
    tokens: preset.tokens,
    source: 'builtin',
    rules: { donts: [...DEFAULT_DONTS] },
  })
}

/* ============================== 规范统计 ============================== */

export interface SpecSummary {
  colorCount: number
  fontCount: number
  spaceCount: number
  radiusCount: number
  shadowCount: number
  donts: string[]
  dos: string[]
  /** 主色，用于 UI 色卡预览 */
  primary?: string
  bg?: string
  text?: string
}

export function summarizeSpec(spec: DesignSpec): SpecSummary {
  const t = spec.tokens ?? {}
  return {
    colorCount: Object.keys(t.color ?? {}).length,
    fontCount: Object.keys(t.font ?? {}).length,
    spaceCount: Object.keys(t.space ?? {}).length,
    radiusCount: Object.keys(t.radius ?? {}).length,
    shadowCount: Object.keys(t.shadow ?? {}).length,
    donts: spec.rules?.donts ?? [],
    dos: spec.rules?.dos ?? [],
    primary: (t.color ?? {}).primary,
    bg: (t.color ?? {}).bg,
    text: (t.color ?? {}).text,
  }
}

/** 规范是否可用（至少要有 color 组，否则渲染层解析不出颜色） */
export function isValidSpecTokens(tokens: unknown): tokens is Tokens {
  if (!tokens || typeof tokens !== 'object') return false
  const c = (tokens as Tokens).color
  return !!c && typeof c === 'object' && Object.keys(c).length > 0
}

/* ============================== 色值工具 ============================== */

export interface Rgb {
  r: number
  g: number
  b: number
  a: number
}

const NAMED: Record<string, string> = {
  transparent: '#00000000',
  white: '#FFFFFF',
  black: '#000000',
}

/** 解析 #RGB / #RRGGBB / #RRGGBBAA / rgb() / rgba() → Rgb；失败返回 null */
export function parseColor(input: unknown): Rgb | null {
  if (typeof input !== 'string') return null
  let s = input.trim().toLowerCase()
  if (!s) return null
  if (NAMED[s]) s = NAMED[s].toLowerCase()

  if (s.startsWith('#')) {
    const h = s.slice(1)
    const toN = (x: string) => parseInt(x, 16)
    if (h.length === 3 || h.length === 4) {
      const r = toN(h[0] + h[0])
      const g = toN(h[1] + h[1])
      const b = toN(h[2] + h[2])
      const a = h.length === 4 ? toN(h[3] + h[3]) / 255 : 1
      return Number.isNaN(r + g + b) ? null : { r, g, b, a }
    }
    if (h.length === 6 || h.length === 8) {
      const r = toN(h.slice(0, 2))
      const g = toN(h.slice(2, 4))
      const b = toN(h.slice(4, 6))
      const a = h.length === 8 ? toN(h.slice(6, 8)) / 255 : 1
      return Number.isNaN(r + g + b) ? null : { r, g, b, a }
    }
    return null
  }

  const m = /^rgba?\(([^)]+)\)$/.exec(s)
  if (m) {
    const parts = m[1].split(/[,/\s]+/).filter(Boolean).map(Number)
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1 }
  }
  return null
}

/** RGB 欧氏距离（忽略 alpha），范围 0 ~ 441 */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

/** 判定为「同一颜色的近似值」的距离阈值（约 11% 色域） */
export const NEAR_COLOR_DISTANCE = 48
/** 更宽松的阈值：用于给出「建议替换」但标注为不确定 */
export const LOOSE_COLOR_DISTANCE = 96

export interface NearestColor {
  key: string
  ref: string
  hex: string
  distance: number
}

/** 在规范的 color 集合中找最接近的颜色 */
export function nearestColor(color: unknown, spec: DesignSpec): NearestColor | null {
  const target = parseColor(color)
  if (!target) return null
  let best: NearestColor | null = null
  for (const [key, hex] of Object.entries(spec.tokens?.color ?? {})) {
    const c = parseColor(hex)
    if (!c) continue
    const d = colorDistance(target, c)
    if (!best || d < best.distance) best = { key, ref: `$color.${key}`, hex, distance: d }
  }
  return best
}

/* ============================== 漂移检测 ============================== */

export type DriftKind = 'literal-color' | 'missing-token' | 'rule-violation' | 'off-palette'

export interface DriftIssue {
  kind: DriftKind
  pageId: string
  pageName: string
  nodeId: string
  nodeName?: string
  /** 出问题的字段路径，如 `style.fill` */
  path: string
  /** 当前值（字面色值 / 失效引用 / 规则相关文本） */
  value?: string
  message: string
  /** 建议替换为的 Token 引用（存在时「一键修正」可用） */
  suggestion?: string
}

/** 可被规则化检测的负面规则 */
export interface RuleDetector {
  id: string
  /** 命中原始规则的文案 */
  rule: string
  test: (node: Node) => boolean
  message: string
}

const UPPERCASE_RE = /全大写|大写字母|uppercase/i
const SHADOW_RE = /(不要|禁止|避免|不使用|no\b)[^。；;]*阴影|shadow/i
const ITALIC_RE = /(不要|禁止|避免)[^。；;]*斜体|italic/i
const RADIUS_RE = /圆角[^0-9]{0,6}(\d{1,3})/

/** 把自然语言的 donts 编译为可执行检测器（无法规则化的规则会被忽略） */
export function compileRules(rules: SpecRules | undefined): RuleDetector[] {
  const out: RuleDetector[] = []
  for (const raw of rules?.donts ?? []) {
    const rule = String(raw ?? '').trim()
    if (!rule) continue

    if (UPPERCASE_RE.test(rule)) {
      out.push({
        id: 'no-uppercase',
        rule,
        test: (n) => n.style?.textTransform === 'uppercase',
        message: '违反负面规则：规范要求不要使用全大写文本',
      })
    }
    if (SHADOW_RE.test(rule)) {
      out.push({
        id: 'no-shadow',
        rule,
        test: (n) => Array.isArray(n.style?.shadow) && n.style!.shadow!.length > 0,
        message: '违反负面规则：规范要求不要使用阴影',
      })
    }
    if (ITALIC_RE.test(rule)) {
      out.push({
        id: 'no-italic',
        rule,
        test: (n) => n.style?.font?.italic === true,
        message: '违反负面规则：规范要求不要使用斜体',
      })
    }
    const rm = RADIUS_RE.exec(rule)
    if (rm) {
      const limit = Number(rm[1])
      if (Number.isFinite(limit)) {
        out.push({
          id: 'radius-limit',
          rule,
          test: (n) => typeof n.style?.radius === 'number' && n.style!.radius! > limit,
          message: `违反负面规则：规范要求圆角不超过 ${limit}px`,
        })
      }
    }
    // 渐变无法在 Design JSON 中表达，不做检测（避免产出无法修正的误报）
  }
  return out
}

/** 需要扫描的颜色字段 */
const COLOR_PATHS: Array<{ path: string; get: (n: Node) => unknown; set: (n: Node, v: string) => void }> = [
  { path: 'style.fill', get: (n) => n.style?.fill, set: (n, v) => setStyleField(n, 'fill', v) },
  { path: 'style.textColor', get: (n) => n.style?.textColor, set: (n, v) => setStyleField(n, 'textColor', v) },
  { path: 'style.stroke.color', get: (n) => n.style?.stroke?.color, set: (n, v) => setStyleField(n, 'strokeColor', v) },
]

/**
 * 所有「可承载 Token 引用」的字段（含非颜色组）。
 * 渲染层同样会解析 radius / shadow / font 的引用（见 render/node.ts），
 * 因此失效引用检测必须覆盖它们，否则 `$radius.xx` 指向不存在的档位时会被静默忽略。
 */
const REF_PATHS: Array<{ path: string; get: (n: Node) => unknown }> = [
  ...COLOR_PATHS.map((c) => ({ path: c.path, get: c.get })),
  { path: 'style.radius', get: (n) => n.style?.radius },
  { path: 'style.shadow', get: (n) => (Array.isArray(n.style?.shadow) ? n.style!.shadow![0] : undefined) },
  { path: 'style.font.size', get: (n) => n.style?.font?.size },
  { path: 'layout.width', get: (n) => n.layout?.width },
  { path: 'layout.height', get: (n) => n.layout?.height },
  { path: 'layout.gap', get: (n) => n.layout?.gap },
]

function setStyleField(n: Node, field: 'fill' | 'textColor' | 'strokeColor', v: string) {
  // 必须先复制 style 再写：否则会顺着 `{...n}` 复制出来的浅引用污染原节点，
  // 破坏「toTokenRefs 是纯函数、返回新树」的约定。
  const style = { ...(n.style ?? {}) }
  if (field === 'strokeColor') {
    style.stroke = { ...(style.stroke ?? {}), color: v }
  } else {
    style[field] = v
  }
  n.style = style
}

interface WalkCtx {
  page: Page
  spec: DesignSpec
  map: ReturnType<typeof buildTokenMap>
  detectors: RuleDetector[]
  issues: DriftIssue[]
}

function pushIssue(ctx: WalkCtx, node: Node, issue: Omit<DriftIssue, 'pageId' | 'pageName' | 'nodeId' | 'nodeName'>) {
  ctx.issues.push({
    ...issue,
    pageId: ctx.page.id,
    pageName: ctx.page.name,
    nodeId: node.id,
    nodeName: node.name,
  })
}

/**
 * 在给定 TokenMap 下找出节点上所有失效的引用。
 * detectDrift（当前规范）与 previewSwitch（待切换规范）共用，保证两处口径永远一致。
 */
function brokenRefsOf(node: Node, map: ReturnType<typeof buildTokenMap>): Array<{ path: string; value: string }> {
  const out: Array<{ path: string; value: string }> = []
  const seen = new Set<string>()
  for (const def of REF_PATHS) {
    const raw = def.get(node)
    if (!parseTokenRef(raw)) continue
    if (seen.has(def.path)) continue
    seen.add(def.path)
    if (resolveValue(raw, map) === undefined) out.push({ path: def.path, value: String(raw) })
  }
  return out
}

function visitNode(node: Node, ctx: WalkCtx) {
  /* 1) 失效引用：覆盖所有承载引用的字段（含 radius / shadow / space 等非颜色组） */
  for (const bad of brokenRefsOf(node, ctx.map)) {
    pushIssue(ctx, node, {
      kind: 'missing-token',
      path: bad.path,
      value: bad.value,
      message: `引用了规范中不存在的 Token：${bad.value}`,
    })
  }

  /* 2) 颜色类：字面色值 / 规范外颜色（引用类已在上面处理，这里只处理字面值） */
  for (const def of COLOR_PATHS) {
    const raw = def.get(node)
    if (parseTokenRef(raw)) continue
    if (typeof raw !== 'string' || !raw.trim()) continue
    if (parseColor(raw) == null) continue // 非颜色语义（如 'fill'/'none'），跳过

    const near = nearestColor(raw, ctx.spec)
    if (near && near.distance <= LOOSE_COLOR_DISTANCE) {
      pushIssue(ctx, node, {
        kind: 'literal-color',
        path: def.path,
        value: raw,
        message:
          near.distance <= NEAR_COLOR_DISTANCE
            ? `字面色值 ${raw} ≈ 规范色 ${near.hex}，建议改为引用`
            : `字面色值 ${raw} 与规范色 ${near.hex} 接近（差异较大），可确认后改为引用`,
        suggestion: near.ref,
      })
    } else {
      pushIssue(ctx, node, {
        kind: 'off-palette',
        path: def.path,
        value: raw,
        message: `规范外颜色：${raw} 不在规范的 color 集合中`,
      })
    }
  }

  /* 3) 规则类 */
  for (const d of ctx.detectors) {
    if (d.test(node)) {
      pushIssue(ctx, node, {
        kind: 'rule-violation',
        path: `rule:${d.id}`,
        value: d.rule,
        message: d.message,
        suggestion: d.id,
      })
    }
  }

  node.children?.forEach((c) => visitNode(c, ctx))
}

export interface DriftReport {
  /** 生效规范；未绑定时为 undefined，issues 为空 */
  spec?: DesignSpec
  issues: DriftIssue[]
  /** 按类型统计，便于面板摘要 */
  counts: Record<DriftKind, number>
  /** 已扫描的页面数 */
  scannedPages: number
}

const EMPTY_COUNTS = (): Record<DriftKind, number> => ({
  'literal-color': 0,
  'missing-token': 0,
  'rule-violation': 0,
  'off-palette': 0,
})

/**
 * 规范漂移检测。
 * @param pageIds 限定扫描范围；不传则扫描全部页面（各自使用其生效规范）
 */
export function detectDrift(
  design: Pick<DesignJSON, 'meta' | 'specs' | 'tokens' | 'pages'>,
  pageIds?: string[],
): DriftReport {
  const issues: DriftIssue[] = []
  const targets = pageIds?.length ? design.pages.filter((p) => pageIds.includes(p.id)) : design.pages
  let scanned = 0
  let firstSpec: DesignSpec | undefined

  for (const page of targets) {
    const spec = resolveSpecForPage(design, page)
    if (!spec) continue
    firstSpec = firstSpec ?? spec
    scanned += 1
    visitNode(page.root, {
      page,
      spec,
      map: buildTokenMap(spec.tokens),
      detectors: compileRules(spec.rules),
      issues,
    })
  }

  const counts = EMPTY_COUNTS()
  issues.forEach((i) => {
    counts[i.kind] += 1
  })

  return { spec: firstSpec, issues, counts, scannedPages: scanned }
}

/* ============================== 一键修正 ============================== */

/**
 * 把节点树里的字面色值改写为规范的 Token 引用（纯函数，返回新树）。
 * 仅当距离 ≤ LOOSE_COLOR_DISTANCE 时才替换；`only` 可限定要处理的节点 id 集合。
 */
export function toTokenRefs(
  root: Node,
  spec: DesignSpec,
  opts?: { nodeIds?: string[]; threshold?: number },
): { root: Node; changed: number; paths: string[] } {
  const threshold = opts?.threshold ?? LOOSE_COLOR_DISTANCE
  const filter = opts?.nodeIds?.length ? new Set(opts.nodeIds) : null
  let changed = 0
  const paths: string[] = []

  const walk = (n: Node): Node => {
    const next: Node = { ...n }
    const allow = !filter || filter.has(n.id)
    if (allow) {
      for (const def of COLOR_PATHS) {
        const raw = def.get(next)
        if (parseTokenRef(raw)) continue
        if (typeof raw !== 'string' || !parseColor(raw)) continue
        const near = nearestColor(raw, spec)
        if (near && near.distance <= threshold) {
          def.set(next, near.ref)
          changed += 1
          paths.push(`${n.id}.${def.path}`)
        }
      }
    }
    if (next.children?.length) next.children = next.children.map(walk)
    return next
  }

  const out = walk(root)
  return { root: out, changed, paths }
}

/** 一键修正「违反负面规则」：按 detector id 撤掉违规属性 */
export function fixRuleViolation(root: Node, detectorId: string): { root: Node; changed: number } {
  let changed = 0
  const walk = (n: Node): Node => {
    const next: Node = { ...n }
    if (detectorId === 'no-uppercase' && next.style?.textTransform === 'uppercase') {
      next.style = { ...next.style, textTransform: 'none' }
      changed += 1
    }
    if (detectorId === 'no-shadow' && next.style?.shadow?.length) {
      next.style = { ...next.style, shadow: [] }
      changed += 1
    }
    if (detectorId === 'no-italic' && next.style?.font?.italic) {
      next.style = { ...next.style, font: { ...next.style.font, italic: false } }
      changed += 1
    }
    if (detectorId === 'radius-limit' && typeof next.style?.radius === 'number') {
      // 收敛到规范的 radius.full 之外的最小圆角档
      next.style = { ...next.style, radius: '$radius.md' }
      changed += 1
    }
    if (next.children?.length) next.children = next.children.map(walk)
    return next
  }
  const out = walk(root)
  return { root: out, changed }
}

/**
 * 批量修正漂移：一次遍历把符合条件的 issue 全部修掉。
 * `changed` = 实际被修正的 issue 数，`skipped` = 未能修正的 issue 数（含被 kinds 过滤掉的），
 * 两者之和恒等于传入 issues 的长度，便于 UI 给出准确回执。
 */
export function fixDrift(
  design: Pick<DesignJSON, 'meta' | 'specs' | 'tokens' | 'pages'>,
  issues: DriftIssue[],
  opts?: { kinds?: DriftKind[] },
): { design: DesignJSON; changed: number; skipped: number } {
  const kinds = opts?.kinds ? new Set(opts.kinds) : null

  let changed = 0
  let skipped = 0

  // 未选中的类型直接计入 skipped，保证口径闭合
  const chosen: DriftIssue[] = []
  for (const i of issues) {
    if (kinds && !kinds.has(i.kind)) skipped += 1
    else chosen.push(i)
  }

  const byPage = new Map<string, DriftIssue[]>()
  chosen.forEach((i) => {
    const list = byPage.get(i.pageId) ?? []
    list.push(i)
    byPage.set(i.pageId, list)
  })

  const nextPages = design.pages.map((page) => {
    const pageIssues = byPage.get(page.id)
    if (!pageIssues?.length) return page
    const spec = resolveSpecForPage(design, page)
    if (!spec) {
      skipped += pageIssues.length
      return page
    }

    let root = page.root
    const fixedPaths = new Set<string>()

    /* --- 颜色类：按节点聚合，一次处理该节点上所有颜色路径 --- */
    const literalByNode = new Map<string, DriftIssue[]>()
    pageIssues
      .filter((i) => i.kind === 'literal-color')
      .forEach((i) => {
        const list = literalByNode.get(i.nodeId) ?? []
        list.push(i)
        literalByNode.set(i.nodeId, list)
      })
    for (const [nodeId, list] of literalByNode) {
      const res = toTokenRefs(root, spec, { nodeIds: [nodeId] })
      root = res.root
      res.paths.forEach((p) => fixedPaths.add(p))
      for (const issue of list) {
        if (fixedPaths.has(`${nodeId}.${issue.path}`)) changed += 1
        else skipped += 1
      }
    }

    /* --- 规则类：同一 detector 只需扫全树一次 --- */
    const ruleIssues = pageIssues.filter((i) => i.kind === 'rule-violation')
    const fixedDetectors = new Set<string>()
    for (const id of new Set(ruleIssues.map((i) => i.suggestion ?? i.path.replace('rule:', '')))) {
      const res = fixRuleViolation(root, id)
      root = res.root
      if (res.changed > 0) fixedDetectors.add(id)
    }
    for (const issue of ruleIssues) {
      const id = issue.suggestion ?? issue.path.replace('rule:', '')
      if (fixedDetectors.has(id)) changed += 1
      else skipped += 1
    }

    /* --- 不可自动修正 --- */
    skipped += pageIssues.filter((i) => i.kind === 'off-palette' || i.kind === 'missing-token').length

    return { ...page, root }
  })

  return {
    design: { ...(design as DesignJSON), pages: nextPages },
    changed,
    skipped,
  }
}

/* ============================== 切换规范 ============================== */

export interface SwitchPreview {
  spec: DesignSpec
  /** 切换后会失效（找不到定义）的引用数 */
  brokenRefs: number
  /** 会被规范覆盖掉的字面色值数 */
  overriddenLiterals: number
  /** 规范缺少、但项目正在使用的 Token 组 */
  missingGroups: string[]
}

/**
 * 预览切换规范的影响面 —— UI 在切换前必须展示这个提示
 * （对应 §2.3.3 的「切换前明确提示将覆盖 N 处非 Token 引用色值」）。
 */
export function previewSwitch(
  design: Pick<DesignJSON, 'meta' | 'specs' | 'tokens' | 'pages'>,
  spec: DesignSpec,
  pageIds?: string[],
): SwitchPreview {
  const nextMap = buildTokenMap(spec.tokens)
  const targets = pageIds?.length ? design.pages.filter((p) => pageIds.includes(p.id)) : design.pages
  let brokenRefs = 0
  let overriddenLiterals = 0

  const walk = (n: Node) => {
    // 与 detectDrift 同源：任何承载引用的字段都算
    brokenRefs += brokenRefsOf(n, nextMap).length
    for (const def of COLOR_PATHS) {
      const raw = def.get(n)
      if (parseTokenRef(raw)) continue
      if (typeof raw === 'string' && parseColor(raw)) overriddenLiterals += 1
    }
    n.children?.forEach(walk)
  }
  targets.forEach((p) => walk(p.root))

  const missingGroups: string[] = []
  const usedGroups = new Set<string>()
  const collectRefs = (n: Node) => {
    for (const def of REF_PATHS) {
      const ref = parseTokenRef(def.get(n))
      if (ref) usedGroups.add(ref.group)
    }
    n.children?.forEach(collectRefs)
  }
  targets.forEach((p) => collectRefs(p.root))
  // buildTokenMap 恒返回全部 5 个组（缺失时为空对象），因此判据要看「原始声明里该组是否有键」，
  // 不能看 map[g] 是否为 undefined —— 那永远为假。
  usedGroups.forEach((g) => {
    const raw = (spec.tokens as Record<string, unknown> | undefined)?.[g]
    const hasKeys = !!raw && typeof raw === 'object' && Object.keys(raw as object).length > 0
    if (!hasKeys) missingGroups.push(g)
  })

  return { spec, brokenRefs, overriddenLiterals, missingGroups }
}

/* ============================== 导出 / 导入 ============================== */

export interface SpecFile {
  /** 规范文件格式版本，独立于 SCHEMA_VERSION */
  specVersion: string
  kind: 'wangshu.design-spec'
  spec: DesignSpec
}

export const SPEC_FILE_VERSION = '1.0'

/** 导出为 JSON 文本（同时用于落盘与剪贴板） */
export function exportSpecJson(spec: DesignSpec): string {
  const file: SpecFile = { specVersion: SPEC_FILE_VERSION, kind: 'wangshu.design-spec', spec }
  return JSON.stringify(file, null, 2)
}

function hexList(tokens: Tokens | undefined): string {
  const c = tokens?.color ?? {}
  return Object.entries(c)
    .map(([k, v]) => `| \`${k}\` | \`${v}\` |`)
    .join('\n')
}

/** 导出为 Markdown（对齐 Stitch 的 design.md，便于跨工具共享） */
export function exportSpecMarkdown(spec: DesignSpec): string {
  const s = summarizeSpec(spec)
  const fonts = Object.entries(spec.tokens?.font ?? {})
    .map(([k, v]) => `| \`${k}\` | ${v.family} | ${v.size} | ${v.weight ?? 400} | ${v.lineHeight ?? '-'} |`)
    .join('\n')
  const spaces = Object.entries(spec.tokens?.space ?? {})
    .map(([k, v]) => `\`${k}\`=${v}`)
    .join(' · ')
  const radii = Object.entries(spec.tokens?.radius ?? {})
    .map(([k, v]) => `\`${k}\`=${v}`)
    .join(' · ')

  return `# 设计规范：${spec.name}

> ${spec.desc ?? '（无描述）'}
> 来源：${spec.source} ｜ 创建于：${spec.createdAt}
> 由「望舒」导出 · 可重新导入以无损还原

## 1. 色板（${s.colorCount}）

| Token | 值 |
|---|---|
${hexList(spec.tokens)}

## 2. 字体（${s.fontCount}）

| Token | 字族 | 字号 | 字重 | 行高 |
|---|---|---|---|---|
${fonts || '| — | — | — | — | — |'}

## 3. 间距（${s.spaceCount}）

${spaces || '—'}

## 4. 圆角（${s.radiusCount}）

${radii || '—'}

## 5. 规则

### 应当（dos）
${(spec.rules?.dos ?? []).map((d) => `- ${d}`).join('\n') || '- （无）'}

### 禁止（donts）
${(spec.rules?.donts ?? []).map((d) => `- ${d}`).join('\n') || '- （无）'}

<!-- 机器可读区：以下内容用于无损往返导入，请勿手工编辑 -->
\`\`\`json wangshu-spec
${exportSpecJson(spec)}
\`\`\`
`
}

export interface ImportResult {
  spec: DesignSpec | null
  warnings: string[]
}

/** 归一化外部传入的 spec 字段，保证结构可信 */
function normalizeSpec(raw: unknown, source: DesignSpec['source']): ImportResult {
  const warnings: string[] = []
  if (!raw || typeof raw !== 'object') return { spec: null, warnings: ['内容不是对象'] }
  const o = raw as Record<string, unknown>

  const tokens = o.tokens as Tokens | undefined
  if (!isValidSpecTokens(tokens)) {
    return { spec: null, warnings: ['缺少有效的 tokens.color，无法作为设计规范使用'] }
  }
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : '导入的规范'
  if (typeof o.name !== 'string') warnings.push('缺少 name，已使用「导入的规范」')

  const rules = o.rules as SpecRules | undefined
  if (rules && typeof rules !== 'object') warnings.push('rules 格式异常，已忽略')

  return {
    spec: createSpec({
      id: typeof o.id === 'string' && o.id ? o.id : undefined,
      name,
      desc: typeof o.desc === 'string' ? o.desc : undefined,
      tokens,
      source,
      rules: rules && typeof rules === 'object' ? rules : undefined,
    }),
    warnings,
  }
}

function extractSpecBlock(text: string): unknown {
  // 1) 望舒专有标记块
  const marked = /```json\s+wangshu-spec\s*\n([\s\S]*?)```/i.exec(text)
  if (marked) {
    try {
      return JSON.parse(marked[1])
    } catch {
      /* 继续尝试其它形态 */
    }
  }
  // 2) 任意代码块
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text)
  if (fenced) {
    try {
      return JSON.parse(fenced[1])
    } catch {
      /* 继续 */
    }
  }
  // 3) 整体就是 JSON
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return null
    }
  }
  return null
}

/**
 * 导入规范：支持
 *  · 望舒导出的 JSON 文件（`{specVersion, kind, spec}`）
 *  · 裸规范对象（`{name, tokens}`，对齐 Stitch design.md 的简化形态）
 *  · 望舒导出的 Markdown（内含 `wangshu-spec` 代码块，无损往返）
 */
export function importSpec(text: unknown): ImportResult {
  if (typeof text !== 'string' || !text.trim()) return { spec: null, warnings: ['内容为空'] }

  let parsed = extractSpecBlock(text)
  let kind: DesignSpec['source'] = 'imported'

  // Markdown 无 JSON 块时，尝试解析 Markdown 表格作为降级
  if (!parsed) {
    const fallback = parseMarkdownSpec(text)
    if (fallback) {
      parsed = fallback
      kind = 'imported'
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { spec: null, warnings: ['未能从内容中解析出规范（需要 JSON 或含 JSON 代码块的 Markdown）'] }
  }

  const obj = parsed as Record<string, unknown>
  // 解包望舒文件信封
  const inner = obj.spec && typeof obj.spec === 'object' ? obj.spec : obj
  const res = normalizeSpec(inner, kind)
  if (res.spec && obj.kind && obj.kind !== 'wangshu.design-spec') {
    res.warnings.push(`未知的规范文件类型：${String(obj.kind)}`)
  }
  return res
}

/** 降级解析：从 Markdown 的色板表格中提取色值 */
function parseMarkdownSpec(text: string): Record<string, unknown> | null {
  const colorSection = /##\s*1\.\s*色板[\s\S]*?(?=\n##\s|\n<!--|$)/i.exec(text)
  if (!colorSection) return null
  const color: Record<string, string> = {}
  const rowRe = /\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(colorSection[0]))) color[m[1]] = m[2]
  if (!Object.keys(color).length) return null
  const nameMatch = /^#\s*设计规范：(.+)$/m.exec(text)
  return { name: nameMatch?.[1]?.trim() ?? '导入的规范', tokens: { color } }
}

/* ============================== Prompt 注入 ============================== */

/** 把规范的负面规则渲染成 Prompt 段落 */
export function specConstraintsForPrompt(spec: DesignSpec): string {
  const donts = spec.rules?.donts ?? []
  const dos = spec.rules?.dos ?? []
  if (!donts.length && !dos.length) return ''
  const lines: string[] = ['【设计规范约束】必须严格遵守：']
  dos.forEach((d) => lines.push(`- 应当：${d}`))
  donts.forEach((d) => lines.push(`- 禁止：${d}`))
  return lines.join('\n')
}
