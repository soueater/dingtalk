// src/services/design/html-to-nodes.ts
// HTML → 界面节点树（F-PM-05 扩展机制 X-5）。纯逻辑，可离线单测。
//
// 定位与边界（必须诚实说明）：这是**结构提炼**，不是"HTML 完美还原"。
// 它把常见语义标签映射为望舒的节点类型，并按文档顺序堆成一个纵向布局，
// 供用户拿到一个"形似"的可编辑骨架，再手工或让 AI 精修。
// 不做的事：不解析 CSS 布局（float/grid/flex 的具体尺寸）、不做选择器优先级计算
// （那是浏览器的事），只保留语义结构与文案。
import type { Node, NodeType } from '@shared/design'
import { uid } from '@/lib/id'

/** 语义标签 → 节点类型 */
const TAG_MAP: Record<string, NodeType> = {
  h1: 'text',
  h2: 'text',
  h3: 'text',
  h4: 'text',
  p: 'text',
  span: 'text',
  strong: 'text',
  b: 'text',
  small: 'text',
  label: 'text',
  li: 'listItem',
  button: 'button',
  a: 'button',
  input: 'input',
  textarea: 'textarea',
  select: 'select',
  img: 'image',
  svg: 'icon',
  hr: 'divider',
  table: 'table',
  ul: 'list',
  ol: 'list',
  nav: 'navbar',
  header: 'navbar',
  footer: 'tabbar',
  form: 'frame',
  section: 'frame',
  article: 'card',
  aside: 'card',
  main: 'frame',
  div: 'frame',
}

/** 需要跳过的非内容标签 */
const SKIP_TAGS = new Set(['script', 'style', 'head', 'meta', 'link', 'noscript', 'template', 'title', 'iframe'])

export interface HtmlExtractOptions {
  /** 最多保留多少个块，防止一个巨型页面产出上千节点 */
  maxBlocks?: number
  /** 根容器名称 */
  rootName?: string
}

/** 去掉 HTML 注释与 CDATA，避免正则被它们干扰 */
function stripNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&hellip;': '…',
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}

/** 取某个标签的开标签属性串 → 属性字典 */
function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    const key = m[1].toLowerCase()
    out[key] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}

interface RawBlock {
  tag: string
  text: string
  attrs: Record<string, string>
}

/**
 * 极简分词器：按标签顺序扫描，记录"内容型"标签的文本。
 * 不构建 DOM 树 —— 我们只需要文档顺序与文本，树的嵌套由"堆叠成列"近似。
 */
