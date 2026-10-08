// src/services/ai/enhancer.ts
// F-PE-01 提示词增强器：L0~L3 分级 + 8 区块结构化输出
// 大部分逻辑为纯本地纯函数，可脱离模型做单元测试（对应 docs/功能设计-提示词增强.md）

import type { ConfigPublic } from '@shared/design'
import { ENHANCER_SYSTEM, buildEnhanceUserPrompt } from './prompt-templates'
import { chatOnce } from './client'

/* ------------------------------ 术语映射 ------------------------------ */

const TERM_MAP: Array<[RegExp, string]> = [
  [/好看|美观|漂亮/g, '视觉层级清晰、留白充足、配色协调'],
  [/简洁|简单点|干净/g, '信息密度低、弱化装饰、以内容为主体'],
  [/高级感|质感/g, '克制的色彩、精细的间距节奏、恰当的阴影层次'],
  [/不要太花|别太花哨/g, '降低色彩数量、避免渐变与装饰性图形'],
  [/现代|时尚/g, '扁平化、圆角适中、清晰的字阶'],
  [/扁平/g, '无多余投影、以色彩与留白区分层级'],
]

function normalizeTerms(text: string): { text: string; changed: string[] } {
  let out = text
  const changed: string[] = []
  for (const [re, replacement] of TERM_MAP) {
    if (re.test(out)) {
      out = out.replace(re, replacement)
      changed.push(`${re.source} → ${replacement}`)
    }
  }
  return { text: out, changed }
}

/* ------------------------------ 输入分级 ------------------------------ */

export type PromptLevel = 'L0' | 'L1' | 'L2' | 'L3'

export interface ClassifyResult {
  level: PromptLevel
  /** 是否建议走增强 */
  suggest: boolean
  reasons: string[]
  pageHint: number
}

const PAGE_WORDS = /(页面|界面|screen|page|首页|详情|列表|我的|登录|注册|购物车|订单|报表|看板|dashboard)/gi

export function classify(raw: string): ClassifyResult {
  const text = raw.trim()
  const len = text.length
  const reasons: string[] = []

  const structural = /(包含|含有|包括|有.{0,6}(页|个)|查询|列表|详情|首页)/.test(text)
  const pageMatches = (text.match(PAGE_WORDS) ?? []).length
  const hasStyle = /(风格|配色|色系|极简|商务|可爱|科技|清新|简洁|高级)/.test(text)
  const hasDevice = /(手机|移动|App|APP|小程序|桌面|电脑|网页|Web|web|平板)/.test(text)

  // L3 的判定核心是「信息完备度」而非纯粹长度：
  // 结构、风格、设备三者齐全，且描述已足够展开（≥60 字）即认为是已结构化的输入。
  const complete = structural && pageMatches >= 2 && hasStyle && hasDevice

  let level: PromptLevel
  if (len <= 6) {
    level = 'L0'
    reasons.push('输入过短，信息量不足')
  } else if (len < 20 || (!structural && pageMatches <= 1)) {
    level = 'L1'
    reasons.push('描述偏碎片化，缺少结构信息')
  } else if (len >= 60 && complete) {
    level = 'L3'
  } else {
    level = 'L2'
    if (!hasStyle) reasons.push('未指定视觉风格')
    if (!hasDevice) reasons.push('未指定目标设备')
    if (!structural || pageMatches < 2) reasons.push('页面结构信息不足')
  }

  const suggest = level !== 'L3'
  if (suggest && level !== 'L0') reasons.push('建议增强以获得更稳定的生成结果')

  return { level, suggest, reasons, pageHint: Math.max(1, pageMatches) }
}

/* --------------------------- 本地启发式增强 --------------------------- */

export interface EnhanceResult {
  level: PromptLevel
  enhanced: string
  notes: string[]
  usedLLM: boolean
}

function isMobile(text: string): boolean {
  if (/(手机|移动|App|APP|小程序)/.test(text)) return true
  if (/(桌面|电脑|网页|Web|后台|管理端|平板)/.test(text)) return false
  return true // 默认移动端
}

function isDesktop(text: string): boolean {
  return /(桌面|电脑|网页|Web|后台|管理端|大屏|看板)/.test(text)
}

