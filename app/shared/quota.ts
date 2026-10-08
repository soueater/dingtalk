/**
 * 界面配额（F-PM-05）—— 纯逻辑层。
 *
 * 只依赖 ./design 的类型与常量（不跨到 src/，以便主进程也能用），不 import store / react / electron，
 * 因此可在 Node 下离线单测（见 scripts/test-project-model.mjs）。
 *
 * 设计要点见 shared/design.ts 的 InterfaceQuota 注释：
 * 「界面数量 N」必须拆成 planned / softLimit / hardLimit 三档才不会互相打架。
 */
import {
  DEFAULT_QUOTA,
  GLOBAL_MAX_PAGES,
  type InterfaceQuota,
  type Meta,
} from './design'

/** 配额档位 */
export const QUOTA_MIN = 1
export const QUOTA_MAX = 999

/** 合法整数钳制；非数字 / NaN / 小数一律落到 fallback */
export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  const i = Math.trunc(n)
  if (i < min) return min
  if (i > max) return max
  return i
}

/** 合法的配额策略三档；非法值一律回落默认，避免 UI 拿到无法识别的分支 */
export const QUOTA_STRATEGIES = ['single', 'flow', 'batch'] as const

/** 单点兜底：把任意输入收敛成合法策略 */
export function normalizeStrategy(v: unknown): InterfaceQuota['strategy'] {
  return (QUOTA_STRATEGIES as readonly string[]).includes(String(v))
    ? (v as InterfaceQuota['strategy'])
    : DEFAULT_QUOTA.strategy
}

/**
 * 单点兜底：把任意（可能是旧版本、可能被手工编辑过的）meta 解析成合法配额。
 * 全项目**只有这里**允许读 meta.quota，其余位置一律调 resolveQuota。
 */
export function resolveQuota(meta: Pick<Meta, 'quota'> | undefined): InterfaceQuota {
  const q = meta?.quota
  if (!q || typeof q !== 'object') return { ...DEFAULT_QUOTA }
  return {
    planned: clampInt(q.planned, QUOTA_MIN, QUOTA_MAX, DEFAULT_QUOTA.planned),
    softLimit: clampInt(q.softLimit, QUOTA_MIN, QUOTA_MAX, DEFAULT_QUOTA.softLimit),
    // hardLimit 允许 0（表示不限），故下界为 0
    hardLimit: clampInt(q.hardLimit, 0, QUOTA_MAX, DEFAULT_QUOTA.hardLimit),
    strategy: normalizeStrategy(q.strategy),
  }
}

/**
 * 实际生效的硬上限。
 * hardLimit = 0 表示「不限」，但仍受全局兜底 GLOBAL_MAX_PAGES 约束 ——
 * 否则用户可以填 999 并靠批量追加把内存打爆。
 */
export function effectiveHardLimit(q: InterfaceQuota): number {
  if (q.hardLimit === 0) return GLOBAL_MAX_PAGES
  return Math.min(q.hardLimit, GLOBAL_MAX_PAGES)
}

/** 软上限也不会超过硬上限（用户可能把 soft 配得比 hard 大） */
export function effectiveSoftLimit(q: InterfaceQuota): number {
  return Math.min(q.softLimit, effectiveHardLimit(q))
}

/** 还能再追加多少个界面 */
export function remainingSlots(q: InterfaceQuota, current: number): number {
  return Math.max(0, effectiveHardLimit(q) - current)
}

export type QuotaLevel = 'ok' | 'warn' | 'block'

export interface QuotaDecision {
  allowed: boolean
  level: QuotaLevel
  /** 面向用户的提示文案；level === 'ok' 时为 undefined */
  message?: string
  /** 本次操作后还能再加的数量 */
  remaining: number
  /** 建议的「不再提示」标记键（软上限提示专用） */
  dismissKey?: string
}

/**
 * 判断「在当前界面数基础上再追加 adding 个界面」是否允许。
 *
 * 语义（与设计文档 §5.6 一致）：
 *   - 结果 ≤ softLimit                → ok
 *   - softLimit < 结果 ≤ hardLimit    → warn（允许，给非阻断提示）
 *   - 结果 > hardLimit                → block（禁止）
 */
export function canAddInterfaces(
  current: number,
  adding: number,
  quota: InterfaceQuota,
): QuotaDecision {
  const cur = Math.max(0, Math.trunc(current))
  const add = Math.max(0, Math.trunc(adding))
  const after = cur + add
  const hard = effectiveHardLimit(quota)
  const soft = effectiveSoftLimit(quota)

  if (after > hard) {
    return {
      allowed: false,
      level: 'block',
      remaining: Math.max(0, hard - cur),
      message:
        quota.hardLimit === 0
          ? `已达全局界面数上限（${hard}），无法继续新增。`
          : `已达项目界面上限（${hard}）。可在「项目设置」中调整上限。`,
    }
  }

  if (after > soft) {
    return {
      allowed: true,
      level: 'warn',
      remaining: hard - after,
      dismissKey: 'quota-soft-warn',
      message:
        `项目已有 ${after} 个界面，超过建议上限 ${soft}。` +
        `界面过多会影响画布可读性，建议拆分为多个项目或使用界面分组。`,
    }
  }

  return { allowed: true, level: 'ok', remaining: hard - after }
}

/**
 * 归一化外部传来的配额补丁：
 * 保证 planned / softLimit / hardLimit 三者的内部一致性
 * （soft ≤ hard、planned ≤ hard、hard ≥ 当前界面数）。
 */
export function normalizeQuota(
  patch: Partial<InterfaceQuota>,
  base: InterfaceQuota,
  currentPages: number,
): InterfaceQuota {
  const merged: InterfaceQuota = {
    planned: clampInt(patch.planned ?? base.planned, QUOTA_MIN, QUOTA_MAX, base.planned),
    softLimit: clampInt(patch.softLimit ?? base.softLimit, QUOTA_MIN, QUOTA_MAX, base.softLimit),
    // 注意 base 可能是"不限(0)"，patch 未给时保留 0 而不是退回默认值
    hardLimit:
      patch.hardLimit === undefined
        ? base.hardLimit
        : clampInt(patch.hardLimit, 0, QUOTA_MAX, base.hardLimit),
    strategy: patch.strategy === undefined ? base.strategy : normalizeStrategy(patch.strategy),
  }

  const cur = Math.max(1, Math.trunc(currentPages))
  // 硬上限不得低于已有界面数，否则项目立刻处于"超限"的荒谬状态
  if (merged.hardLimit !== 0 && merged.hardLimit < cur) merged.hardLimit = cur
  const hard = effectiveHardLimit(merged)
  if (merged.softLimit > hard) merged.softLimit = hard
  if (merged.planned > hard) merged.planned = hard

  return merged
}

/**
 * 生成阶段的页数规整：把模型规划出的界面清单裁剪/补齐到 planned。
 * 补齐用名称模板 + 序号；截断直接丢弃尾部。
 */
export function fitPlanToQuota<T extends { name?: string }>(items: T[], planned: number): T[] {
  const n = clampInt(planned, QUOTA_MIN, QUOTA_MAX, 1)
  const out = items.slice(0, n)
  return out
}

/** 计划数与实际产出数的差异描述（用于生成后的提示文案） */
export function describePlanGap(planned: number, actual: number): string | null {
  if (actual >= planned) return null
  const missing = planned - actual
  return `计划生成 ${planned} 个界面，实际成功 ${actual} 个，可点击「续生成 ${missing} 个」补齐。`
}
