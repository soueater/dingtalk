// src/services/design/style-extract.ts
// 自定义设计风格 —— 从「用户提供的页面」提炼 Token（纯逻辑层）
//
// 支持三种来源，其中两种完全离线：
//   1. HTML 源码  → extractTokensFromHtml   （解析 <style> 与 style="" 里的 CSS）
//   2. 图片像素  → quantizePixels + tokensFromPalette（画布采样后交由本层归纳）
//   3. 文字描述  → 由 spec-from-text.ts 走模型（本文件不涉及网络）
//
// 设计原则：
//  · 不 import store / react / electron —— 纯函数，便于 scripts/test-style-extract.mjs 直接单测；
//  · 全部确定性（不依赖随机、时间、DOM），同输入必得同输出；
//  · 提炼结果对标 style-presets.ts 的 Token 键名约定，可直接替换项目 Token 使用。
import type { Tokens } from '@shared/design'

/* ============================== 基础色值工具 ============================== */

export interface RgbColor {
  r: number
  g: number
  b: number
}

export interface PaletteEntry {
  hex: string
  count: number
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)))

export function rgbToHex({ r, g, b }: RgbColor): string {
  const h = (n: number) => clamp255(n).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase()
}

export function hexToRgb(hex: string): RgbColor | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  let s = m[1]
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  }
}

export interface Hsl {
  h: number // 0-360
  s: number // 0-1
  l: number // 0-1
}

export function rgbToHsl({ r, g, b }: RgbColor): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  else if (max === gn) h = ((bn - rn) / d + 2) * 60
  else h = ((rn - gn) / d + 4) * 60
  return { h, s, l }
}

export function hslToRgb({ h, s, l }: Hsl): RgbColor {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hue < 60) [r, g, b] = [c, x, 0]
  else if (hue < 120) [r, g, b] = [x, c, 0]
  else if (hue < 180) [r, g, b] = [0, c, x]
  else if (hue < 240) [r, g, b] = [0, x, c]
  else if (hue < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

/** WCAG 相对亮度（0=黑 1=白） */
export function luminance({ r, g, b }: RgbColor): number {
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function contrastRatio(a: RgbColor, b: RgbColor): number {
  const l1 = luminance(a)
  const l2 = luminance(b)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/** 线性混合：t=0 → a，t=1 → b */
export function mix(a: RgbColor, b: RgbColor, t: number): RgbColor {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  }
}

/** 调整明度：delta>0 变亮，delta<0 变暗（保持色相/饱和度） */
export function shiftLightness(c: RgbColor, delta: number): RgbColor {
  const hsl = rgbToHsl(c)
  return hslToRgb({ ...hsl, l: Math.max(0, Math.min(1, hsl.l + delta)) })
}

/** 两个颜色是否近似（用于调色板去重） */
export function nearColor(a: RgbColor, b: RgbColor, threshold = 24): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) <= threshold
}

/**
 * 从中选一个在该底色上更易读的前景色。
 *
 * 用「明度阈值」而不是「对比度比较」：对中蓝色这类中间调，#3B82F6 上白字对比度 3.68、
 * 深字 4.83 —— 纯按对比度会选深字，但按钮文字通常是粗体且常为大号（AA-large 门槛 3.0），
 * 业界惯例是配白字。明度阈值法可预测、与主流设计系统一致。
 */
export function readableOn(bg: RgbColor): string {
  return luminance(bg) > 0.55 ? '#111827' : '#FFFFFF'
}

/* ============================== 调色板构建 ============================== */

const NAMED_COLORS: Record<string, string> = {
  white: '#FFFFFF',
  black: '#000000',
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  gray: '#808080',
  grey: '#808080',
  silver: '#C0C0C0',
  orange: '#FFA500',
  purple: '#800080',
  yellow: '#FFFF00',
  pink: '#FFC0CB',
  teal: '#008080',
  navy: '#000080',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00FF00',
  cyan: '#00FFFF',
  magenta: '#FF00FF',
  transparent: '#000000',
}

const HEX6 = /#([0-9a-fA-F]{6})\b/g
const HEX3 = /#([0-9a-fA-F]{3})\b/g
const RGB_FN = /rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/g
const HSL_FN = /hsla?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%/g

