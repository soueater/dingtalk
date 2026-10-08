/**
 * DESIGN.md 双向互操作（F-PM-06）—— 纯逻辑层。
 *
 * 为什么需要它：Google Stitch 的 `DESIGN.md` 关键价值不在 Stitch 自身，而在
 * 「跨工具一致性的共享事实源」—— 同一份文件可被 Claude Code、v0 等任何 AI 设计
 * 工具消费。望舒把它做成**双向**：既能导入（本地文件 / 粘贴 / URL 抓取），
 * 也能导出，并且支持用户级「规范库」跨项目复用。
 *
 * 放在 `shared/` 的动因：主进程的 MCP 接口（F-PM-08）也要解析 DESIGN.md，
 * 而主进程只能走相对路径导入。
 *
 * 解析容错策略（Markdown 是人写的，格式必然五花八门）：
 *   1. 结构化代码块   ```css 里的 `--color-primary: #4C8DFF;`
 *   2. 点号键值        `color.primary: #4C8DFF` / `color/primary: #4C8DFF`
 *   3. 中文别名        `主色：#4C8DFF`、`背景色`、`圆角`
 *   4. 表格            `| primary | #3B82F6 | 主色 |`
 *   5. JSON 代码块     直接给出 `{ "color": { ... } }`
 * 任何无法识别的行都原样保留在 `raw` 里，并在 `warnings` 中提示，不静默丢弃。
 */
import type {
  DesignSpec,
  FontToken,
  ShadowToken,
  SpecRules,
  SpecSource,
  Tokens,
} from './design'
import { uid } from './ids'

/* ================================ 键名别名 ================================ */

/**
 * 中文 / 常见变体 → 规范 Token 键名。
 * 键名约定与 `services/design/style-presets.ts` 严格对齐，否则提炼出的规范
 * 无法被 `tokenMapForPage` 正确解析。
 */
export const COLOR_ALIASES: Record<string, string> = {
  primary: 'primary',
  主色: 'primary',
  品牌色: 'primary',
  brand: 'primary',
  'primary-hover': 'primaryHover',
  悬停: 'primaryHover',
  'primary-active': 'primaryActive',
  按下: 'primaryActive',
  'primary-soft': 'primarySoft',
  浅色: 'primarySoft',
  onprimary: 'onPrimary',
  'on-primary': 'onPrimary',
  bg: 'bg',
  背景: 'bg',
  背景色: 'bg',
  底色: 'bg',
  background: 'bg',
  surface: 'surface',
  表面: 'surface',
  卡片: 'surface',
  'surface-alt': 'surfaceAlt',
  surfacealt: 'surfaceAlt',
  border: 'border',
  边框: 'border',
  'border-strong': 'borderStrong',
  borderstrong: 'borderStrong',
  text: 'text',
  文字: 'text',
  正文: 'text',
  文字色: 'text',
  'text-secondary': 'textSecondary',
  textsecondary: 'textSecondary',
  次要文字: 'textSecondary',
  'text-muted': 'textMuted',
  textmuted: 'textMuted',
  弱化文字: 'textMuted',
  'text-inverse': 'textInverse',
  textinverse: 'textInverse',
  success: 'success',
  成功: 'success',
  warning: 'warning',
  警告: 'warning',
  danger: 'danger',
  危险: 'danger',
  错误: 'danger',
  info: 'info',
  信息: 'info',
}

/** 字号档位别名 */
export const FONT_ALIASES: Record<string, string> = {
  display: 'display',
  展示: 'display',
  大标题: 'display',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  body: 'body',
  正文: 'body',
  正文字号: 'body',
  'body-strong': 'bodyStrong',
  bodystrong: 'bodyStrong',
  caption: 'caption',
  注释: 'caption',
  说明文字: 'caption',
  overline: 'overline',
}

/** 圆角档位别名 */
export const RADIUS_ALIASES: Record<string, string> = {
  sm: 'sm',
  small: 'sm',
  小: 'sm',
  md: 'md',
  medium: 'md',
  中: 'md',
  lg: 'lg',
  large: 'lg',
  大: 'lg',
  xl: 'xl',
  full: 'full',
  胶囊: 'full',
  全圆: 'full',
}

