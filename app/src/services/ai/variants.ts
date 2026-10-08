// src/services/ai/variants.ts
// 变体生成：对指定页面生成多个差异化设计方案，供用户挑选。
// 对标 Stitch 的 variantCount / aspects 能力（docs/S1-2 C-9）。
//
// 【报错修复说明】原实现存在三处根因，导致「生成设计变体」频繁报错：
//   1. maxTokens 写死 12000 —— 远超 OpenAI 兼容 json_object 模式的常见上限 8192，
//      服务端要么直接拒绝，要么把 JSON 截断，截断后的文本 extractJson 抠不出完整对象。
//   2. 只做 extractJson + lenientParse，没有结构校验与修复重试 ——
//      一次失败即抛错，用户看到的是原始英文异常。
//   3. 任一变体坏掉就整批失败 —— 现在改为逐个宽容处理，坏的降级为占位卡片。
// 修复方式：统一走 askJson 范式（校验 + 修复重试），maxTokens 经 clampMaxTokens 封顶，
// 载荷解析交给 repairVariantsPayload 逐项容错。
import type { DesignJSON, Node, Page } from '@shared/design'
import { askJson } from './ask-json'
import { repairNode, repairVariantsPayload, validateVariantPayload } from './parse'
import { TEMP } from './prompt-templates'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

/** 变体维度：对应 Stitch 的 aspects */
export type VariantAspect = 'layout' | 'color' | 'typography' | 'content' | 'imagery'

export const ASPECT_META: Array<{ id: VariantAspect; label: string; desc: string }> = [
  { id: 'layout', label: '布局结构', desc: '重新组织区块排布与信息层级' },
  { id: 'color', label: '配色方案', desc: '调整色彩与氛围，保持结构不变' },
  { id: 'typography', label: '字体排版', desc: '改变字阶、字重与间距节奏' },
  { id: 'content', label: '文案内容', desc: '换一套措辞与信息表达' },
  { id: 'imagery', label: '视觉元素', desc: '调整图形、图标与占位方式' },
]

export interface Variant {
  id: string
  /** 该变体强调的差异维度 */
  aspects: VariantAspect[]
  /** 一句话说明这个变体的思路 */
  rationale: string
  /** 页面骨架 */
  page: Page
  /** 生成失败时的错误信息 */
  error?: string
}

const ASPECT_INSTRUCTION: Record<VariantAspect, string> = {
  layout: '重新设计区块的组织方式与信息层级：改变排列顺序、分组方式、栅格结构。不要只是微调间距。',
  color: '保持结构完全不变，只调整配色：主色、辅助色、背景层次、强调色的使用位置。给出明显不同的色彩气质。',
  typography: '保持结构与配色不变，只调整文字排版：字阶对比、字重搭配、行高与字间距节奏。',
  content: '保持所有视觉设计不变，只替换文案：换一套更贴合场景的表达，信息点保持一致。',
  imagery: '调整视觉元素的呈现方式：图形、图标、占位图的样式与位置，用形状构建更强的视觉节奏。',
}

/** 变体数量上限（与 UI 保持一致） */
export const MAX_VARIANTS = 5

/** 规范化维度列表：去重 + 只保留已知维度，空则给一个默认 */
export function normalizeAspects(input: unknown): VariantAspect[] {
  const known = new Set(ASPECT_META.map((m) => m.id))
  const list = Array.isArray(input) ? input : []
  const out: VariantAspect[] = []
  for (const a of list) {
    if (typeof a === 'string' && known.has(a as VariantAspect) && !out.includes(a as VariantAspect)) {
      out.push(a as VariantAspect)
    }
  }
  return out.length ? out : ['layout']
}

/** 收敛变体数量到 [1, MAX_VARIANTS] */
export function normalizeCount(input: unknown): number {
  const n = typeof input === 'number' && Number.isFinite(input) ? Math.floor(input) : 1
  return Math.max(1, Math.min(MAX_VARIANTS, n))
}