/**
 * 从任意 CSS 文本中收集颜色并计数。
 * 处理顺序很关键：先匹配 6 位 hex 再匹配 3 位，否则 `#AABBCC` 会被误识别成 `#AAB`。
 */
export function collectCssColors(text: string): PaletteEntry[] {
  const counts = new Map<string, number>()
  const add = (hex: string) => {
    const key = hex.toUpperCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  let rest = text.replace(HEX6, (_m, h) => {
    add(`#${h}`)
    return ' '
  })
  rest = rest.replace(HEX3, (_m, h) => {
    add(`#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`)
    return ' '
  })
  rest = rest.replace(RGB_FN, (_m, r, g, b) => {
    add(rgbToHex({ r: Number(r), g: Number(g), b: Number(b) }))
    return ' '
  })
  rest = rest.replace(HSL_FN, (_m, h, s, l) => {
    add(rgbToHex(hslToRgb({ h: Number(h), s: Number(s) / 100, l: Number(l) / 100 })))
    return ' '
  })
  // 具名颜色（整词匹配，避免 gray 命中 grayscale 之类）
  for (const [name, hex] of Object.entries(NAMED_COLORS)) {
    const re = new RegExp(`\\b${name}\\b`, 'gi')
    const n = (rest.match(re) ?? []).length
    if (n > 0) {
      add(hex)
      rest = rest.replace(re, ' ')
    }
  }

  return [...counts.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => b.count - a.count || (a.hex < b.hex ? -1 : 1))
}

/** 合并近似色，累加计数；返回按频次降序、频次相同按色值升序（保证确定性） */
export function mergePalette(palette: PaletteEntry[], threshold = 24): PaletteEntry[] {
  const merged: Array<{ rgb: RgbColor; hex: string; count: number }> = []
  for (const e of palette) {
    const rgb = hexToRgb(e.hex)
    if (!rgb) continue
    const hit = merged.find((m) => nearColor(m.rgb, rgb, threshold))
    if (hit) hit.count += e.count
    else merged.push({ rgb, hex: e.hex.toUpperCase(), count: e.count })
  }
  return merged
    .sort((a, b) => b.count - a.count || (a.hex < b.hex ? -1 : 1))
    .map(({ hex, count }) => ({ hex, count }))
}

/**
 * 把一张图片的 RGBA 像素扁平数组量化成调色板。
 * @param data   RGBA 顺序、长度 = w*h*4
 * @param sampleStep 每 N 个像素采样 1 个（降开销；1 = 全量）
 * 4bit/通道分箱，跳过几乎全透明的像素。
 */
export function quantizePixels(data: ArrayLike<number>, sampleStep = 4): PaletteEntry[] {
  const step = Math.max(1, Math.floor(sampleStep))
  const counts = new Map<string, number>()
  const pixelCount = Math.floor(data.length / 4)
  for (let i = 0; i < pixelCount; i += step) {
    const o = i * 4
    if (data[o + 3] < 16) continue // 透明像素不计
    const r = data[o] & 0xf0
    const g = data[o + 1] & 0xf0
    const b = data[o + 2] & 0xf0
    const hex = rgbToHex({ r, g, b })
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => b.count - a.count || (a.hex < b.hex ? -1 : 1))
}

/* ============================== 调色板 → Tokens ============================== */

const FALLBACK = {
  light: {
    color: {
      primary: '#3B82F6',
      primaryHover: '#2563EB',
      primaryActive: '#1D4ED8',
      primarySoft: '#EFF6FF',
      onPrimary: '#FFFFFF',
      bg: '#FFFFFF',
      surface: '#F9FAFB',
      surfaceAlt: '#F3F4F6',
      border: '#E5E7EB',
      borderStrong: '#D1D5DB',
      text: '#111827',
      textSecondary: '#6B7280',
      textMuted: '#9CA3AF',
      textInverse: '#FFFFFF',
      success: '#10B981',
      warning: '#F59E0B',
      danger: '#EF4444',
      info: '#3B82F6',
    },
  },
  dark: {
    color: {
      primary: '#4C8DFF',
      primaryHover: '#6BA1FF',
      primaryActive: '#8AB6FF',
      primarySoft: '#15223A',
      onPrimary: '#0B0F17',
      bg: '#0F1115',
      surface: '#161A22',
      surfaceAlt: '#1E232D',
      border: '#2A303B',
      borderStrong: '#3A4250',
      text: '#E6E9EF',
      textSecondary: '#9AA4B2',
      textMuted: '#6B7280',
      textInverse: '#0B0F17',
      success: '#34D399',
      warning: '#FBBF24',
      danger: '#F87171',
      info: '#60A5FA',
    },
  },
}

const DEFAULT_SPACE = { xxs: 2, xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48, huge: 64 }
const DEFAULT_SHADOW: NonNullable<Tokens['shadow']> = {
  xs: { x: 0, y: 1, blur: 2, color: 'rgba(0,0,0,0.05)' },
  sm: { x: 0, y: 2, blur: 8, color: 'rgba(0,0,0,0.06)' },
  md: { x: 0, y: 4, blur: 16, color: 'rgba(0,0,0,0.08)' },
  lg: { x: 0, y: 8, blur: 32, color: 'rgba(0,0,0,0.12)' },
}

/** 依据色相把一个颜色归入语义色（找不到返回 null） */
function semanticOf(hsl: Hsl): 'success' | 'warning' | 'danger' | 'info' | null {
  if (hsl.s < 0.2) return null
  const h = hsl.h
  if (h >= 85 && h <= 165) return 'success'
  if (h >= 25 && h < 85) return 'warning'
  if (h >= 330 || h < 20) return 'danger'
  if (h >= 185 && h < 265) return 'info'
  return null
}

export interface PaletteOptions {
  /** 底色锚点：HTML 路径来自 body / html / :root 的 background，比频次更可靠 */
  bg?: string
  /** 正文色锚点：同上，来自 body 的 color */
  text?: string
  /** 沿用这些 Token 的非颜色部分（font / space / radius / shadow） */
  keep?: Tokens
}

/**
 * 把一组颜色归纳成一套完整 Token。
 * 这是「图片提炼」与「HTML 提炼」共用的收敛步骤：无论颜色从哪来，语义映射口径一致。
 */
export function tokensFromPalette(rawPalette: PaletteEntry[], opts: PaletteOptions = {}): Tokens {
  const palette = mergePalette(rawPalette)

  // 底色：优先用调用方给的锚点（HTML 里 body/html/:root 的 background 最可靠）；
  // 否则取「最高频一档里最极端的亮度」——背景通常接近纯白或纯黑，
  // 而纯靠频次在计数相同时会退化成按色值排序，容易挑到阴影里的黑色。
  const bgHex = (() => {
    if (opts.bg && hexToRgb(opts.bg)) return opts.bg.toUpperCase()
    if (!palette.length) return '#FFFFFF'
    const maxCount = palette[0].count
    const tier = palette.filter((e) => e.count >= maxCount * 0.5)
    const scored = tier
      .map((e) => {
        const rgb = hexToRgb(e.hex) as RgbColor
        const lum = luminance(rgb)
        return { hex: e.hex, extremity: Math.abs(lum - 0.5), lum }
      })
      .sort((a, b) => b.extremity - a.extremity || b.lum - a.lum || (a.hex < b.hex ? -1 : 1))
    return scored[0].hex
  })()
  const bg = hexToRgb(bgHex) as RgbColor
  const dark = luminance(bg) < 0.4
  const fb = dark ? FALLBACK.dark.color : FALLBACK.light.color

  // 正文色：优先用调用方锚点；否则选「与底色对比度达标的中性色」
  // （避免正文被高饱和主色顶替）；再退而取对比度最高者；最后用主题默认。
  const AA_CONTRAST = 4.5
  let textHex = fb.text
  const candidates: Array<{ hex: string; c: number; sat: number; count: number }> = []
  for (const e of palette) {
    const rgb = hexToRgb(e.hex)
    if (!rgb) continue
    candidates.push({ hex: e.hex, c: contrastRatio(rgb, bg), sat: rgbToHsl(rgb).s, count: e.count })
  }
  if (opts.text && hexToRgb(opts.text) && contrastRatio(hexToRgb(opts.text) as RgbColor, bg) >= 2) {
    textHex = opts.text.toUpperCase()
  } else {
    const qualified = candidates.filter((x) => x.c >= AA_CONTRAST)
    const neutralQualified = qualified.filter((x) => x.sat < 0.25)
    if (neutralQualified.length) {
      textHex = neutralQualified[0].hex
    } else if (qualified.length) {
      textHex = qualified.slice().sort((a, b) => b.c - a.c)[0].hex
    } else if (candidates.length) {
      textHex = candidates.slice().sort((a, b) => b.c - a.c)[0].hex
    }
  }
  const text = hexToRgb(textHex) as RgbColor

  // 主色 = 出现最多的「真正鲜艳」的色。
  // 阈值取 0.35 而非更低：深灰蓝这类中性色饱和度常在 0.25~0.3 之间，
  // 用低阈值会把正文色误判成主色（实际踩过这个坑）。
  // 同时显式排除已被选作底色/正文的颜色。
  let primaryHex = ''
  for (const e of palette) {
    if (e.hex === bgHex || e.hex === textHex) continue
    const rgb = hexToRgb(e.hex)
    if (!rgb) continue
    const hsl = rgbToHsl(rgb)
    if (hsl.s >= 0.35 && hsl.l > 0.15 && hsl.l < 0.85) {
      primaryHex = e.hex
      break
    }
  }
  const primary = primaryHex ? (hexToRgb(primaryHex) as RgbColor) : null

  // 语义色：按色相分档取出现最多者
  const semantic: Record<string, string> = {}
  for (const e of palette) {
    const rgb = hexToRgb(e.hex)
    if (!rgb) continue
    const kind = semanticOf(rgbToHsl(rgb))
    if (kind && !semantic[kind]) semantic[kind] = e.hex
  }

  const color: Record<string, string> = {
    primary: primary ? rgbToHex(primary) : fb.primary,
    primaryHover: primary ? rgbToHex(shiftLightness(primary, dark ? 0.1 : -0.08)) : fb.primaryHover,
    primaryActive: primary ? rgbToHex(shiftLightness(primary, dark ? 0.2 : -0.16)) : fb.primaryActive,
    primarySoft: primary ? rgbToHex(mix(primary, bg, dark ? 0.82 : 0.9)) : fb.primarySoft,
    onPrimary: primary ? readableOn(primary) : fb.onPrimary,
    bg: rgbToHex(bg),
    surface: rgbToHex(mix(bg, text, dark ? 0.06 : 0.03)),
    surfaceAlt: rgbToHex(mix(bg, text, dark ? 0.12 : 0.06)),
    border: rgbToHex(mix(bg, text, dark ? 0.18 : 0.12)),
    borderStrong: rgbToHex(mix(bg, text, dark ? 0.3 : 0.24)),
    text: rgbToHex(text),
    textSecondary: rgbToHex(mix(text, bg, 0.3)),
    textMuted: rgbToHex(mix(text, bg, 0.5)),
    textInverse: dark ? '#0B0F17' : '#FFFFFF',
    success: semantic.success ?? fb.success,
    warning: semantic.warning ?? fb.warning,
    danger: semantic.danger ?? fb.danger,
    info: semantic.info ?? fb.info,
  }

  return {
    color,
    font: opts.keep?.font,
    space: opts.keep?.space ?? { ...DEFAULT_SPACE },
    radius: opts.keep?.radius,
    shadow: opts.keep?.shadow ?? JSON.parse(JSON.stringify(DEFAULT_SHADOW)),
  }
}

/* ============================== HTML 提炼 ============================== */

/** 取出 <style> 块内容 + 所有 style="…" 属性内容（只看样式，不看正文文本） */
export function sampleStyleText(html: string): string {
  const parts: string[] = []
  const styleBlock = /<style[^>]*>([\s\S]*?)<\/style>/gi
  let m: RegExpExecArray | null
  while ((m = styleBlock.exec(html)) !== null) parts.push(m[1])
  const styleAttr = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi
  while ((m = styleAttr.exec(html)) !== null) parts.push(m[2] ?? m[3] ?? '')
  return parts.join('\n')
}

/** 收集 `prop: Npx` 形式的数值 */
export function collectPxValues(css: string, prop: string): number[] {
  const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`, 'gi')
  const out: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    const nums = m[1].match(/(-?\d+(?:\.\d+)?)px/g) ?? []
    for (const s of nums) {
      const v = parseFloat(s)
      if (Number.isFinite(v) && v > 0) out.push(v)
    }
  }
  return out
}

/** 收集 font-family 的首选字体名 */
export function collectFontFamilies(css: string): string[] {
  const re = /font-family\s*:\s*([^;}]+)/gi
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    const first = m[1].split(',')[0].trim().replace(/^["']|["']$/g, '')
    if (first) out.push(first)
  }
  return out
}

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'inherit', 'initial',
])

/** 取出现次数最多且非通用关键字的字体名 */
export function dominantFontFamily(css: string): string | null {
  const fams = collectFontFamilies(css).filter((f) => !GENERIC_FAMILIES.has(f.toLowerCase()))
  if (!fams.length) return null
  const counts = new Map<string, number>()
  for (const f of fams) counts.set(f, (counts.get(f) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]
}

/** 由探测到的字号集合推导字号阶梯；信息不足时按正文字号等比缩放 */
export function deriveFontTokens(
  sizes: number[],
  family: string,
  bodyHint?: number,
): NonNullable<Tokens['font']> {
  const uniq = [...new Set(sizes.map((n) => Math.round(n)))]
    .filter((n) => n >= 8 && n <= 96)
    .sort((a, b) => a - b)

  // 正文字号的优先级：调用方锚点（body/html/:root 上显式声明的 font-size）
  // → 出现次数最多的字号 → 默认 15。
  // 只看「众数」是不够的：真实页面里每个字号往往各出现一次，此时众数会退化成
  // 「最小字号」，把正文判成 13px 这种偏小的值。
  const mode = (() => {
    if (!sizes.length) return null
    const counts = new Map<number, number>()
    for (const s of sizes) {
      const k = Math.round(s)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
  })()
  const body = Math.max(12, Math.min(20, Math.round(bodyHint ?? mode ?? 15)))

  // 先按经典比例给出阶梯，再用探测到的极值校准两端，最后强制单调，
  // 避免 nearest-snap 把小字号吸附到同一档造成 h2 与 h3 相等。
  const maxDetected = uniq.length ? Math.max(...uniq) : 0
  const minDetected = uniq.length ? Math.min(...uniq) : 0

  let display = Math.round(body * 2.27)
  let h1 = Math.round(body * 1.87)
  let h2 = Math.round(body * 1.47)
  let h3 = Math.round(body * 1.2)
  let caption = Math.round(body * 0.87)
  let overline = Math.round(body * 0.73)

  if (maxDetected > h1) display = maxDetected
  if (minDetected > 0 && minDetected < body) caption = minDetected

  h3 = Math.max(h3, body + 2)
  h2 = Math.max(h2, h3 + 2)
  h1 = Math.max(h1, h2 + 2)
  display = Math.max(display, h1 + 2)
  caption = Math.max(10, Math.min(caption, body - 2))
  overline = Math.max(9, Math.min(overline, caption - 1))

  const lh = (s: number, r: number) => Math.round(s * r)
  return {
    display: { family, size: display, weight: 700, lineHeight: lh(display, 1.24) },
    h1: { family, size: h1, weight: 700, lineHeight: lh(h1, 1.28) },
    h2: { family, size: h2, weight: 600, lineHeight: lh(h2, 1.36) },
    h3: { family, size: h3, weight: 600, lineHeight: lh(h3, 1.44) },
    body: { family, size: body, weight: 400, lineHeight: lh(body, 1.47) },
    bodyStrong: { family, size: body, weight: 600, lineHeight: lh(body, 1.47) },
    caption: { family, size: caption, weight: 400, lineHeight: lh(caption, 1.38) },
    overline: { family, size: overline, weight: 600, lineHeight: lh(overline, 1.45) },
  }
}

/** 由探测到的圆角值推导阶梯（去重排序后映射 sm/md/lg/xl；不足则等比外推） */
export function deriveRadiusTokens(values: number[]): Record<string, number> {
  const uniq = [...new Set(values.map((v) => Math.round(v)))].filter((v) => v >= 0 && v <= 400).sort((a, b) => a - b)
  if (!uniq.length) return { sm: 6, md: 10, lg: 16, xl: 24, full: 999 }
  const sm = uniq[0]
  const md = uniq[1] ?? Math.round(sm * 1.6)
  const lg = uniq[2] ?? Math.round(md * 1.6)
  const xl = uniq[3] ?? Math.round(lg * 1.5)
  return { sm, md, lg, xl, full: 999 }
}

/**
 * 从 html / body / :root 的声明块里取锚点色与正文字号。
 * 背景色/正文色/正文字号在这三处声明时最可靠，优先于「按频次猜」。
 *
 * 实现上先按 `选择器 { 声明 }` 切块再判断选择器，而不是用带边界的正则去扫全串 ——
 * 后者在 `a{...} b{...}` 这种相邻规则上会漏掉后面那条（边界字符已被前一次匹配吃掉）。
 */
export function pageAnchors(css: string): { bg?: string; text?: string; fontSize?: number } {
  const out: { bg?: string; text?: string; fontSize?: number } = {}
  const ruleRe = /([^{}]+)\{([^}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = ruleRe.exec(css)) !== null) {
    const selector = m[1]
    if (!/(^|[\s,>+~])(html|body|:root)\b/i.test(selector)) continue
    const decl = m[2]
    if (!out.bg) {
      const bg = /(?:^|[;\s])background(?:-color)?\s*:\s*([^;}]+)/i.exec(decl)
      if (bg) {
        const c = collectCssColors(bg[1])[0]
        if (c) out.bg = c.hex
      }
    }
    if (!out.text) {
      // 前缀边界必不可少：否则 `background-color` 里的 color 也会被当成正文色
      const fg = /(?:^|[;\s])color\s*:\s*([^;}]+)/i.exec(decl)
      if (fg) {
        const c = collectCssColors(fg[1])[0]
        if (c) out.text = c.hex
      }
    }
    if (out.fontSize == null) {
      const fs = /(?:^|[;\s])font-size\s*:\s*(\d+(?:\.\d+)?)px/i.exec(decl)
      if (fs) out.fontSize = parseFloat(fs[1])
    }
  }
  return out
}

/**
 * 从 HTML 源码提炼设计风格。
 * 覆盖：配色（含语义色分档）、圆角阶梯、字体族与字号阶梯、阴影。
 * 无法从 HTML 可靠推断的部分（间距节奏）沿用中性默认值。
 */
export function extractTokensFromHtml(html: string): Tokens {
  const css = sampleStyleText(html)
  const palette = collectCssColors(css)
  const anchors = pageAnchors(css)

  const radius = deriveRadiusTokens(collectPxValues(css, 'border-radius'))

  const family = dominantFontFamily(css) ?? 'Inter'
  const font = deriveFontTokens(collectPxValues(css, 'font-size'), family, anchors.fontSize)

  // 阴影：取第一条 box-shadow 的数值与颜色，作为 sm，其余按比例缩放。
  // 解析数值前必须先把颜色部分剥掉——否则 `#000000` 里的 0 会被当成偏移量。
  let shadow: NonNullable<Tokens['shadow']> = JSON.parse(JSON.stringify(DEFAULT_SHADOW))
  const shadowMatch = /box-shadow\s*:\s*([^;}]+)/i.exec(css)
  if (shadowMatch) {
    const decl = shadowMatch[1]
    const cols = collectCssColors(decl)
    const numbersOnly = decl
      .replace(/#[0-9a-fA-F]{3,8}/g, ' ')
      .replace(/(rgb|hsl)a?\([^)]*\)/gi, ' ')
    const nums = (numbersOnly.match(/-?\d+(?:\.\d+)?/g) ?? []).map((s) => parseFloat(s))
    if (nums.length >= 2 && cols.length) {
      const [x, y, blur = 8] = nums
      const base = cols[0].hex
      const mk = (k: number, opacity: number) => ({
        x: Math.round(x * k),
        y: Math.round(y * k),
        blur: Math.round(blur * k),
        color: hexToRgba(base, opacity),
      })
      shadow = { xs: mk(0.4, 0.05), sm: { x, y, blur, color: hexToRgba(base, 0.1) }, md: mk(2, 0.08), lg: mk(4, 0.12) }
    }
  }

  return {
    ...tokensFromPalette(palette, { bg: anchors.bg, text: anchors.text }),
    font,
    radius,
    shadow,
  }
}