/** 间距档位别名 */
export const SPACE_ALIASES: Record<string, string> = {
  xxs: 'xxs',
  xs: 'xs',
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'xl',
  xxl: 'xxl',
  huge: 'huge',
}

/** 阴影档位别名 */
export const SHADOW_ALIASES: Record<string, string> = {
  xs: 'xs',
  sm: 'sm',
  md: 'md',
  lg: 'lg',
}

const COLOR_KEYS = new Set(Object.values(COLOR_ALIASES))
const FONT_KEYS = new Set(Object.values(FONT_ALIASES))
const RADIUS_KEYS = new Set(Object.values(RADIUS_ALIASES))
const SPACE_KEYS = new Set(Object.values(SPACE_ALIASES))
const SHADOW_KEYS = new Set(Object.values(SHADOW_ALIASES))

/** 规范化键名：去掉分隔符与大小写差异 */
function normKey(k: string): string {
  return k
    .trim()
    // 反引号 / 强调符是 Markdown 的排版噪声，不属键名本身
    // （serializeDesignMd 会输出 `| \`color.primary\` | ... |`，必须能对称解析回来）
    .replace(/[`*]/g, '')
    .replace(/^--/, '')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
}

/* ================================ 值解析 ================================ */

/** 提取颜色：优先 #hex，其次 rgb()/hsl()，最后具名色 */
export function parseColorValue(v: string): string | null {
  const s = String(v ?? '').trim()
  const hex = /#([0-9a-f]{3,8})\b/i.exec(s)
  if (hex) {
    const h = hex[1].toUpperCase()
    // 三 / 四位缩写展开成六位：同一颜色不管写成 #abc 还是 #aabbcc，
    // 都必须落到同一个 Token 值，否则「导出再导入」会被判定成颜色变了。
    // 四位形式（#RGBA / #ARGB）同样只保留 RGB 部分 —— Token 不承载透明度。
    if (h.length === 3 || h.length === 4) {
      return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
    }
    if (h.length === 6) return `#${h}`
    if (h.length === 8) return `#${h.slice(0, 6)}`
    return `#${h}`
  }
  const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)
  if (rgb) {
    const to = (n: string) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0')
    return `#${to(rgb[1])}${to(rgb[2])}${to(rgb[3])}`.toUpperCase()
  }
  return null
}

