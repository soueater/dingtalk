// src/services/ai/autofill-generate.ts —— F-ST-02 2A 补页的「模型调用」部分
//
// 为什么单独一个文件：
//   autofill.ts 刻意保持为纯函数层（不 import client / store），换来的是
//   可以脱离 Electron 环境做全量单测。而 2A 的补页必须真的调模型，
//   于是把「需要网络」的这一步单独放在这里，让纯逻辑与 IO 各归其位。
//
// 2A 的定位是「复用阶段 C」：不新造一套生成逻辑，而是把 buildPagePrompt +
// askJson + repairPagePayload 这套已经在主流水线里跑通的范式原样搬过来，
// 只把「页面清单」换成「断链检测推理出的缺失页」。这样补页的产出物
// 与首次生成完全同构（同样的 Node 结构、同样走 normalizeFlows 校验）。
import type { DesignJSON, Flow, Node, Page } from '@shared/design'
import { askJson } from './ask-json'
import { buildPagePrompt, TEMP } from './prompt-templates'
import { normalizeFlows, repairPagePayload, validatePagePayload } from './parse'
import { findSpec, specConstraintsForPrompt } from '@/services/design/specs'
import type { PageSuggestion } from './autofill'

/* ------------------------------- 类型 ------------------------------- */

export interface PageGenOptions {
  configId: string
  design: DesignJSON
  /** 用户勾选要补的页面建议 */
  picked: PageSuggestion[]
  /** 原始需求，用于让新页面的文案口径与既有页面一致 */
  userPrompt?: string
  onProgress?: (pageName: string, done: number, total: number) => void
  shouldAbort?: () => boolean
}

/** 单个补页的结果 */
export interface GeneratedPage {
  suggestion: PageSuggestion
  /** 成功时存在 */
  page?: Page
  /** 该页内联的跳转（指向已有页面） */
  flows: Flow[]
  /** 失败原因（该页降级跳过，不影响其它页） */
  error?: string
}

export interface GenerateMissingPagesResult {
  items: GeneratedPage[]
  /** 追加新页后的**新** design（未改动入参，供 UI 单事务 commit） */
  design: DesignJSON
  /** 本次新增的页面（供 UI 在 commit 时按需合并） */
  newPages: Page[]
  /** 本次新增的跳转（已过 normalizeFlows） */
  newFlows: Flow[]
  warnings: string[]
}

/* ------------------------------ 主流程 ------------------------------ */

/**
 * 逐页生成缺失页面。
 *
 * 容错策略与主流水线一致：**单页失败只跳过该页**，不拖垮整批，
 * 并把原因回传给 UI 展示，让用户知道哪一页没补上、为什么。
 */
export async function generateMissingPages(opts: PageGenOptions): Promise<GenerateMissingPagesResult> {
  const { configId, design, picked } = opts
  const warnings: string[] = []
  const items: GeneratedPage[] = []

  if (!picked.length) {
    return { items, design, newPages: [], newFlows: [], warnings }
  }

  const { canvas, device } = design.meta
  const boundSpec = findSpec(design, design.meta.specId)
  const specConstraints = boundSpec ? specConstraintsForPrompt(boundSpec) : ''
  const userPrompt = opts.userPrompt ?? design.meta.prompt ?? ''

  // 已生成页面的骨架摘要：让模型知道「项目里已经有哪些页」，
  // 从而把跳转指向真实存在的页面，而不是又造出一个悬空引用。
  const existingPages = design.pages.map((p) => ({ id: p.id, name: p.name }))

  /* 补齐 order 与坐标：新页要排到现有页之后，否则画布上会重叠 */
  const gap = 40
  let nextIndex = design.pages.length

  const newPages: Page[] = []
  const collectedFlows: Flow[] = []
  const usedIds = new Set<string>()
  design.pages.forEach((p) => collectIds(p.root, usedIds))

  for (let i = 0; i < picked.length; i++) {
    if (opts.shouldAbort?.()) {
      warnings.push('已中止，剩余页面未生成')
      break
    }
    const sug = picked[i]
    opts.onProgress?.(sug.name, i, picked.length)

    // 传给模型的「计划摘要」——补页没有阶段 A 的 plan，这里按当前项目现状合成一份，
    // 保证 buildPagePrompt 拿到的上下文与首轮生成同构。
    const plan = {
      projectName: design.meta.name,
      device,
      canvas,
      styleDirection: design.meta.prompt ?? '',
      pages: [
        ...design.pages.map((p) => ({ id: p.id, name: p.name })),
        ...picked.map((s) => ({ id: s.suggestedId, name: s.name, purpose: s.purpose })),
      ],
      flows: [],
    }

    let payload: unknown
    try {
      payload = await askJson({
        configId,
        system: '你是资深 UI 设计工程师，只输出 JSON，不要输出解释。',
        user: buildPagePrompt({
          userPrompt,
          plan,
          tokens: design.tokens,
          page: {
            id: sug.suggestedId,
            name: sug.name,
            purpose: sug.purpose,
            keySections: sug.keySections,
          },
          canvas,
          device,
          existingPages,
          specConstraints,
        }),
        temperature: TEMP.page,
        validate: (o) => validatePagePayload(o),
        maxTokens: 8192,
        stageName: `补页·${sug.name}`,
      })
    } catch (e) {
      items.push({ suggestion: sug, flows: [], error: (e as Error).message })
      continue
    }

    const { page, flows: pageFlows, warnings: w } = repairPagePayload(payload, sug.suggestedId)
    for (const x of w) warnings.push(`「${sug.name}」：${x}`)

    // 强制采用建议里的 id / 名称：模型偶尔会自作主张改掉它们
    page.id = sug.suggestedId
    if (!page.name) page.name = sug.name

    // 跨页 id 去重：模型不知道项目里已有的节点 id，必须由我们保证唯一
    dedupeIds(page.root, usedIds)

    page.order = nextIndex
    page.pos = { x: nextIndex * (canvas.width + gap), y: 0 }
    nextIndex++

    newPages.push(page)
    collectedFlows.push(...pageFlows)
    existingPages.push({ id: page.id, name: page.name })
    items.push({ suggestion: sug, page, flows: pageFlows })
  }

  opts.onProgress?.('', picked.length, picked.length)

  /* 组装新 design：追加页面 + 合并跳转，并走 normalizeFlows 统一校验 */
  const next: DesignJSON = JSON.parse(JSON.stringify(design)) as DesignJSON
  next.pages = [...next.pages, ...newPages]
  next.flows = normalizeFlows([...next.flows, ...collectedFlows], next.pages)
  // 只回报「因本次补页而新增」的跳转，避免 UI 误认为原有跳转也是新增
  const newFlows = next.flows.filter((f) => !design.flows.some((o) => o.from === f.from && o.to === f.to))

  return { items, design: next, newPages, newFlows, warnings }
}

/* ------------------------------ 工具 ------------------------------ */

function collectIds(root: Node, into: Set<string>): void {
  into.add(root.id)
  for (const c of root.children ?? []) collectIds(c, into)
}

/** 就地把重复 id 改名，保证跨页唯一 */
function dedupeIds(root: Node, used: Set<string>): void {
  const walk = (n: Node) => {
    if (used.has(n.id)) {
      const old = n.id
      let k = 1
      while (used.has(`${old}_${k}`)) k++
      n.id = `${old}_${k}`
    }
    used.add(n.id)
    for (const c of n.children ?? []) walk(c)
  }
  walk(root)
}