/** #RRGGBB + alpha → rgba(...) */
export function hexToRgba(hex: string, alpha = 0.08): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return `rgba(0,0,0,${alpha})`
  return `rgba(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)},${alpha})`
}

/* ============================== 结果归一化 ============================== */

const FONT_KEYS: Array<keyof NonNullable<Tokens['font']>> = [
  'display', 'h1', 'h2', 'h3', 'body', 'bodyStrong', 'caption', 'overline',
]

function isColorLike(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const s = v.trim()
  if (!s) return false
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) || /^(rgb|rgba|hsl|hsla)\(/i.test(s)
}

function positiveNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * 把「可能是模型输出的、不完整的」Token 载荷补齐成一套可用的完整 Token。
 * 缺项一律用中性默认值兜底 —— 保证提炼失败也不会产出残缺规范拖垮渲染。
 */
export function normalizeSpecTokens(raw: unknown): Tokens {
  // 兜底基线必须是「完整」的 Token：tokensFromPalette 在无 keep 时不产出 font，
  // 所以字号基线单独用 deriveFontTokens 生成，不能指望它。
  const fallbackColor = tokensFromPalette([]).color as Record<string, string>
  const fallbackFont = deriveFontTokens([], 'Inter')
  const fallbackRadius = { sm: 6, md: 10, lg: 16, xl: 24, full: 999 }
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const color: Record<string, string> = { ...fallbackColor }
  const rawColor = (src.color ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(rawColor)) {
    if (isColorLike(v)) color[k] = v.trim()
  }

  const font: NonNullable<Tokens['font']> = {}
  const rawFont = (src.font ?? {}) as Record<string, unknown>
  for (const key of FONT_KEYS) {
    const fallback = fallbackFont[key]
    const item = (rawFont[key] ?? {}) as Record<string, unknown>
    const size = positiveNumber(item.size)
    const family = typeof item.family === 'string' && item.family.trim() ? item.family.trim() : fallback.family
    const weight = positiveNumber(item.weight)
    const lineHeight = positiveNumber(item.lineHeight)
    font[key] = {
      family,
      size: size != null && size >= 8 && size <= 120 ? Math.round(size) : fallback.size,
      weight: weight != null ? Math.round(weight) : fallback.weight,
      lineHeight: lineHeight != null ? Math.round(lineHeight) : fallback.lineHeight,
    }
  }

  const numericMap = (rawVal: unknown, fallback: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = { ...fallback }
    for (const [k, v] of Object.entries((rawVal ?? {}) as Record<string, unknown>)) {
      const n = positiveNumber(v)
      if (n != null) out[k] = Math.round(n)
    }
    return out
  }

  const shadow: NonNullable<Tokens['shadow']> = {}
  const rawShadow = (src.shadow ?? {}) as Record<string, unknown>
  for (const [k, fallback] of Object.entries(DEFAULT_SHADOW)) {
    const item = (rawShadow[k] ?? {}) as Record<string, unknown>
    const x = positiveNumber(item.x)
    const y = positiveNumber(item.y)
    const blur = positiveNumber(item.blur)
    shadow[k] = {
      x: x != null ? Math.round(x) : fallback.x,
      y: y != null ? Math.round(y) : fallback.y,
      blur: blur != null ? Math.round(blur) : fallback.blur,
      color: isColorLike(item.color) ? String(item.color) : fallback.color,
    }
  }

  return {
    color,
    font,
    space: numericMap(src.space, { ...DEFAULT_SPACE }),
    radius: numericMap(src.radius, { ...fallbackRadius }),
    shadow,
  }
}

/* ============================== 风格描述（结果说明） ============================== */

/** 用一句话概括提炼结果，供 UI 展示「提炼到了什么」 */
export function describeTokens(tokens: Tokens): string[] {
  const out: string[] = []
  const c = tokens.color ?? {}
  if (c.primary) out.push(`主色 ${c.primary}`)
  if (c.bg) out.push(`底色 ${c.bg}`)
  if (c.text) out.push(`正文色 ${c.text}`)
  const radii = Object.values(tokens.radius ?? {})
  if (radii.length) out.push(`圆角 ${Math.min(...radii)}–${Math.max(...radii.filter((r) => r < 900))}px`)
  const family = Object.values(tokens.font ?? {})[0]?.family
  if (family) out.push(`字体 ${family}`)
  const bodySize = tokens.font?.body?.size
  if (bodySize) out.push(`正文字号 ${bodySize}px`)
  return out
}
