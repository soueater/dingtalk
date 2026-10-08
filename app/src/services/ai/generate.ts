// src/services/ai/generate.ts
// 三阶段生成流水线：A 规划 → B Token 定稿 → C 逐页生成
import type { DesignJSON, Page } from '@shared/design'
import { SCHEMA_VERSION } from '@shared/design'
import { askJson } from './ask-json'
import { TEMP, buildPlanPrompt, buildPagePrompt, buildTokensPrompt } from './prompt-templates'
import {
  assembleProject,
  normalizeFlows,
  repairPagePayload,
  validatePagePayload,
  validatePlanPayload,
} from './parse'
import { DEVICE_CANVAS, STYLE_PRESETS } from '@/services/design/style-presets'
import { cloneTokens, findSpec, presetIdOf, specConstraintsForPrompt } from '@/services/design/specs'
import {
  buildInterfacePlanPrompt,
  groupPlanItems,
  normalizePlanPages,
  validateInterfacePlanPayload,
  type InterfacePlanItem,
} from './plan-interfaces'
import { createPageGroup, PAGE_GAP_X, posForIndex } from '@shared/interfaces'
import { DEFAULT_QUOTA } from '@shared/design'
import { uid } from '@/lib/id'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

export interface GenerateOptions {
  configId: string
  onStage?: (stage: string, done: number, total: number) => void
  shouldAbort?: () => boolean
  /**
   * F-ST-01：本次生成要套用的设计规范 id。
   * 传了就跳过阶段 B 的模型调用，直接把规范 Token 作为定稿结果；
   * 未传则维持原行为（由模型定稿，失败退回预设）。
   */
  specId?: string
  /** 规范集合来源（用于解析 specId 对应的规范；内置规范命中内置表，无需在此传入） */
  specSource?: Pick<DesignJSON, 'specs'>
  /**
   * F-PM-05：本次要生成的界面数 N。
   * 传了就作为规划阶段的硬约束（不足则补位、超出则截断）；不传则沿用旧行为（最多 8 屏）。
   */
  planned?: number
}

interface PlanShape {
  projectName?: string
  device?: string
  canvas?: { width: number; height: number }
  styleDirection?: string
  pages?: Array<{ id: string; name: string; purpose?: string; keySections?: string[] }>
  flows?: Array<{ from: string; to: string; trigger?: string }>
}

function assertNotAborted(opts: GenerateOptions) {
  if (opts.shouldAbort?.()) throw new Error('ABORTED')
}

/**
 * 位置参数适配器：保留原有调用形态，实现委托给公共 ask-json 模块。
 * 抽取的动因见 src/services/ai/ask-json.ts 头部注释（变体链路绕开了这套容错）。
 */
function askStage(
  configId: string,
  system: string,
  user: string,
  temperature: number,
  validate: (o: unknown) => { ok: boolean; errors: string[] },
  maxTokens = 8192,
  stageName = '',
): Promise<unknown> {
  return askJson({ configId, system, user, temperature, validate, maxTokens, stageName })
}