function scanBlocks(html: string, maxBlocks: number): RawBlock[] {
  const out: RawBlock[] = []
  const re = /<([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*)\/?>([\s\S]*?)<\/\1>|<([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*)\/?>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (out.length >= maxBlocks) break
    const tag = (m[1] ?? m[4] ?? '').toLowerCase()
    if (!tag || SKIP_TAGS.has(tag)) continue
    const attrRaw = m[2] ?? m[5] ?? ''
    const inner = m[3] ?? ''
    // 只取直接文本（去掉更深层的标签），避免把整棵子树文字都算进父节点
    const direct = decodeEntities(inner.replace(/<[^>]*>/g, ' '))
    const block: RawBlock = { tag, text: direct, attrs: parseAttrs(attrRaw) }
    if (direct || ['img', 'input', 'textarea', 'select', 'hr', 'svg'].includes(tag)) out.push(block)
  }
  return out
}

/** 依据标签与文本长度启发式地定标题层级 */
function fontSizeFor(tag: string): { size: number; weight: number } {
  switch (tag) {
    case 'h1':
      return { size: 28, weight: 700 }
    case 'h2':
      return { size: 22, weight: 700 }
    case 'h3':
      return { size: 18, weight: 600 }
    case 'h4':
      return { size: 16, weight: 600 }
    case 'small':
      return { size: 12, weight: 400 }
    default:
      return { size: 14, weight: 400 }
  }
}

function node(
  type: NodeType,
  name: string,
  props: Record<string, unknown>,
  layout: Node['layout'],
  style: Node['style'],
  children?: Node[],
): Node {
  return { id: `${type}_${uid()}`, type, name, props, layout, style, children }
}

/**
 * 把 HTML 提炼为一棵界面节点树。
 * 产出恒为「纵向堆叠 + 一个根 frame」，保证在画布上一定渲染得出来。
 */
export function htmlToNodes(html: string, opts: HtmlExtractOptions = {}): Node {
  const maxBlocks = Math.max(1, Math.min(500, opts.maxBlocks ?? 120))
  const blocks = scanBlocks(stripNoise(String(html ?? '')), maxBlocks)
  const children: Node[] = []

  for (const b of blocks) {
    const mapped = TAG_MAP[b.tag]
    if (!mapped) continue
    // div/section 这类无语义容器只有带文本时才值得保留，否则会产出成片的空盒子
    if ((mapped === 'frame' || mapped === 'card') && !b.text) continue

    switch (mapped) {
      case 'text': {
        const f = fontSizeFor(b.tag)
        const content = b.text.slice(0, 300)
        if (!content) break
        children.push(
          node('text', content.slice(0, 20) || '文本', { content }, { width: 'fill', height: 'fit' }, {
            font: f,
            textColor: b.tag === 'small' ? '$color.textSecondary' : '$color.text',
          }),
        )
        break
      }
      case 'listItem':
        children.push(
          node('listItem', b.text.slice(0, 16) || '列表项', { title: b.text.slice(0, 60) }, { mode: 'flex', width: 'fill', height: 52, align: 'center', padding: { t: 0, r: 12, b: 0, l: 12 } }, {
            fill: '$color.surface',
            radius: '$radius.md',
          }),
        )
        break
      case 'button':
        children.push(
          node('button', b.text.slice(0, 16) || '按钮', { label: b.text.slice(0, 30) || '按钮' }, { mode: 'flex', width: 'fill', height: 44, justify: 'center', align: 'center' }, {
            fill: '$color.primary',
            radius: '$radius.md',
            textColor: '$color.onPrimary',
          }),
        )
        break
      case 'input':
      case 'textarea':
      case 'select':
        children.push(
          node(mapped, b.attrs.placeholder || b.attrs.name || '输入框', { placeholder: b.attrs.placeholder ?? '' }, { width: 'fill', height: mapped === 'textarea' ? 96 : 44 }, {
            radius: '$radius.md',
            fill: '$color.surface',
            stroke: { color: '$color.border', width: 1 },
          }),
        )
        break
      case 'image': {
        const src = b.attrs.src ?? ''
        if (!src) break
        children.push(
          node('image', b.attrs.alt || '图片', { src, alt: b.attrs.alt ?? '' }, { width: 'fill', height: 180 }, {
            radius: '$radius.md',
          }),
        )
        break
      }
      case 'icon':
        children.push(node('icon', '图标', {}, { width: 24, height: 24 }, { fill: '$color.textSecondary' }))
        break
      case 'navbar':
        children.push(
          node('navbar', b.text || '顶部导航', { title: b.text.slice(0, 30) || '标题' }, { mode: 'flex', width: 'fill', height: 52, align: 'center', padding: { t: 0, r: 16, b: 0, l: 16 } }, {
            fill: '$color.surface',
            textColor: '$color.text',
          }),
        )
        break
      case 'tabbar':
        children.push(node('tabbar', '底部导航', {}, { width: 'fill', height: 56 }, { fill: '$color.surface' }))
        break
      case 'divider':
        children.push(node('divider', '分割线', {}, { width: 'fill', height: 1 }, { fill: '$color.border' }))
        break
      case 'table':
        children.push(node('table', '表格', { columns: [], rows: [] }, { width: 'fill', height: 200 }, { fill: '$color.surface', radius: '$radius.md' }))
        break
      case 'list':
      case 'frame':
      case 'card':
      default:
        children.push(
          node(mapped, b.text.slice(0, 16) || '容器', b.text ? { title: b.text.slice(0, 60) } : {}, { width: 'fill', height: 'fit', padding: { t: 12, r: 12, b: 12, l: 12 } }, {
            fill: '$color.surface',
            radius: '$radius.md',
          }),
        )
        break
    }
  }

  return node(
    'frame',
    opts.rootName ?? '界面根容器',
    {},
    { mode: 'flex', direction: 'column', width: 'fill', height: 'fill', padding: { t: 16, r: 16, b: 16, l: 16 }, gap: 12 },
    { fill: '$color.bg' },
    children,
  )
}

/** 从 HTML 里猜一个界面名（<title> 或首个标题） */
export function guessInterfaceName(html: string, fallback = '导入的界面'): string {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (t) {
    const v = decodeEntities(t[1])
    if (v) return v.slice(0, 40)
  }
  const h = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  if (h) {
    const v = decodeEntities(h[1].replace(/<[^>]*>/g, ''))
    if (v) return v.slice(0, 40)
  }
  return fallback
}