/** 提取长度数值（px / 无单位 / rem→px 按 16 换算） */
export function parseLengthValue(v: string): number | null {
  const s = String(v ?? '').trim()
  const rem = /^([\d.]+)\s*rem$/i.exec(s)
  if (rem) return Math.round(Number(rem[1]) * 16 * 100) / 100
  const px = /(-?[\d.]+)\s*(px)?/i.exec(s)
  if (px && px[1]) {
    const n = Number(px[1])
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * 阴影专用取色：**必须保留透明度**。
 *
 * 颜色 Token 按约定只保留 6 位 hex，但阴影丢掉 alpha 就会变成实心色块，
 * 相当于把设计改坏了 —— 所以这里对 rgba() / 4 位与 8 位 hex 都保真。
 */
function parseShadowColor(v: string): string {
  const s = String(v ?? '').trim()
  const hex8 = /#([0-9a-f]{8})\b/i.exec(s)
  if (hex8) return `#${hex8[1].toUpperCase()}`
  const hex4 = /#([0-9a-f]{4})\b/i.exec(s)
  if (hex4) {
    const h = hex4[1].toUpperCase()
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`
  }
  const fn = /rgba?\([^)]*\)/i.exec(s)
  if (fn) return fn[0].trim()
  return parseColorValue(s) ?? '#00000040'
}

/** 提取阴影：形如 `0 4px 14px rgba(0,0,0,.4)` —— 数值与颜色分开取 */
export function parseShadowValue(v: string): ShadowToken | null {
  const s = String(v ?? '').trim()
  if (!s || /^none$/i.test(s)) return null
  const color = parseShadowColor(s)
  const numbersOnly = s
    .replace(/#[0-9a-fA-F]{3,8}/g, ' ')
    .replace(/(rgb|hsl)a?\([^)]*\)/gi, ' ')
  const nums = (numbersOnly.match(/-?[\d.]+(?:\s*px)?/g) ?? [])
    .map((x) => parseLengthValue(x))
    .filter((n): n is number => n !== null)
  return {
    x: nums[0] ?? 0,
    y: nums[1] ?? 0,
    blur: nums[2] ?? 0,
    spread: nums[3],
    color,
  }
}

/** 提取字号描述：`16px/1.5`、`14px 400`、`Inter` 等 */
function parseFontSpec(v: string, current: FontToken): FontToken {
  const s = String(v ?? '')
  const size = parseLengthValue(s)
  const family = /([A-Za-z][A-Za-z0-9\s-]{1,40}?)(?=\s*[,;/]|\s+\d|$)/.exec(
    s.replace(/^[\d.]+(px|rem)?\s*/, ''),
  )
  const weight = /\b([1-9]00)\b/.exec(s)
  const lh = /\/\s*([\d.]+)/.exec(s) ?? /\bline-height[:=]\s*([\d.]+)/i.exec(s)
  return {
    ...current,
    size: size ?? current.size,
    family: family ? family[1].trim() : current.family,
    weight: weight ? Number(weight[1]) : current.weight,
    lineHeight: lh ? Number(lh[1]) : current.lineHeight,
  }
}

/* ================================ 解析主流程 ================================ */

export interface ParsedDesignMd {
  name?: string
  desc?: string
  tokens: Partial<Tokens>
  rules: SpecRules
  /** 原样保留的未能识别内容，供用户核对 */
  raw: string
  warnings: string[]
}

interface Sink {
  color: Record<string, string>
  font: Record<string, FontToken>
  space: Record<string, number>
  radius: Record<string, number>
  shadow: Record<string, ShadowToken>
  /** 结构化块（JSON）里声明的规范名与说明 —— 比 Markdown 标题更权威 */
  meta: { name?: string; desc?: string }
}

function emptySink(): Sink {
  return { color: {}, font: {}, space: {}, radius: {}, shadow: {}, meta: {} }
}

function hasAny(s: Sink): boolean {
  return (
    Object.keys(s.color).length > 0 ||
    Object.keys(s.font).length > 0 ||
    Object.keys(s.space).length > 0 ||
    Object.keys(s.radius).length > 0 ||
    Object.keys(s.shadow).length > 0
  )
}

/** 从 `group.key` 形式的键名里拆出组与键 */
function splitGroupedKey(raw: string): { group: string; key: string } | null {
  const k = normKey(raw)
  const m = /^(color|font|space|radius|shadow)[-/.]?(.+)$/.exec(k)
  if (!m) return null
  return { group: m[1], key: m[2] }
}

/** 把 group+key+value 写入 sink；返回是否识别成功 */
function put(sink: Sink, group: string, key: string, value: string): boolean {
  const g = group.toLowerCase()
  const k = normKey(key)

  if (g === 'color') {
    const mapped = COLOR_ALIASES[k] ?? COLOR_ALIASES[normKey(key.replace(/-/g, ''))] ?? (COLOR_KEYS.has(camel(k)) ? camel(k) : undefined)
    const color = parseColorValue(value)
    if (!mapped || !color) return false
    sink.color[mapped] = color
    return true
  }

  if (g === 'radius') {
    // full 固定 999（与 Token 约定一致），避免人写 8px 破坏胶囊语义
    const mapped = RADIUS_ALIASES[k] ?? (RADIUS_KEYS.has(camel(k)) ? camel(k) : undefined)
    if (!mapped) return false
    if (mapped === 'full') {
      sink.radius.full = 999
      return true
    }
    const n = parseLengthValue(value)
    if (n === null) return false
    sink.radius[mapped] = n
    return true
  }

  if (g === 'space') {
    const mapped = SPACE_ALIASES[k] ?? (SPACE_KEYS.has(k) ? k : undefined)
    const n = parseLengthValue(value)
    if (!mapped || n === null) return false
    sink.space[mapped] = n
    return true
  }

  if (g === 'shadow') {
    const mapped = SHADOW_ALIASES[k] ?? (SHADOW_KEYS.has(k) ? k : undefined)
    const sh = parseShadowValue(value)
    if (!mapped || !sh) return false
    sink.shadow[mapped] = sh
    return true
  }

  if (g === 'font') {
    // 两种写法：font.body（整体规格）或 font.body.size（单项）
    const prop = /^(.*?)[-/.]?(size|family|weight|line-height|lineheight|letterspacing)$/.exec(k)
    const base = prop ? prop[1] : k
    const mapped = FONT_ALIASES[base] ?? (FONT_KEYS.has(camel(base)) ? camel(base) : undefined)
    if (!mapped) return false
    const cur: FontToken = sink.font[mapped] ?? { family: '', size: 0 }
    if (prop) {
      const p = prop[2]
      if (p === 'size') {
        const n = parseLengthValue(value)
        if (n === null) return false
        cur.size = n
      } else if (p === 'family') {
        cur.family = value.trim()
      } else if (p === 'weight') {
        const n = Number(value.trim())
        if (!Number.isFinite(n)) return false
        cur.weight = n
      } else {
        const n = Number(value.trim())
        if (!Number.isFinite(n)) return false
        cur.lineHeight = n
      }
    } else {
      sink.font[mapped] = parseFontSpec(value, cur)
      return true
    }
    sink.font[mapped] = cur
    return true
  }

  return false
}

/** `primary-hover` → `primaryHover` */
function camel(k: string): string {
  return k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
}

/** 解析 fenced code block 里的 CSS 自定义属性 */
function scanCssBlock(block: string, sink: Sink): number {
  let hit = 0
  for (const line of block.split(/\r?\n/)) {
    const m = /^\s*(--[\w-]+|[\w.-]+)\s*:\s*([^;{}]+);?/.exec(line)
    if (!m) continue
    const grouped = splitGroupedKey(m[1])
    if (grouped && put(sink, grouped.group, grouped.key, m[2])) hit += 1
  }
  return hit
}

/** 解析 JSON 代码块 */
function scanJsonBlock(block: string, sink: Sink): number {
  let parsed: unknown
  try {
    parsed = JSON.parse(block)
  } catch {
    return 0
  }
  if (!parsed || typeof parsed !== 'object') return 0
  const o = parsed as Record<string, unknown>
  let hit = 0

  /* 规范元信息：Stitch / Claude Code 导出的 design.md 常把 name / description 放进 JSON 块 */
  const jName = typeof o.name === 'string' ? o.name.trim() : ''
  const jDesc =
    typeof o.description === 'string' ? o.description : typeof o.desc === 'string' ? o.desc : ''
  if (jName) sink.meta.name = jName
  if (jDesc.trim()) sink.meta.desc = jDesc.trim().slice(0, 200)

  const colorObj = o.color
  if (colorObj && typeof colorObj === 'object') {
    for (const [k, v] of Object.entries(colorObj as Record<string, unknown>)) {
      const c = parseColorValue(String(v))
      const mapped = COLOR_ALIASES[normKey(k)] ?? (COLOR_KEYS.has(camel(normKey(k))) ? camel(normKey(k)) : undefined)
      if (c && mapped) {
        sink.color[mapped] = c
        hit += 1
      }
    }
  }
  for (const group of ['space', 'radius'] as const) {
    const obj = o[group]
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const n = typeof v === 'number' ? v : parseLengthValue(String(v))
        const kk = normKey(k)
        const mapped =
          group === 'space'
            ? SPACE_ALIASES[kk] ?? (SPACE_KEYS.has(kk) ? kk : undefined)
            : RADIUS_ALIASES[kk] ?? (RADIUS_KEYS.has(camel(kk)) ? camel(kk) : undefined)
        if (n !== null && mapped) {
          if (group === 'radius' && mapped === 'full') sink.radius.full = 999
          else if (group === 'space') sink.space[mapped] = n
          else sink.radius[mapped] = n
          hit += 1
        }
      }
    }
  }
  const fontObj = o.font
  if (fontObj && typeof fontObj === 'object') {
    for (const [k, v] of Object.entries(fontObj as Record<string, unknown>)) {
      const kk = normKey(k)
      const mapped = FONT_ALIASES[kk] ?? (FONT_KEYS.has(camel(kk)) ? camel(kk) : undefined)
      if (!mapped || !v || typeof v !== 'object') continue
      const f = v as Record<string, unknown>
      sink.font[mapped] = {
        family: typeof f.family === 'string' ? f.family : '',
        size: Number(f.size) || 0,
        weight: Number(f.weight) || undefined,
        lineHeight: Number(f.lineHeight) || undefined,
      }
      hit += 1
    }
  }
  if (o.shadow && typeof o.shadow === 'object') {
    for (const [k, v] of Object.entries(o.shadow as Record<string, unknown>)) {
      const sh = parseShadowValue(
        typeof v === 'string'
          ? v
          : v && typeof v === 'object'
            ? `${(v as ShadowToken).x}px ${(v as ShadowToken).y}px ${(v as ShadowToken).blur}px ${(v as ShadowToken).color ?? '#00000040'}`
            : '',
      )
      const kk = normKey(k)
      const mapped = SHADOW_ALIASES[kk] ?? (SHADOW_KEYS.has(kk) ? kk : undefined)
      if (sh && mapped) {
        sink.shadow[mapped] = sh
        hit += 1
      }
    }
  }
  return hit
}

/** 解析 markdown 表格行：`| primary | #3B82F6 | 主色 |` */
function scanTableRow(line: string, sink: Sink): number {
  if (!line.trim().startsWith('|')) return 0
  const cells = line
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
  if (cells.length < 2) return 0
  const [k, v] = cells
  const grouped = splitGroupedKey(k)
  if (grouped) {
    /* 字体表格是多列形态（| font.h1 | Inter | 28px | 700 | 1.25 |）——
       只取前两列会给出一条 size=0 的残废 Token，必须按列还原。 */
    if (grouped.group === 'font' && cells.length >= 5) {
      const key = normKey(grouped.key)
      const mapped = FONT_ALIASES[key] ?? (FONT_KEYS.has(camel(key)) ? camel(key) : undefined)
      if (mapped) {
        const num = (s: string) => {
          const n = parseLengthValue(s)
          return n === null ? undefined : n
        }
        const weight = Number(cells[3])
        const lh = Number(cells[4])
        sink.font[mapped] = {
          family: cells[1] === '—' || cells[1] === '-' ? '' : cells[1],
          size: num(cells[2]) ?? 0,
          weight: Number.isFinite(weight) ? weight : undefined,
          lineHeight: Number.isFinite(lh) ? lh : undefined,
        }
        return 1
      }
    }
    if (put(sink, grouped.group, grouped.key, v)) return 1
  }
  // 无前缀的表格：靠值形态猜组
  const kk = normKey(k)
  if (parseColorValue(v)) {
    const mapped = COLOR_ALIASES[kk] ?? (COLOR_KEYS.has(camel(kk)) ? camel(kk) : undefined)
    if (mapped) {
      sink.color[mapped] = parseColorValue(v)!
      return 1
    }
  }
  return 0
}

/** 中文/英文「要点」行识别：`- DO 使用 8px 栅格` / `- 不要 使用纯黑背景` */
function scanRuleLine(line: string, rules: SpecRules): boolean {
  const t = line.trim().replace(/^[-*+]\s*/, '').trim()
  if (!t) return false
  const dont =
    /^(?:❌|✗|×|\u274c)/.test(t) ||
    /^(?:don'?t|dont|avoid|never|不要|禁止|不得|避免|严禁)\b/i.test(t)
  const doo =
    /^(?:✅|✓|√|\u2705)/.test(t) || /^(?:do\b|always|must|要|应当|应该|必须|建议)\b/i.test(t)
  if (dont) {
    rules.donts = [...(rules.donts ?? []), t.replace(/^(?:don'?t|dont|avoid|never|不要|禁止|不得|避免|严禁)\s*[:：]?\s*/i, '').trim() || t]
    return true
  }
  if (doo) {
    rules.dos = [...(rules.dos ?? []), t.replace(/^(?:do|always|must|要|应当|应该|必须|建议)\s*[:：]?\s*/i, '').trim() || t]
    return true
  }
  return false
}

/** 主入口：解析一份 DESIGN.md */
export function parseDesignMd(md: string): ParsedDesignMd {
  const text = String(md ?? '')
  const warnings: string[] = []
  const sink = emptySink()
  const rules: SpecRules = {}
  const unrecognized: string[] = []

  /* 1) 标题作为规范名（若结构化块里另有 name，稍后覆盖） */
  const titleMatch = /^#{1,2}\s+(.+)$/m.exec(text)
  let name = titleMatch ? titleMatch[1].trim() : undefined

  /* 2) 摘要段落：标题后到下一个标题之间的首段非空文本（必须跳过代码块，
     否则 ```` ```css ```` 这类围栏标记会被当成摘要写回去，把导出的文档自身截断） */
  let desc: string | undefined
  const lines = text.split(/\r?\n/)
  let inDesc = false
  let codeFence = false
  for (const line of lines) {
    const t = line.trim()
    if (/^```/.test(t)) {
      codeFence = !codeFence
      continue
    }
    if (codeFence) continue
    if (/^#{1,2}\s+/.test(t)) {
      if (inDesc) break
      inDesc = true
      continue
    }
    if (!inDesc) continue
    if (!t) continue
    if (t.startsWith('#') || t.startsWith('|') || t.startsWith('-') || t.startsWith('>')) continue
    desc = t.slice(0, 200)
    break
  }

  /* 3) 代码块 */
  const fence = /```([a-zA-Z]*)\r?\n([\s\S]*?)```/g
  let fm: RegExpExecArray | null
  const codeBlocks: string[] = []
  while ((fm = fence.exec(text)) !== null) {
    const lang = (fm[1] || '').toLowerCase()
    const body = fm[2]
    if (lang === 'json') {
      if (scanJsonBlock(body, sink) === 0) codeBlocks.push(body)
      else codeBlocks.push(body)
    } else {
      codeBlocks.push(body)
    }
  }
  for (const b of codeBlocks) {
    if (b.trim().startsWith('{')) scanJsonBlock(b, sink)
    scanCssBlock(b, sink)
  }

  /* 3.5) 结构化块里的 name / description 覆盖 Markdown 标题 ——
     自由文本标题易被译者 / 工具改写，JSON 字段才是规范作者的真实意图。 */
  if (sink.meta.name) name = sink.meta.name
  if (sink.meta.desc) desc = sink.meta.desc

  /* 4) 逐行扫描（表格 / 键值 / 规则）；跳过代码块内容避免重复计数 */
  let inFence = false
  for (const rawLine of lines) {
    if (/^\s*```/.test(rawLine)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const line = rawLine.trim()
    if (!line) continue
    if (scanRuleLine(line, rules)) continue
    if (scanTableRow(line, sink) > 0) continue
    const kv = /^[-*+]?\s*`?([\w\u4e00-\u9fa5./-]+)`?\s*[:：]\s*(.+)$/.exec(line)
    if (kv) {
      const grouped = splitGroupedKey(kv[1])
      if (grouped && put(sink, grouped.group, grouped.key, kv[2])) continue
      // 无组前缀：按值形态猜
      const kk = normKey(kv[1])
      if (parseColorValue(kv[2]) && (COLOR_ALIASES[kk] || COLOR_KEYS.has(camel(kk)))) {
        sink.color[COLOR_ALIASES[kk] ?? camel(kk)] = parseColorValue(kv[2])!
        continue
      }
      if (RADIUS_ALIASES[kk] || RADIUS_KEYS.has(camel(kk))) {
        const n = parseLengthValue(kv[2])
        if (n !== null) {
          const mapped = RADIUS_ALIASES[kk] ?? camel(kk)
          if (mapped === 'full') sink.radius.full = 999
          else sink.radius[mapped] = n
          continue
        }
      }
      if (SPACE_ALIASES[kk] || SPACE_KEYS.has(kk)) {
        const n = parseLengthValue(kv[2])
        if (n !== null) {
          sink.space[SPACE_ALIASES[kk] ?? kk] = n
          continue
        }
      }
      if (SHADOW_ALIASES[kk] || SHADOW_KEYS.has(kk)) {
        const sh = parseShadowValue(kv[2])
        if (sh) {
          sink.shadow[SHADOW_ALIASES[kk] ?? kk] = sh
          continue
        }
      }
      if (FONT_ALIASES[kk] || FONT_KEYS.has(camel(kk))) {
        const mapped = FONT_ALIASES[kk] ?? camel(kk)
        sink.font[mapped] = parseFontSpec(kv[2], sink.font[mapped] ?? { family: '', size: 0 })
        continue
      }
    }
    // 表格行与标题不属于「散文」，不进 raw（表格是已识别的容器，未消费的行无需原文兜底）
    if (!/^#{1,6}\s/.test(line) && !line.startsWith('|')) unrecognized.push(line)
  }

  if (!hasAny(sink)) warnings.push('未能从该文档中识别到任何 Token，请检查是否包含颜色 / 字号 / 圆角等定义。')
  if (!sink.color.primary) warnings.push('未识别到主色（primary），生成时将回退到既有 Token。')
  if (!desc) warnings.push('未识别到规范说明段落，将仅保留名称与 Token。')

  const tokens: Partial<Tokens> = {}
  if (Object.keys(sink.color).length) tokens.color = sink.color
  if (Object.keys(sink.font).length) tokens.font = sink.font
  if (Object.keys(sink.space).length) tokens.space = sink.space
  if (Object.keys(sink.radius).length) tokens.radius = sink.radius
  if (Object.keys(sink.shadow).length) tokens.shadow = sink.shadow

  return {
    name,
    desc,
    tokens,
    rules,
    raw: unrecognized.slice(0, 60).join('\n'),
    warnings,
  }
}

/* ================================ 序列化 ================================ */

const COLOR_LABELS: Record<string, string> = {
  primary: '主色',
  primaryHover: '主色·悬停',
  primaryActive: '主色·按下',
  primarySoft: '主色·浅底',
  onPrimary: '主色上的文字',
  bg: '页面底色',
  surface: '卡片/表面',
  surfaceAlt: '次级表面',
  border: '边框',
  borderStrong: '强边框',
  text: '正文文字',
  textSecondary: '次要文字',
  textMuted: '弱化文字',
  textInverse: '反色文字',
  success: '成功',
  warning: '警告',
  danger: '危险',
  info: '信息',
}

function colorRow(k: string, v: string): string {
  return `| \`color.${k}\` | \`${v}\` | ${COLOR_LABELS[k] ?? ''} |`
}

/** 把规范序列化成一份可读的 DESIGN.md（可与 Stitch / Claude Code 互通） */
export function serializeDesignMd(spec: Pick<DesignSpec, 'name' | 'desc' | 'tokens' | 'rules'>): string {
  const t = spec.tokens ?? {}
  const out: string[] = []

  out.push(`# ${spec.name || '设计规范'}`)
  out.push('')
  // 摘要必须单行且不含围栏标记：desc 里若混入 ``` 会把整份导出文档截断
  const safeDesc = (spec.desc ?? '')
    .split(/\r?\n/)[0]
    .replace(/`{2,}/g, '')
    .trim()
  out.push(
    safeDesc ||
      '本文件描述一套可复用的设计系统，遵循 Design Tokens 的键名约定，可被支持 DESIGN.md 的 AI 设计工具直接消费。',
  )
  out.push('')

  const colors = Object.entries(t.color ?? {}).filter(([, v]) => typeof v === 'string')
  if (colors.length) {
    out.push('## 颜色 Colors')
    out.push('')
    out.push('| Token | 值 | 用途 |')
    out.push('| --- | --- | --- |')
    colors.forEach(([k, v]) => out.push(colorRow(k, v)))
    out.push('')
  }

  const fonts = Object.entries(t.font ?? {}).filter(([, v]) => !!v)
  if (fonts.length) {
    out.push('## 字体 Typography')
    out.push('')
    out.push('| Token | family | size | weight | lineHeight |')
    out.push('| --- | --- | --- | --- | --- |')
    fonts.forEach(([k, v]) =>
      out.push(
        `| \`font.${k}\` | ${v.family || '—'} | ${v.size || 0}px | ${v.weight ?? '—'} | ${v.lineHeight ?? '—'} |`,
      ),
    )
    out.push('')
  }

  const radii = Object.entries(t.radius ?? {}).filter(([, v]) => Number.isFinite(v))
  if (radii.length) {
    out.push('## 圆角 Radius')
    out.push('')
    radii
      .sort((a, b) => a[1] - b[1])
      .forEach(([k, v]) => out.push(`- \`radius.${k}\`: ${v === 999 ? '999px' : `${v}px`}`))
    out.push('')
  }

  const spaces = Object.entries(t.space ?? {}).filter(([, v]) => Number.isFinite(v))
  if (spaces.length) {
    out.push('## 间距 Spacing')
    out.push('')
    spaces.forEach(([k, v]) => out.push(`- \`space.${k}\`: ${v}px`))
    out.push('')
  }

  const shadows = Object.entries(t.shadow ?? {}).filter(([, v]) => !!v)
  if (shadows.length) {
    out.push('## 阴影 Shadow')
    out.push('')
    shadows.forEach(([k, v]) =>
      out.push(
        `- \`shadow.${k}\`: ${v.x}px ${v.y}px ${v.blur}px${v.spread ? ` ${v.spread}px` : ''} ${v.color}`,
      ),
    )
    out.push('')
  }

  const dos = spec.rules?.dos ?? []
  const donts = spec.rules?.donts ?? []
  if (dos.length || donts.length) {
    out.push('## 规则 Rules')
    out.push('')
    if (dos.length) {
      out.push('### 要做什么 Do')
      out.push('')
      dos.forEach((d) => out.push(`- ✅ ${d}`))
      out.push('')
    }
    if (donts.length) {
      out.push('### 不要做什么 Don\'t')
      out.push('')
      donts.forEach((d) => out.push(`- ❌ ${d}`))
      out.push('')
    }
  }

  out.push('---')
  out.push('')
  out.push('_由望舒导出 · 可导入任何支持 DESIGN.md 的 AI 设计工具_')
  out.push('')
  return out.join('\n')
}

/* ================================ 组装规范 ================================ */

/** 用解析结果补齐成一份完整 DesignSpec（缺项从 base 继承） */
export function specFromParsed(
  parsed: ParsedDesignMd,
  opts: {
    name?: string
    base?: Tokens
    source?: SpecSource
    /** 补全缺失字体档位的字族（通常取 base 的 body 字族） */
    familyHint?: string
  } = {},
): DesignSpec {
  const base = opts.base ?? {}
  const family =
    opts.familyHint ||
    parsed.tokens.font?.body?.family ||
    base.font?.body?.family ||
    'Inter, system-ui, sans-serif'

  const color = { ...(base.color ?? {}), ...(parsed.tokens.color ?? {}) }
  const space = { ...(base.space ?? {}), ...(parsed.tokens.space ?? {}) }
  const radius = { ...(base.radius ?? {}), ...(parsed.tokens.radius ?? {}) }
  const shadow = { ...(base.shadow ?? {}), ...(parsed.tokens.shadow ?? {}) }
  const font = { ...(base.font ?? {}), ...(parsed.tokens.font ?? {}) }

  // 字体档位缺项补齐（保证 tokenMapForPage 一定能解析出 display..overline）
  const ladder: Array<[string, number, number]> = [
    ['display', 32, 700],
    ['h1', 24, 700],
    ['h2', 20, 600],
    ['h3', 17, 600],
    ['body', 14, 400],
    ['bodyStrong', 14, 600],
    ['caption', 12, 400],
    ['overline', 11, 600],
  ]
  for (const [key, size, weight] of ladder) {
    if (!font[key] || !font[key].size) {
      font[key] = { ...(font[key] ?? {}), family: font[key]?.family || family, size, weight: font[key]?.weight ?? weight }
    }
  }
  // 强制单调，避免导入的规范出现 h3 比 body 还小的倒挂
  const order = ['overline', 'caption', 'body', 'bodyStrong', 'h3', 'h2', 'h1', 'display']
  let prev = 0
  for (const k of order) {
    const f = font[k]
    if (!f) continue
    if (f.size <= prev) f.size = prev + 1
    prev = f.size
  }
  if (radius.full !== 999) radius.full = 999

  return {
    id: `spec_${uid()}`,
    name: opts.name || parsed.name || '导入的设计规范',
    desc: parsed.desc,
    source: opts.source ?? 'imported',
    tokens: { color, font, space, radius, shadow },
    rules: { ...(parsed.rules ?? {}) },
    createdAt: new Date().toISOString(),
  }
}