/**
 * 页面识别：优先直接扫描全文中的页面关键词。
 * 这比「先切功能点再判断」更鲁棒——功能点切分依赖标点与连接词，
 * 「商品详情」这类不含"页"字的短语会被漏掉。
 */
const PAGE_PATTERNS: Array<{ re: RegExp; name: string }> = [
  { re: /首页|主页|主页面|推荐页/, name: '首页' },
  { re: /详情|详细页|商品页|内容页/, name: '详情页' },
  { re: /列表页|清单页|记录页|订单页|预约页|历史页/, name: '列表页' },
  { re: /个人中心|我的|个人主页|账户页|设置页/, name: '个人中心' },
  { re: /登录|注册|验证码/, name: '登录页' },
  { re: /购物车|下单页|结算页|订单确认/, name: '购物车' },
  { re: /报表|统计页|数据页|看板|仪表盘|dashboard/i, name: '数据看板' },
  { re: /地图|定位|附近/, name: '地图页' },
  { re: /消息页|聊天|会话|私信/, name: '消息页' },
  { re: /搜索页|筛选页/, name: '搜索页' },
  { re: /分类页|类目/, name: '分类页' },
]

/** 从全文识别页面清单，保持出现顺序 */
function detectPages(text: string): string[] {
  const hits: Array<{ idx: number; name: string }> = []
  for (const { re, name } of PAGE_PATTERNS) {
    const m = re.exec(text)
    if (m && m.index >= 0) hits.push({ idx: m.index, name })
  }
  hits.sort((a, b) => a.idx - b.idx)
  const seen = new Set<string>()
  const out: string[] = []
  for (const h of hits) {
    if (seen.has(h.name)) continue
    seen.add(h.name)
    out.push(h.name)
  }
  return out
}

/** 从描述里粗抽出可能的功能点（作为页面识别的兜底） */
function extractFeatures(text: string): string[] {
  const seg = text
    .replace(/[，。；、,.;!！?？\n]/g, '|')
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)

  const feats: string[] = []
  for (const s of seg) {
    if (/(包含|包括|含有|要有|需要有|加上|以及|和)/.test(s) || /(页|表|单|卡|列表|图|栏)/.test(s)) {
      feats.push(s.replace(/^(.*?)(包含|包括|含有|要有|需要有|加上|以及|和)/, '').trim() || s)
    }
  }
  if (feats.length === 0) feats.push(text.trim())
  return [...new Set(feats)].slice(0, 8)
}

/** 判断某功能点对应什么页面 */
function toPageName(feature: string): string {
  const f = feature
  for (const { re, name } of PAGE_PATTERNS) {
    if (re.test(f)) return name
  }
  return '功能页'
}