/** 主入口：生成完整项目并写入 store */
export async function generateProject(userPrompt: string, opts: GenerateOptions): Promise<DesignJSON> {
  const ui = useUiStore.getState()

  /* ============ 阶段 A：信息架构规划 ============ */
  assertNotAborted(opts)
  opts.onStage?.('正在规划页面结构…', 0, 0)

  const plan = (await askStage(
    opts.configId,
    '你是资深产品设计师，只输出 JSON。',
    buildPlanPrompt(userPrompt),
    TEMP.plan,
    (o) => validatePlanPayload(o),
    4096,
    '规划阶段',
  )) as PlanShape

  assertNotAborted(opts)

  // F-PM-05：N 是输入而非结果 —— 指定了 planned 就规整到恰好 N 条，否则维持旧行为（≤8 屏）
  const planPagesRaw = (plan.pages ?? []).filter((p) => p && p.id && p.name)
  const planPages: InterfacePlanItem[] = opts.planned
    ? normalizePlanPages(planPagesRaw, opts.planned)
    : planPagesRaw.slice(0, 8).map((p) => ({
        id: p.id,
        name: p.name,
        purpose: p.purpose,
        keySections: p.keySections,
      }))
  if (!planPages.length) throw new Error('规划阶段未返回任何可用页面')
  const device = plan.device ?? 'MOBILE'
  const canvas = plan.canvas?.width ? plan.canvas : (DEVICE_CANVAS[device] ?? DEVICE_CANVAS.MOBILE)

  /* ============ 阶段 B：设计 Token 定稿 ============ */
  assertNotAborted(opts)

  // F-ST-01：绑定规范时，Token 由规范直接决定 —— 跳过模型调用，
  // 既省一次请求，也保证「规范 = 唯一事实来源」不再被模型自由发挥破坏。
  const boundSpec = opts.specId
    ? findSpec(opts.specSource ?? { specs: [] }, opts.specId)
    : undefined

  let tokens: DesignJSON['tokens']
  if (boundSpec) {
    opts.onStage?.(`正在套用设计规范「${boundSpec.name}」…`, 0, 0)
    tokens = cloneTokens(boundSpec.tokens)
  } else {
    opts.onStage?.('正在定稿设计规范…', 0, 0)
    try {
      tokens = (await askStage(
        opts.configId,
        '你是资深 UI 设计师，只输出 JSON。',
        buildTokensPrompt(plan, userPrompt),
        TEMP.tokens,
        (o) => {
          const t = o as Record<string, unknown> | null
          if (!t || typeof t !== 'object') return { ok: false, errors: ['不是对象'] }
          if (!t.color || typeof t.color !== 'object') return { ok: false, errors: ['缺少 color'] }
          return { ok: true, errors: [] }
        },
        3072,
        'Token 阶段',
      )) as DesignJSON['tokens']
    } catch {
      // Token 阶段失败不致命：退回预设
      tokens = JSON.parse(JSON.stringify(STYLE_PRESETS[0].tokens))
    }
  }

  // Token 兜底：确保关键色存在
  tokens.color = { ...STYLE_PRESETS[0].tokens.color, ...(tokens.color ?? {}) }

  // 规范约束段落：注入逐页 Prompt，让模型在不自创颜色的同时遵守负面规则
  const specConstraints = boundSpec ? specConstraintsForPrompt(boundSpec) : ''

  /* ============ 阶段 C：逐页生成 ============ */
  const pages: Page[] = []
  const flows: DesignJSON['flows'] = []
  const existingPages = planPages.map((p) => ({ id: p.id, name: p.name }))

  for (let i = 0; i < planPages.length; i++) {
    assertNotAborted(opts)
    const p = planPages[i]
    opts.onStage?.(`正在生成「${p.name}」…`, i, planPages.length)

    let payload: unknown
    try {
      payload = await askStage(
        opts.configId,
        '你是资深 UI 设计工程师，只输出 JSON。',
        buildPagePrompt({
          userPrompt,
          plan,
          tokens,
          page: { id: p.id, name: p.name, purpose: p.purpose, keySections: p.keySections ?? [] },
          canvas,
          device,
          existingPages,
          specConstraints,
        }),
        TEMP.page,
        (o) => validatePagePayload(o),
        8192,
        `${p.name}`,
      )
    } catch (e) {
      ui.toast('warn', `页面「${p.name}」生成失败，已跳过：${(e as Error).message}`)
      continue
    }

    const { page, flows: pageFlows, warnings } = repairPagePayload(payload, p.id)
    for (const w of warnings) ui.toast('warn', `「${p.name}」：${w}`)

    // 保证节点 id 唯一（跨页可能重复）
    dedupeIdsAcrossPages(page.root, pages)

    pages.push(page)
    flows.push(...pageFlows)
  }

  if (!pages.length) throw new Error('所有页面生成均失败')

  /* ============ 组装 ============ */
  opts.onStage?.('正在整理画布…', pages.length, planPages.length)

  // 自定义规范要随项目一起落盘；内置规范由代码提供，不写入文件
  const carriedSpecs =
    boundSpec && presetIdOf(boundSpec.id) == null
      ? (opts.specSource?.specs ?? []).filter((s) => s.id === boundSpec.id)
      : undefined

  const project = assembleProject({
    name: plan.projectName || 'AI 生成项目',
    device,
    canvas,
    tokens,
    pages,
    flows: normalizeFlows(flows, pages),
    prompt: userPrompt,
    specId: boundSpec?.id,
    specs: carriedSpecs,
    // F-PM-05：把「计划几屏」写进项目，后续补页以此为准
    quota: { ...DEFAULT_QUOTA, planned: Math.max(1, opts.planned ?? pages.length) },
    pageGroups: pageGroupsForPlan(planPages, pages),
  })

  // 写入 store
  const st = useProjectStore.getState()
  st.loadProject('', { fileVersion: '1.0', design: project })
  useProjectStore.setState({ dirty: true })

  return project
}

