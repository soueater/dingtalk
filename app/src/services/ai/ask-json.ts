// src/services/ai/ask-json.ts
// 「要 JSON」的统一范式：请求 → 抽取 → 宽松解析 → 结构校验 → 一次修复重试。
//
// 为什么需要抽出来：
//   这套「校验 + 修复重试」原先只长在 generate.ts 里（askJson 私有函数），
//   变体链路（variants.ts）绕开了它，只做 extractJson + lenientParse 就直接用，
//   于是模型吐出的残缺/截断 JSON 会一路穿透到 repairNode 才炸，用户看到的是
//   「生成设计变体报错」。把范式收敛到本文件后，所有「要 JSON」的调用点共用
//   同一套容错与统一报错文案。
import { chatOnce } from './client'
import { extractJson, lenientParse } from './parse'
import { buildRepairPrompt } from './prompt-templates'

/** 单次请求的输出上限。超过多数 OpenAI 兼容服务的 json_object 上限，会被拒或截断。 */
export const HARD_MAX_TOKENS = 8192
/** 默认输出上限 */
export const DEFAULT_MAX_TOKENS = HARD_MAX_TOKENS
/** 修复重试时回灌的历史输出截断长度（避免上下文爆炸） */
export const ECHO_LIMIT = 4000

export interface ValidateOutcome {
  ok: boolean
  errors: string[]
}

export interface AskJsonOptions {
  configId: string
  /** 系统提示词 */
  system: string
  /** 用户提示词 */
  user: string
  temperature: number
  /** 结构校验；返回 { ok:false, errors } 会触发修复重试 */
  validate: (o: unknown) => ValidateOutcome
  /** 输出上限，自动封顶到 HARD_MAX_TOKENS */
  maxTokens?: number
  /** 阶段名，仅用于错误文案前缀，例如「规划阶段」 */
  stageName?: string
  /** 尝试次数，默认 2（首次 + 一次修复） */
  attempts?: number
}

/**
 * 把调用方给的上限收敛到安全区间。
 * 变体链路历史上写死 12000（超过 json_object 常见上限 8192），是报错诱因之一。
 */
export function clampMaxTokens(desired?: number, hardCap = HARD_MAX_TOKENS): number {
  const cap = Number.isFinite(hardCap) && (hardCap as number) > 0 ? Math.floor(hardCap as number) : HARD_MAX_TOKENS
  if (!Number.isFinite(desired)) return Math.min(DEFAULT_MAX_TOKENS, cap)
  const n = Math.floor(desired as number)
  if (n <= 0) return Math.min(DEFAULT_MAX_TOKENS, cap)
  return Math.min(n, cap)
}

/** 统一错误对象，便于上层按阶段名做区分处理 */
export class AskJsonError extends Error {
  readonly stageName: string
  readonly reason: string
  constructor(stageName: string, reason: string) {
    super(`${stageName ? `[${stageName}] ` : ''}模型输出无法解析：${reason}`)
    this.name = 'AskJsonError'
    this.stageName = stageName
    this.reason = reason
  }
}

/**
 * 请求模型并拿到一个**已通过结构校验**的对象。
 * 首次失败会把上次原始输出回灌给模型，让它自我修复后再试一次。
 */
export async function askJson(opts: AskJsonOptions): Promise<unknown> {
  const { configId, system, user, temperature, validate, stageName = '', attempts = 2 } = opts
  const maxTokens = clampMaxTokens(opts.maxTokens)
  const tries = Math.max(1, Math.floor(attempts))

  let lastRaw = ''
  let lastErr = '未获得任何输出'

  for (let attempt = 0; attempt < tries; attempt++) {
    const messages =
      attempt === 0
        ? [
            { role: 'system' as const, content: system },
            { role: 'user' as const, content: user },
          ]
        : [
            { role: 'system' as const, content: system },
            { role: 'user' as const, content: user },
            { role: 'assistant' as const, content: lastRaw.slice(0, ECHO_LIMIT) },
            { role: 'user' as const, content: buildRepairPrompt(lastRaw, lastErr) },
          ]

    const res = await chatOnce(configId, messages, { temperature, maxTokens, jsonMode: true })
    lastRaw = res.content ?? ''

    const jsonText = extractJson(lastRaw)
    if (!jsonText) {
      lastErr = '未能从输出中提取出 JSON 对象'
      continue
    }
    const parsed = lenientParse(jsonText)
    if (!parsed) {
      lastErr = 'JSON 语法错误，无法解析'
      continue
    }
    const v = validate(parsed)
    if (!v.ok) {
      lastErr = v.errors.join('；')
      continue
    }
    return parsed
  }

  throw new AskJsonError(stageName, lastErr)
}