/** 构建变体生成 Prompt */
export function buildVariantPrompt(args: {
  design: DesignJSON
  page: Page
  aspects: VariantAspect[]
  count: number
}): string {
  const { design, page, aspects, count } = args
  const focus = aspects
    .map((a) => `- ${ASPECT_META.find((m) => m.id === a)?.label}：${ASPECT_INSTRUCTION[a]}`)
    .join('\n')

  return `你是资深 UI 设计师。请为下面的页面生成 ${count} 个**差异化**的设计变体。

项目：${design.meta.name}
设备：${design.meta.device}　画布：${design.meta.canvas.width} × ${design.meta.canvas.height}

当前设计 Token（可作为参考，但变体可在这些基础上调整）：
${JSON.stringify(design.tokens, null, 2)}

当前页面结构（这是基线，请在此基础上变化）：
${JSON.stringify({ id: page.id, name: page.name, root: page.root })}

【差异化要求】每个变体必须聚焦以下维度做出**明显可辨**的差异：
${focus}

【关键约束】
- 每个变体都必须是一个**完整可用**的页面，包含真实中文文案，不能是残缺骨架。
- 各变体之间的差异要肉眼可辨，不要只是颜色深浅的微调。
- 节点结构与字段规范与基线保持一致。
- 变体数量必须严格等于 ${count} 个。
- 控制单页节点数在 60 个以内，避免输出被截断。
- 只输出 JSON，不要任何解释、不要代码围栏。

输出格式：
{
  "variants": [
    {
      "aspects": ["${aspects[0] ?? 'layout'}"],
      "rationale": "一句话说明这个变体的设计思路（20字以内）",
      "root": NODE
    }
  ]
}

其中 NODE 与基线页面根节点同构：{ "id": "...", "type": "frame", "name": "...", "layout": {...}, "style": {...}, "props": {...}, "children": [...] }`
}

/** 生成变体（不写入 store，由 UI 决定是否应用） */
export async function generateVariants(args: {
  configId: string
  pageId: string
  aspects: VariantAspect[]
  count: number
  shouldAbort?: () => boolean
  onProgress?: (done: number, total: number) => void
}): Promise<Variant[]> {
  const ui = useUiStore.getState()
  const state = useProjectStore.getState()
  const design = state.design
  const page = design.pages.find((p) => p.id === args.pageId)
  if (!page) throw new Error('页面不存在')

  const aspects = normalizeAspects(args.aspects)
  const total = normalizeCount(args.count)

  // 一次请求生成多个变体（比多次单请求更省额度，且差异更成体系）。
  // maxTokens 不在此处硬编码 —— askJson 会统一封顶到 HARD_MAX_TOKENS(8192)，
  // 这正是原先写死 12000 导致「模型输出被截断 → 解析失败」的修复点。
  const payload = await askJson({
    configId: args.configId,
    system: '你是资深 UI 设计师，只输出 JSON。',
    user: buildVariantPrompt({ design, page, aspects, count: total }),
    temperature: TEMP.variant,
    validate: (o) => {
      const v = validateVariantPayload(o)
      return { ok: v.ok, errors: v.errors }
    },
    maxTokens: 8192,
    stageName: '变体生成',
  })

  if (args.shouldAbort?.()) throw new Error('ABORTED')

  const { items, warnings } = repairVariantsPayload(payload, total)
  for (const w of warnings) ui.toast('warn', `变体生成：${w}`)

  const out: Variant[] = items.map((it, i) => {
    const base: Variant = {
      id: `var_${Date.now().toString(36)}_${i}`,
      aspects: it.aspects.length ? normalizeAspects(it.aspects) : aspects,
      rationale: it.rationale,
      page: { ...page, root: it.root ?? page.root },
    }
    if (it.error) base.error = it.error
    // 变体根节点保持与基线页面同构（撑满画布），避免预览塌陷
    if (it.root) base.page.root = repairNode(it.root, 0)
    args.onProgress?.(i + 1, items.length)
    return base
  })

  if (!out.length) throw new Error('模型未返回任何可用变体')
  return out
}

/** 采纳某个变体：替换当前页面的根节点 */
export function applyVariant(pageId: string, variant: Variant): void {
  useProjectStore.getState().commit(`采纳变体：${variant.rationale}`, (d) => ({
    ...d,
    pages: d.pages.map((p) => (p.id === pageId ? { ...p, root: variant.page.root } : p)),
  }))
}

/**
 * 把变体树里的节点与原页面对比，统计结构差异数量。
 * 用于 UI 展示「该变体改动了 N 个节点」，让差异可量化。
 */
export function diffNodeCount(baseline: Node, variant: Node): number {
  const flatten = (n: Node, into: Map<string, Node>) => {
    into.set(n.id, n)
    n.children?.forEach((c) => flatten(c, into))
  }
  const a = new Map<string, Node>()
  const b = new Map<string, Node>()
  flatten(baseline, a)
  flatten(variant, b)

  let changed = 0
  for (const [id, nb] of b) {
    const na = a.get(id)
    if (!na) {
      changed++
      continue
    }
    if (JSON.stringify(na) !== JSON.stringify(nb)) changed++
  }
  for (const id of a.keys()) if (!b.has(id)) changed++
  return changed
}

/**
 * 原 `generateNodeVariants` / `replaceInTree` 已删除。
 * 二者在全项目零调用方 —— UI 的变体入口只走 `generateVariants`（整页变体），
 * 保留只会让后续维护者误以为存在「元素级变体」能力。若将来要做，应在此重新设计，
 * 而不是沿用那段未经校验、也未接入 store 的旧实现。
 */