/**
 * 按规划里的 groupName 建立界面分组，并把对应界面挂进去。
 * 只在同一模块有 ≥2 个界面时才建组（`groupPlanItems` 已做该过滤）——
 * 单屏自成一组没有意义，反而把分组列表撑得很啰嗦。
 */
function pageGroupsForPlan(
  planPages: InterfacePlanItem[],
  pages: Page[],
): DesignJSON['pageGroups'] | undefined {
  const grouped = groupPlanItems(planPages)
  if (!grouped.size) return undefined

  const groups = [...grouped.entries()].map(([name], i) => createPageGroup(name, i))
  const idByName = new Map(groups.map((g) => [g.name, g.id]))
  // 规划条目与最终页面按顺序一一对应（失败页会被跳过，故用名称兜底匹配）
  planPages.forEach((item, idx) => {
    const page = pages[idx]
    if (!page || !item.groupName) return
    const gid = idByName.get(item.groupName)
    if (gid) page.groupId = gid
  })
  return groups
}

/** 跨页 id 去重 */
function dedupeIdsAcrossPages(root: import('@shared/design').Node, existingPages: Page[]) {
  const used = new Set<string>()
  const collect = (n: import('@shared/design').Node) => {
    used.add(n.id)
    n.children?.forEach(collect)
  }
  existingPages.forEach((p) => collect(p.root))

  const walk = (n: import('@shared/design').Node) => {
    if (used.has(n.id)) {
      const old = n.id
      n.id = `${old}_${Math.random().toString(36).slice(2, 5)}`
    }
    used.add(n.id)
    n.children?.forEach(walk)
  }
  walk(root)
}

/** 过滤掉指向不存在页面的跳转（实现已下沉至 parse.ts，此处 re-export 保持既有引用可用） */
export { normalizeFlows }

export { SCHEMA_VERSION }

/* ========================================================================== */
/*  F-PM-05：按 N 生成 / 续生成界面                                            */
/* ========================================================================== */

export interface GenerateInterfacesOptions {
  configId: string
  /** 需求描述（沿用 AI 面板输入框里的内容） */
  prompt: string
  /** 本次要生成几个界面 */
  count: number
  /** true = 追加到当前项目；false = 用生成结果替换整个项目内容 */
  append: boolean
  onStage?: (stage: string, done: number, total: number) => void
  shouldAbort?: () => boolean
}

export interface GenerateInterfacesResult {
  /** 实际成功落盘的界面数 */
  added: number
  /** 计划数 */
  planned: number
  /** 失败的界面名 */
  failed: string[]
  /** 自动建立的分组名 */
  groups: string[]
}

/**
 * 按指定数量 N 生成界面，并（可选）追加到当前项目。
 *
 * 与 `generateProject` 的区别：这里**复用当前项目的 Token 与设备**，
 * 只做「规划 → 逐页生成 → 追加」，因此天然继承既有规范，不会把老界面风格冲掉。
 */
