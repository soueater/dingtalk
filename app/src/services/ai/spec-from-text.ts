// src/services/ai/spec-from-text.ts —— 由「文字描述」生成设计风格（模型调用层）
//
// 与 style-extract.ts 的分工：
//   style-extract.ts 是纯逻辑（HTML / 图片 → Token），可离线单测；
//   本文件是唯一需要网络的入口（文字描述 → Token），故单独放置。
// 模型输出的载荷一律经 normalizeSpecTokens 归一化，缺项用中性默认兜底，
// 保证「模型返回残缺 JSON」也不会产出把渲染搞坏的规范。
import type { DesignSpec, Tokens } from '@shared/design'
import { askJson } from './ask-json'
import { TEMP } from './prompt-templates'
import { createSpec } from '@/services/design/specs'
import { normalizeSpecTokens } from '@/services/design/style-extract'

const SYSTEM = '你是资深 UI 设计系统工程师，负责把风格描述转译为设计 Token。只输出 JSON，不要任何解释或 markdown。'

/** Token 键名约定必须与 style-presets.ts 一致，否则提炼结果无法直接套用 */
const COLOR_KEYS = [
  'primary', 'primaryHover', 'primaryActive', 'primarySoft', 'onPrimary',
  'bg', 'surface', 'surfaceAlt', 'border', 'borderStrong',
  'text', 'textSecondary', 'textMuted', 'textInverse',
  'success', 'warning', 'danger', 'info',
]

function buildUserPrompt(description: string, base?: Tokens): string {
  const lines = [
    '请根据以下风格描述，输出一套完整的设计 Token（JSON）。',
    '',
    `风格描述：${description.trim()}`,
    '',
    '输出结构（严格遵守键名，颜色用 6 位十六进制 #RRGGBB）：',
    '{',
    '  "color": {',
    COLOR_KEYS.map((k) => `    "${k}": "#RRGGBB"`).join(',\n'),
    '  },',
    '  "font": { "body": { "family": "字体名", "size": 15, "weight": 400, "lineHeight": 22 } },',
    '  "radius": { "sm": 6, "md": 10, "lg": 16, "xl": 24, "full": 999 },',
    '  "space": { "xs": 4, "sm": 8, "md": 16, "lg": 24, "xl": 32 },',
    '}',
    '',
    '要求：',
    '1. primary 是该风格的标志色；primaryHover/primaryActive 是它的加深或提亮变体；',
    '2. primarySoft 是极浅的主色底（用于选中态、标签底色）；onPrimary 是在主色上可读的文字色；',
    '3. bg/surface/surfaceAlt 是三级背景层次；border/borderStrong 是两级描边；',
    '4. text/textSecondary/textMuted 是三级文字层次，必须与 bg 有足够对比度；',
    '5. success/warning/danger/info 是语义色，需与整体色调协调。',
  ]
  if (base?.color) {
    lines.push('', '可参考的基准色（可在其基础上调整，不必照搬）：')
    lines.push(JSON.stringify(base.color))
  }
  return lines.join('\n')
}

export interface SpecFromTextOptions {
  configId: string
  description: string
  /** 规范名称（默认取描述前 12 字） */
  name?: string
  /** 基准 Token，用于「在既有风格上微调」 */
  base?: Tokens
}

/** 文字描述 → 完整 DesignSpec（source='imported'，可保存复用） */
export async function specFromText(opts: SpecFromTextOptions): Promise<DesignSpec> {
  const desc = opts.description.trim()
  if (!desc) throw new Error('请先输入风格描述')

  const raw = await askJson({
    configId: opts.configId,
    system: SYSTEM,
    user: buildUserPrompt(desc, opts.base),
    temperature: TEMP.tokens,
    maxTokens: 4096,
    stageName: '风格提炼·描述',
    validate: (o) => {
      const obj = o as Record<string, unknown> | null
      const color = obj && typeof obj === 'object' ? (obj.color as Record<string, unknown> | undefined) : undefined
      if (!color || typeof color !== 'object') return { ok: false, errors: ['缺少 color 对象'] }
      if (!Object.keys(color).length) return { ok: false, errors: ['color 为空'] }
      return { ok: true, errors: [] }
    },
  })

  const tokens = normalizeSpecTokens(raw)
  const name = (opts.name ?? desc.slice(0, 12)).trim() || '自定义风格'
  return createSpec({
    name,
    desc,
    tokens,
    source: 'imported',
    rules: { donts: ['不要使用该规范 color 集合之外的颜色'] },
  })
}