export function enhanceHeuristic(raw: string, cfg?: ConfigPublic): EnhanceResult {
  const text = raw.trim()
  const cls = classify(text)
  const notes: string[] = []
  const { text: normalized, changed } = normalizeTerms(text)
  if (changed.length) notes.push(`术语规范化：${changed.join('，')}`)

  const device = isDesktop(normalized) ? '桌面端' : isMobile(normalized) ? '移动端' : '未知'
  if (!/(手机|移动|App|APP|小程序|桌面|电脑|网页|Web|平板)/.test(text)) {
    notes.push(`[推断] 未指定设备，按${device}处理`)
  }

  const hasStyle = /(风格|配色|色系|极简|商务|可爱|科技|清新|高级)/.test(text)
  if (!hasStyle) notes.push('[推断] 未指定视觉风格，采用「清透蓝」中性配色')

  const feats = extractFeatures(normalized)
  // 优先用全文直接识别页面；识别不到再退回功能点映射
  const detected = detectPages(normalized)
  const pages = detected.length ? detected : [...new Set(feats.map(toPageName))]
  const pageList = pages.length ? pages : ['首页']

  const canvas = device === '桌面端' ? '1440 × 900' : '390 × 844'

  const sectionsByPage: Record<string, string[]> = {
    首页: ['顶部导航栏', '主视觉 / 欢迎区', '核心功能入口', '内容推荐列表'],
    详情页: ['返回导航', '主信息区', '详细说明', '底部操作按钮'],
    列表页: ['顶部标题', '筛选 / 搜索', '数据列表', '分页或加载更多'],
    个人中心: ['用户信息头部', '功能入口列表', '设置分组'],
    登录页: ['品牌标识', '账号密码输入', '登录按钮', '第三方登录'],
    购物车: ['商品清单', '数量编辑', '合计金额', '结算按钮'],
    数据看板: ['侧边导航', '关键指标卡片', '趋势图表', '明细表格'],
    地图页: ['地图容器', '搜索框', '结果列表'],
    消息页: ['会话列表', '未读标记'],
    搜索页: ['搜索输入框', '筛选条件', '结果列表'],
    分类页: ['分类导航', '分类内容区'],
    功能页: ['顶部标题', '主体内容区', '底部操作'],
  }

  const lines: string[] = []
  lines.push('## 1. 产品概述')
  lines.push(`${pageList.length > 1 ? '一个' : '一个'}包含${pageList.length}个页面的${device}产品${hasStyle ? '' : '，采用中性清爽的视觉方案'}。`)
  lines.push('')
  lines.push('## 2. 目标用户与场景')
  lines.push(`面向使用${device}的目标用户，用于完成「${feats[0] ?? text}」相关任务。`)
  lines.push('')
  lines.push('## 3. 页面结构')
  pageList.forEach((p, i) => {
    lines.push(`${i + 1}. \`${p}\` — ${feats[i] ?? '承载对应功能'}`)
  })
  lines.push('')
  lines.push('## 4. 各页面关键区块')
  pageList.forEach((p) => {
    lines.push(`**${p}**`)
    ;(sectionsByPage[p] ?? sectionsByPage['功能页']).forEach((s) => lines.push(`- ${s}`))
    lines.push('')
  })
  lines.push('## 5. 核心交互')
  if (pageList.length > 1) {
    lines.push(`- 从「${pageList[0]}」出发，点击列表项进入「${pageList[1] ?? '详情页'}」`)
    lines.push('- 底部 / 顶部导航支持在主要页面之间切换')
  } else {
    lines.push('- 页面内主要操作通过底部主按钮触发')
  }
  lines.push('')
  lines.push('## 6. 视觉风格')
  lines.push(hasStyle ? '沿用用户指定风格。' : '[推断] 清透蓝配色：主色 #3B82F6，浅灰背景，圆角适中，留白充足。')
  lines.push('')
  lines.push('## 7. 设备与尺寸')
  lines.push(`${device}，画布 ${canvas}。`)
  lines.push('')
  lines.push('## 8. 待确认事项')
  lines.push('- 是否需要登录 / 账号体系？')
  lines.push('- 是否有品牌色或既有设计规范需要遵循？')

  return {
    level: cls.level,
    enhanced: lines.join('\n'),
    notes,
    usedLLM: false,
  }
}

/* --------------------------- 意图保全校验 --------------------------- */

/** 停用词：不作为意图实体参与校验 */
const STOP_WORDS = new Set([
  '一个', '一下', '可以', '需要', '想要', '帮我', '做', '搞', '弄', '来', '个', '的', '了',
  '要', '有', '和', '与', '以及', '或者', '还有', '这个', '那个', '什么', '怎么',
  '页面', '界面', '设计', '风格', '好看', '美观', '简洁', '简单', '清楚', '明白',
  'app', 'web', 'ui', 'ux', '页面', '端', '版',
])

/**
 * 从原始输入中抽取「意图实体」：用户明确说出的业务对象与功能点。
 *
 * 关键约束：抽取的结果必须是「最小语义单元」。
 * 早期实现用 /[\u4e00-\u9fa5]{2,8}/ 直接抓连续汉字，会把「做一个电商」「要有优惠券」
 * 这类带连接词的整句也当成实体，导致校验时永远判定缺失（假阳性）。
 * 这里改为：先按标点/连接词切分，再对每个片段取核心名词。
 */