export async function generateInterfaces(
  opts: GenerateInterfacesOptions,
): Promise<GenerateInterfacesResult> {
  const ui = useUiStore.getState()
  const st = useProjectStore.getState()
  const design = st.design
  const device = design.meta.device
  const canvas = design.meta.canvas
  const tokens = design.tokens
  const existingPages = design.pages.map((p) => ({ id: p.id, name: p.name }))

  const boundSpec = design.meta.specId ? findSpec(design, design.meta.specId) : undefined
  const specConstraints = boundSpec ? specConstraintsForPrompt(boundSpec) : ''

  assertNotAborted(opts)

  /* ---------- 阶段 0：界面规划（N 是输入，不是结果） ---------- */
  opts.onStage?.(`正在规划 ${opts.count} 个界面…`, 0, opts.count)
  const rawPlan = (await askStage(
    opts.configId,
    '你是资深产品设计师，只输出 JSON。',
    buildInterfacePlanPrompt({
      prompt: opts.prompt,
      count: opts.count,
      device,
      existingNames: existingPages.map((p) => p.name),
    }),
    TEMP.plan,
    (o) => validateInterfacePlanPayload(o),
    4096,
    '界面规划',
  )) as { pages?: unknown; projectName?: string; styleDirection?: string }

  const planPages = normalizePlanPages(rawPlan?.pages, opts.count)
  if (!planPages.length) throw new Error('界面规划未返回任何可用条目')

  assertNotAborted(opts)

  /* ---------- 逐页生成 ---------- */
  const created: Page[] = []
  const createdFlows: DesignJSON['flows'] = []
  const failed: string[] = []
  const planShape = {
    projectName: rawPlan?.projectName,
    styleDirection: rawPlan?.styleDirection,
    device,
    canvas,
  }

  for (let i = 0; i < planPages.length; i++) {
    assertNotAborted(opts)
    const p = planPages[i]
    opts.onStage?.(`正在生成「${p.name}」…`, i, planPages.length)

    let payload: unknown
    try {
      payload = await askStage(
        opts.configId,
        '你是资深 UI 设计工程师，只输出 JSON。',
        buildPagePrompt({
          userPrompt: opts.prompt,
          plan: planShape,
          tokens,
          page: { id: p.id, name: p.name, purpose: p.purpose, keySections: p.keySections ?? [] },
          canvas,
          device,
          existingPages: [...existingPages, ...created.map((c) => ({ id: c.id, name: c.name }))],
          specConstraints,
        }),
        TEMP.page,
        (o) => validatePagePayload(o),
        8192,
        p.name,
      )
    } catch (e) {
      failed.push(p.name)
      ui.toast('warn', `界面「${p.name}」生成失败，已跳过：${(e as Error).message}`)
      continue
    }

    const { page, flows: pageFlows, warnings } = repairPagePayload(payload, `page_${uid()}`)
    for (const w of warnings) ui.toast('warn', `「${p.name}」：${w}`)
    // 用规划阶段的名称覆盖模型自造的名字，保证清单与产物一一对应
    page.name = p.name
    // 跨界面节点 id 去重（模型常在不同界面复用 id）
    dedupeIdsAcrossPages(page.root, [...design.pages, ...created])
    created.push(page)
    createdFlows.push(...pageFlows)
  }

  if (!created.length) throw new Error('所有界面生成均失败')

  /* ---------- 落盘（一次事务，可整体撤销） ---------- */
  opts.onStage?.('正在整理画布…', created.length, planPages.length)

  // 自动建分组：只在同一模块有 ≥2 个界面时才建，避免分组列表被单屏噪声撑满
  const groups = groupPlanItems(planPages)

  const stAny = useProjectStore.getState()
  if (opts.append) {
    stAny.commit(`生成 ${created.length} 个界面`, (d) => {
      const next = JSON.parse(JSON.stringify(d)) as DesignJSON
      // 新增分组
      const groupIdByName = new Map<string, string>()
      for (const [gname] of groups) {
        const g = createPageGroup(gname, (next.pageGroups ?? []).length)
        next.pageGroups = [...(next.pageGroups ?? []), g]
        groupIdByName.set(gname, g.id)
      }
      // 追加界面：坐标接在现有画布右侧
      let idx = 0
      for (const page of created) {
        const planItem = planPages[idx]
        const pos = posForIndex(next, idx)
        const pageWithPos: Page = { ...page, order: next.pages.length, pos }
        const gid = planItem?.groupName ? groupIdByName.get(planItem.groupName) : undefined
        if (gid) pageWithPos.groupId = gid
        next.pages = [...next.pages, pageWithPos]
        idx += 1
      }
      next.flows = normalizeFlows([...next.flows, ...createdFlows], next.pages)
      return next
    })
  } else {
    stAny.commit(`重新生成 ${created.length} 个界面`, (d) => {
      const next = JSON.parse(JSON.stringify(d)) as DesignJSON
      next.pages = created.map((page, idx) => ({ ...page, order: idx, pos: { x: idx * (canvas.width + PAGE_GAP_X), y: 0 } }))
      next.flows = normalizeFlows(createdFlows, next.pages)
      return next
    })
  }

  // 把当前选中切到第一个新界面，让用户立刻看到产物
  const after = useProjectStore.getState()
  const firstNew = after.design.pages[after.design.pages.length - created.length]
  if (firstNew) after.setActivePage(firstNew.id)

  return {
    added: created.length,
    planned: opts.count,
    failed,
    groups: [...groups.keys()],
  }
}

