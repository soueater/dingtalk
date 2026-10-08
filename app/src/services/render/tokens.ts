// src/services/render/tokens.ts
// Token 引用解析：把 "$color.primary" 这类引用解析成真实值
import type { Tokens } from '@shared/design'

export type TokenMap = {
  color: Record<string, string>
  space: Record<string, number>
  radius: Record<string, number>
  font: Record<string, { family: string; size: number; weight?: number; lineHeight?: number; letterSpacing?: number }>
  shadow: Record<string, { x: number; y: number; blur: number; spread?: number; color: string }>
}

export function buildTokenMap(tokens: Tokens | undefined): TokenMap {
  const t = tokens ?? {}
  return {
    color: { ...(t.color ?? {}) },
    space: { ...(t.space ?? {}) },
    radius: { ...(t.radius ?? {}) },
    font: { ...(t.font ?? {}) },
    shadow: { ...(t.shadow ?? {}) },
  }
}

const REF = /^\$([a-zA-Z]+)\.([\w-]+)$/

/**
 * 解析 Token 引用字符串。返回 null 表示「不是引用」。
 * F-ST-01 的漂移检测复用此函数，避免各处各写一份正则。
 */
export function parseTokenRef(value: unknown): { group: string; key: string } | null {
  if (typeof value !== 'string') return null
  const m = REF.exec(value)
  return m ? { group: m[1], key: m[2] } : null
}

/** 是否为 `$group.key` 形式的引用 */
export function isTokenRef(value: unknown): boolean {
  return parseTokenRef(value) != null
}

/** 引用是否能在给定 TokenMap 中解析到真实值 */
export function tokenRefExists(value: unknown, map: TokenMap): boolean {
  const ref = parseTokenRef(value)
  if (!ref) return false
  return resolveValue(value, map) !== undefined
}

export const TOKEN_GROUPS = ['color', 'space', 'radius', 'font', 'shadow'] as const
export type TokenGroup = (typeof TOKEN_GROUPS)[number]

/**
 * 解析值：
 *  - "$color.primary" → tokens.color.primary
 *  - "$space.md" → 数值
 *  - 直接值原样返回
 *  - 解析失败返回 fallback
 */
export function resolveValue<T>(value: unknown, map: TokenMap, fallback?: T): T | undefined {
  if (value == null) return fallback
  if (typeof value !== 'string') return value as T

  const m = REF.exec(value)
  if (!m) return value as T

  const [, group, key] = m
  switch (group) {
    case 'color':
      return (map.color[key] ?? fallback) as T
    case 'space':
      return (map.space[key] ?? fallback) as T
    case 'radius':
      return (map.radius[key] ?? fallback) as T
    case 'font':
      return (map.font[key] ?? fallback) as T
    case 'shadow':
      return (map.shadow[key] ?? fallback) as T
    default:
      return fallback
  }
}

export function resolveColor(value: unknown, map: TokenMap, fallback = 'transparent'): string {
  const v = resolveValue<string>(value, map)
  return typeof v === 'string' ? v : fallback
}

export function resolveNumber(value: unknown, map: TokenMap, fallback?: number): number | undefined {
  const v = resolveValue<number>(value, map)
  if (typeof v === 'number') return v
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  return fallback
}

/** 尺寸三态：数字 / "fill" / percentage / "auto" */
export function sizeToCss(v: unknown, axis: 'width' | 'height', map: TokenMap): string {
  if (v == null) return axis === 'width' ? 'auto' : 'auto'
  if (typeof v === 'number') return `${v}px`

  const s = String(v)
  if (s === 'fill') return '100%'
  if (s === 'fit' || s === 'auto') return axis === 'width' ? 'fit-content' : 'auto'
  if (s.endsWith('%')) return s
  if (/^-?\d+(\.\d+)?$/.test(s)) return `${s}px`

  const resolved = resolveValue(s, map)
  if (typeof resolved === 'number') return `${resolved}px`
  if (typeof resolved === 'string') return resolved
  return 'auto'
}