export function extractEntities(raw: string): string[] {
  const text = raw.trim()
  const found = new Set<string>()

  // 1) 先按标点与连接词切成短句
  const clauses = text
    .split(/[，。；、,.;!！?？\n]|以及|还有|并且|然后|同时|和(?=[\u4e00-\u9fa5]{2})|与(?=[\u4e00-\u9fa5]{2})/)
    .map((s) => s.trim())
    .filter(Boolean)

  for (const clause of clauses) {
    // 2) 去掉句首的动词/意图词，只留业务对象
    const core = clause
      .replace(/^(我想|我要|想要|需要|要有|需要有|帮我|做|搞|弄|来|个|一个|一款|一款|包含|含有|包括|要有|加上|可以|能够|支持|上面有|里面有)+/g, '')
      .trim()
    if (!core) continue

    // 3) 从片段里抓 2~6 字的候选词
    const words = core.match(/[\u4e00-\u9fa5]{2,6}/g) ?? []
    for (const raw of words) {
      // 剥离尾部泛化后缀：「发票功能」→「发票」，「订单页面」→「订单」
      const w = raw.replace(/(功能|能力|页面|界面|模块|系统|服务|内容|信息|管理)+$/, '')
      if (w.length < 2) continue
      if (STOP_WORDS.has(w)) continue
      if (/^(我们|他们|你们|这个|那个|一些|很多|非常|特别|比较|稍微|上面|下面|里面|外面|然后|还有)/.test(w)) continue
      found.add(w)
    }

    // 4) 英文技术词
    const en = core.match(/[a-zA-Z][a-zA-Z0-9+#.-]{2,}/gi) ?? []
    for (const w of en) {
      const low = w.toLowerCase()
      if (['app', 'web', 'the', 'and', 'for', 'with', 'page', 'screen'].includes(low)) continue
      found.add(w)
    }
  }

  // 5) 领域名词后缀识别（"优惠券" / "积分" / "发票" 这类）
  const domain = text.match(/[\u4e00-\u9fa5]{2}(?:券|卡|单|表|图|码|包|库|点|值|率|额|期|号|条|项)/g) ?? []
  for (const w of domain) found.add(w)

  // 去掉被更长实体内包含的短实体，减少噪声
  const list = [...found].filter((w) => w.length >= 2)
  return list.filter((w) => !list.some((other) => other !== w && other.includes(w) && other.length > w.length))
}

export interface IntentCheckResult {
  pass: boolean
  /** 在增强结果中找不到的实体 */
  missing: string[]
  checked: number
}

/**
 * 校验增强结果是否保留了原始输入的全部意图实体。
 * 对应 docs/功能设计-提示词增强.md §8 的 R-13 红线。
 */
export function verifyIntent(raw: string, enhanced: string): IntentCheckResult {
  const entities = extractEntities(raw)
  if (!entities.length) return { pass: true, missing: [], checked: 0 }

  const hay = enhanced.replace(/\s+/g, '')
  const missing = entities.filter((e) => !hay.includes(e.replace(/\s+/g, '')))

  // 允许少量误报（实体抽取本身有噪声），缺失超过 1/3 才判定失败
  const pass = missing.length <= Math.max(1, Math.floor(entities.length / 3))
  return { pass, missing, checked: entities.length }
}

/* ------------------------------ LLM 增强 ------------------------------ */

/** 用模型增强；失败或意图校验不通过时回退到本地启发式 */
export async function enhancePrompt(raw: string, cfg?: ConfigPublic): Promise<EnhanceResult> {
  const local = enhanceHeuristic(raw, cfg)
  if (!cfg) return local

  try {
    const res = await chatOnce(
      cfg.id,
      [
        { role: 'system', content: ENHANCER_SYSTEM },
        { role: 'user', content: buildEnhanceUserPrompt(raw) },
      ],
      { temperature: 0.25, maxTokens: 2400 },
    )
    const text = stripFences(res.content).trim()
    if (text.length < 60 || !text.includes('##')) {
      return { ...local, notes: [...local.notes, '模型输出格式异常，已使用本地规则增强'] }
    }

    // 意图保全校验（红线）：不通过则回退，避免"增强反而丢需求"
    const check = verifyIntent(raw, text)
    if (!check.pass) {
      return {
        ...local,
        notes: [...local.notes, `增强结果可能遗漏了「${check.missing.join('、')}」，已回退到本地规则`],
      }
    }

    return {
      level: local.level,
      enhanced: text,
      notes: check.checked > 0 ? [`已由模型改写成结构化需求，保留全部 ${check.checked} 个关键点`] : ['已由模型改写成结构化需求'],
      usedLLM: true,
    }
  } catch {
    return { ...local, notes: [...local.notes, '模型调用失败，已使用本地规则增强'] }
  }
}

/** 去掉 ``` 围栏 */
export function stripFences(s: string): string {
  const t = s.trim()
  const m = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(t)
  if (m) return m[1]
  return t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '')
}

export { classify as classifyPrompt }
