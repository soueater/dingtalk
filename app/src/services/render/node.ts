// src/services/render/node.ts
// 单一节点 → HTML 字符串。画布、预览、导出三处共用，保证「所见即所得」。
import type { Node, Style, Layout, Edges, StateOverride } from '@shared/design'
import { TokenMap, resolveColor, resolveNumber, resolveValue, sizeToCss } from './tokens'

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/* ------------------------------ 样式合成 ------------------------------ */

function edges(v: Edges | undefined): string | null {
  if (!v) return null
  const t = v.t ?? 0
  const r = v.r ?? 0
  const b = v.b ?? 0
  const l = v.l ?? 0
  if (t === r && r === b && b === l) return `${t}px`
  return `${t}px ${r}px ${b}px ${l}px`
}

function radiusCss(v: Style['radius'], map: TokenMap): string | null {
  if (v == null) return null
  if (typeof v === 'number') return `${v}px`
  if (typeof v === 'string') {
    const resolved = resolveValue<number | string>(v, map)
    if (typeof resolved === 'number') return `${resolved}px`
    if (typeof resolved === 'string') return resolved
    return null
  }
  const r = v as { tl?: number; tr?: number; br?: number; bl?: number }
  return `${r.tl ?? 0}px ${r.tr ?? 0}px ${r.br ?? 0}px ${r.bl ?? 0}px`
}

function shadowCss(style: Style | undefined, map: TokenMap): string | null {
  if (!style?.shadow?.length) return null
  const parts = style.shadow.map((s) => {
    if (typeof s === 'string') {
      const r = resolveValue<{ x: number; y: number; blur: number; spread?: number; color: string }>(s, map)
      if (r) return `${r.x}px ${r.y}px ${r.blur}px ${r.spread ?? 0}px ${r.color}`
      return null
    }
    return `${s.x}px ${s.y}px ${s.blur}px ${s.spread ?? 0}px ${s.color}`
  })
  const valid = parts.filter(Boolean)
  return valid.length ? valid.join(', ') : null
}

/** 把节点的 style + layout 合成为 CSS 文本 */
export function styleToCss(style: Style | undefined, layout: Layout | undefined, map: TokenMap): string {
  const out: string[] = []
  const s = style ?? {}
  const l = layout ?? {}

  /* --- 盒模型 --- */
  if (l.mode === 'flex') {
    out.push(`display:flex`)
    out.push(`flex-direction:${l.direction === 'row' ? 'row' : 'column'}`)
    if (l.gap != null) out.push(`gap:${l.gap}px`)
    if (l.justify) {
      const jm: Record<string, string> = {
        start: 'flex-start',
        center: 'center',
        end: 'flex-end',
        between: 'space-between',
        around: 'space-around',
        evenly: 'space-evenly',
      }
      out.push(`justify-content:${jm[l.justify] ?? 'flex-start'}`)
    }
    if (l.align) {
      const am: Record<string, string> = {
        start: 'flex-start',
        center: 'center',
        end: 'flex-end',
        stretch: 'stretch',
        baseline: 'baseline',
      }
      out.push(`align-items:${am[l.align] ?? 'stretch'}`)
    }
    if (l.wrap) out.push('flex-wrap:wrap')
  } else if (l.mode === 'grid') {
    out.push(`display:grid`)
    out.push(`grid-template-columns:repeat(${l.columns ?? 2}, minmax(0, 1fr))`)
    if (l.gap != null) out.push(`gap:${l.gap}px`)
  }

  if (l.grow) out.push(`flex-grow:${l.grow}`)
  if (l.selfAlign && l.selfAlign !== 'auto') {
    const sm: Record<string, string> = {
      start: 'flex-start',
      center: 'center',
      end: 'flex-end',
      stretch: 'stretch',
    }
    out.push(`align-self:${sm[l.selfAlign] ?? 'auto'}`)
  }

  if (l.width != null) out.push(`width:${sizeToCss(l.width, 'width', map)}`)
  if (l.height != null) out.push(`height:${sizeToCss(l.height, 'height', map)}`)

  /* --- 定位 ---
     关键：自由定位必须产出真正的 `position:absolute; left; top`，不能退化成 margin。
     若用 margin 实现，元素仍受文档流影响（前一个兄弟的高度/间距都会把它推走），
     于是属性面板里显示的 X/Y 与实际渲染位置不再一致，用户会直观感到
     「组件框和内容对不上」。改为绝对定位后，x/y 就是相对页面左上角的真实坐标，
     与画布选中框读取的坐标完全同源。 */
  const explicitPos = l.position && l.position !== 'static' ? l.position : null
  const hasXY = l.x != null || l.y != null
  if (hasXY) {
    out.push(`position:${explicitPos ?? 'absolute'}`)
    out.push(`left:${l.x ?? 0}px`)
    out.push(`top:${l.y ?? 0}px`)
  } else if (explicitPos) {
    out.push(`position:${explicitPos}`)
  }

  const pad = edges(l.padding)
  if (pad) out.push(`padding:${pad}`)
  const mar = edges(l.margin)
  if (mar) out.push(`margin:${mar}`)

  if (l.zIndex != null) out.push(`z-index:${l.zIndex}`)

  /* --- 外观 --- */
  if (s.fill != null) {
    const c = resolveColor(s.fill, map, 'transparent')
    if (c !== 'transparent') out.push(`background:${c}`)
  }
  if (s.stroke?.color != null && s.stroke.width) {
    const c = resolveColor(s.stroke.color, map, 'transparent')
    if (c !== 'transparent') out.push(`border:${s.stroke.width}px ${s.borderStyle ?? 'solid'} ${c}`)
  } else if (s.borderStyle && s.borderStyle !== 'none') {
    out.push(`border-style:${s.borderStyle}`)
  }

  const r = radiusCss(s.radius, map)
  if (r) out.push(`border-radius:${r}`)

  const sh = shadowCss(s, map)
  if (sh) out.push(`box-shadow:${sh}`)

  if (s.opacity != null && s.opacity !== 1) out.push(`opacity:${s.opacity}`)
  if (s.overflow) out.push(`overflow:${s.overflow}`)
  if (s.cursor) out.push(`cursor:${s.cursor}`)
  // F-ST-02：transform 主要服务于 states（如 active 的 scale(0.96)）
  if (s.transform) out.push(`transform:${s.transform}`)

  /* --- 文字 --- */
  if (s.font) {
    if (s.font.family) out.push(`font-family:${s.font.family}, var(--font-ui)`)
    if (s.font.size != null) out.push(`font-size:${s.font.size}px`)
    if (s.font.weight != null) out.push(`font-weight:${s.font.weight}`)
    if (s.font.lineHeight != null) out.push(`line-height:${s.font.lineHeight}px`)
    if (s.font.letterSpacing != null) out.push(`letter-spacing:${s.font.letterSpacing}px`)
    if (s.font.italic) out.push(`font-style:italic`)
  }
  if (s.textColor != null) out.push(`color:${resolveColor(s.textColor, map, '#000')}`)
  if (s.textAlign) out.push(`text-align:${s.textAlign}`)
  if (s.textDecoration) out.push(`text-decoration:${s.textDecoration}`)
  if (s.textTransform) out.push(`text-transform:${s.textTransform}`)

  if (s.maxLines && s.maxLines > 0) {
    out.push(`display:-webkit-box`)
    out.push(`-webkit-line-clamp:${s.maxLines}`)
    out.push(`-webkit-box-orient:vertical`)
    out.push(`overflow:hidden`)
  }

  return out.join(';')
}

/* ----------------------- 交互状态（states）渲染 -----------------------
   F-ST-02 / 2B：`Node.states` 在类型里早已定义，但渲染层此前零实现。
   难点在于——**内联 style 属性的优先级高于任何普通类选择器**，
   所以「悬停变亮」这类效果无法用内联样式表达，必须：
     1. 为带 states 的节点生成作用域规则（用 id 全局唯一的 [data-id="…"] 锚定）；
     2. 为每条声明追加 `!important`，否则压不过元素自身的内联 style；
     3. 把规则集中放进一个 <style> 块，随四处渲染消费方（画布 / 预览 / 变体 / 导出）一起输出。

   作用域锚点选择 `[data-id]` 而非 `.n-{type}`：节点 id 在项目内唯一
   （导入时由 dedupeIdsAcrossPages 保证），因此同一份规则在「多页画布并存」
   与「多页导出到单文件」的场景下都不会串扰。 */

/** 受支持的 state 键 → CSS 伪类。未知键一律跳过（避免产出非法选择器拖垮整个 style 块） */
const STATE_PSEUDO: Record<string, string> = {
  hover: ':hover',
  active: ':active',
  focus: ':focus',
  'focus-visible': ':focus-visible',
  'focus-within': ':focus-within',
  disabled: ':disabled',
  checked: ':checked',
  visited: ':visited',
}

/** 需要「可聚焦」才有意义的伪类：命中时给节点补 tabindex="0" */
const FOCUS_STATES = new Set(['focus', 'focus-visible', 'focus-within'])

/** 把一段声明串逐条追加 `!important`（states 规则必须压过节点内联样式） */
function bang(css: string): string {
  if (!css) return ''
  return css
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => (d.includes('!important') ? d : `${d}!important`))
    .join(';')
}

/** 该节点是否有可渲染的状态（用于决定是否补 tabindex） */
export function hasFocusState(node: Node): boolean {
  const st = node.states
  if (!st) return false
  return Object.keys(st).some((k) => FOCUS_STATES.has(k) && st[k]?.style)
}

/** 单个节点的所有状态规则，如 `[data-id="b1"]:hover{background:#2563eb!important}` */
function stateRulesOf(node: Node, map: TokenMap): string[] {
  const st = node.states
  if (!st) return []
  const sel = `[data-id="${esc(node.id)}"]`
  const out: string[] = []
  for (const [key, override] of Object.entries(st)) {
    const pseudo = STATE_PSEUDO[key]
    if (!pseudo) continue
    const body = bang(styleToCss((override as StateOverride)?.style, undefined, map))
    if (body) out.push(`${sel}${pseudo}{${body}}`)
  }
  return out
}

/** 递归收集子树中所有节点的状态规则（按 id 去重，顺序稳定） */
export function collectStateRules(root: Node, map: TokenMap): string[] {
  const seen = new Set<string>()
  const rules: string[] = []
  const walk = (n: Node) => {
    if (!n || n.hidden) return
    if (!seen.has(n.id)) {
      seen.add(n.id)
      rules.push(...stateRulesOf(n, map))
    }
    for (const c of n.children ?? []) walk(c)
  }
  walk(root)
  return rules
}

/** 状态规则组成的 <style> 文本（无状态时返回空串，不污染 DOM） */
export function statesCss(root: Node, map: TokenMap): string {
  const rules = collectStateRules(root, map)
  return rules.length ? rules.join('') : ''
}

/**
 * 渲染子树并附带状态 <style> 块。
 * 画布 / 预览 / 变体缩略图共用此入口，保证「画布所见 = 预览 = 导出」。
 * <style> 置于内容之后，让状态规则在同等 specificity 下后置胜出。
 */
export function renderNodeWithStates(root: Node, map: TokenMap): string {
  const html = renderNode(root, map)
  const css = statesCss(root, map)
  return css ? `${html}<style>${css}</style>` : html
}

/* --------------------------- 类型专属渲染 --------------------------- */

const TEXT_ALIGN_CENTER = 'display:flex;align-items:center'

function placeholderFor(node: Node): string {
  const p = (node.props ?? {}) as Record<string, unknown>
  switch (node.type) {
    case 'image':
      return `<div class="ph ph-image"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 17l5-5 4 4 3-3 4 4"/></svg></div>`
    case 'icon':
      return `<div class="ph ph-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z"/></svg></div>`
    case 'chart': {
      const data = ((node.props?.dataset as number[]) ?? [12, 18, 15, 24, 30, 28, 36]).slice(0, 12)
      const max = Math.max(...data, 1)
      const w = 100 / data.length
      const bars = data
        .map((v, i) => {
          const h = Math.max(4, (v / max) * 100)
          return `<i style="left:${i * w}%;width:${w * 0.6}%;height:${h}%"></i>`
        })
        .join('')
      return `<div class="ph ph-chart">${bars}</div>`
    }
    case 'avatar':
      return `<div class="ph ph-avatar">${esc(String(node.props?.initials ?? ''))}</div>`
    case 'map':
      return `<div class="ph ph-map"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/></svg></div>`
    case 'calendar':
      return `<div class="ph ph-cal"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>`
    case 'skeleton':
      return `<div class="ph ph-skel"><i></i><i></i><i></i></div>`
    case 'empty':
      return `<div class="ph ph-empty"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 7h16v13H4z"/><path d="M4 7l3-3h10l3 3"/><path d="M9 12h6"/></svg><span>暂无数据</span></div>`
    default:
      return ''
  }
}

/** 判断是否为「叶子」型组件（自带内容，不渲染 children 的普通容器语义） */
function isLeafish(type: Node['type']): boolean {
  return [
    'text', 'button', 'input', 'textarea', 'image', 'icon', 'avatar', 'badge',
    'tag', 'chip', 'divider', 'progress', 'slider', 'switch', 'checkbox', 'radio',
    'select', 'chart', 'map', 'calendar', 'skeleton', 'empty', 'searchbar',
    'tooltip', 'breadcrumb', 'pagination', 'stepper',
  ].includes(type)
}

function innerHtml(node: Node, map: TokenMap): string {
  const p = (node.props ?? {}) as Record<string, unknown>
  switch (node.type) {
    case 'text':
      return esc(String(p.content ?? p.text ?? node.name ?? ''))
    case 'button':
      return `<span>${esc(String(p.label ?? node.name ?? '按钮'))}</span>`
    case 'input':
      return `<span class="ph-txt">${esc(String(p.value ?? p.placeholder ?? '请输入'))}</span>`
    case 'textarea':
      return `<span class="ph-txt">${esc(String(p.value ?? p.placeholder ?? '请输入内容'))}</span>`
    case 'searchbar':
      return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/></svg><span class="ph-txt">${esc(String(p.placeholder ?? '搜索'))}</span>`
    case 'divider':
      return ''
    case 'progress': {
      const v = Math.max(0, Math.min(100, Number(p.value ?? 60)))
      return `<i style="width:${v}%"></i>`
    }
    case 'badge':
    case 'tag':
    case 'chip':
      return esc(String(p.label ?? node.name ?? '标签'))
    case 'avatar':
      return esc(String(p.initials ?? (String(p.name ?? 'U').slice(0, 1))))
    case 'switch':
      return `<i class="knob"></i>`
    case 'checkbox':
      return p.checked ? `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 8.5L6.3 11.5 13 4.5"/></svg>` : ''
    case 'radio':
      return p.checked ? `<i class="dot"></i>` : ''
    case 'select':
      return `<span class="ph-txt">${esc(String(p.value ?? p.placeholder ?? '请选择'))}</span><svg class="caret" viewBox="0 0 10 6" width="9" height="9"><path d="M0 0l5 6 5-6z" fill="currentColor"/></svg>`
    case 'slider':
      return `<i class="track"></i><i class="knob" style="left:${Math.max(0, Math.min(100, Number(p.value ?? 50)))}%"></i>`
    case 'navbar':
      return `<span class="ph-title">${esc(String(p.title ?? node.name ?? '标题'))}</span>`
    case 'tabbar':
      return ((p.items as string[]) ?? ['首页', '发现', '我的'])
        .map((t, i) => `<span class="${i === 0 ? 'on' : ''}">${esc(String(t))}</span>`)
        .join('')
    case 'sidebar':
      return ((p.items as string[]) ?? ['菜单一', '菜单二', '菜单三'])
        .map((t, i) => `<span class="${i === 0 ? 'on' : ''}">${esc(String(t))}</span>`)
        .join('')
    case 'breadcrumb':
      return ((p.items as string[]) ?? ['首页', '列表', '详情'])
        .map((t, i, a) => `<span>${esc(String(t))}</span>${i < a.length - 1 ? '<em>/</em>' : ''}`)
        .join('')
    case 'pagination':
      return `<span>‹</span><span class="on">1</span><span>2</span><span>3</span><span>›</span>`
    case 'stepper':
      return ((p.steps as string[]) ?? ['信息', '确认', '完成'])
        .map((t, i) => `<span class="${i === 0 ? 'on' : ''}">${i + 1}. ${esc(String(t))}</span>`)
        .join('')
    case 'tooltip':
      return `<span class="ph-txt">${esc(String(p.content ?? '提示内容'))}</span>`
    case 'toast':
      return `<span class="ph-txt">${esc(String(p.content ?? '操作成功'))}</span>`
    default:
      if (node.children?.length) {
        return node.children.map((c) => renderNode(c, map)).join('')
      }
      return placeholderFor(node)
  }
}

/** 需要「内容居中」类基础样式的类型 */
function baseTypeCss(type: Node['type']): string {
  switch (type) {
    case 'button':
      return 'display:flex;align-items:center;justify-content:center;text-align:center'
    case 'text':
      return ''
    case 'input':
    case 'textarea':
    case 'select':
      return 'display:flex;align-items:center;gap:6px'
    case 'divider':
      return ''
    case 'switch':
      return 'display:flex;align-items:center;justify-content:flex-start;padding:2px;border-radius:999px'
    case 'checkbox':
      return 'display:flex;align-items:center;justify-content:center'
    case 'radio':
      return 'display:flex;align-items:center;justify-content:center;border-radius:50%'
    case 'avatar':
      return 'display:flex;align-items:center;justify-content:center;font-weight:600'
    case 'badge':
    case 'tag':
    case 'chip':
      return 'display:inline-flex;align-items:center;justify-content:center;padding:2px 8px'
    case 'progress':
      return 'overflow:hidden'
    case 'chart':
    case 'map':
    case 'calendar':
    case 'skeleton':
    case 'empty':
      return 'position:relative;display:flex'
    case 'navbar':
    case 'searchbar':
      return 'display:flex;align-items:center;gap:8px'
    case 'tabbar':
      return 'display:flex;align-items:center;justify-content:space-around'
    case 'sidebar':
      return 'display:flex;flex-direction:column;gap:6px'
    case 'breadcrumb':
      return 'display:flex;align-items:center;gap:6px'
    case 'pagination':
      return 'display:flex;align-items:center;gap:4px'
    case 'stepper':
      return 'display:flex;align-items:center;gap:8px'
    case 'tooltip':
    case 'toast':
      return 'display:flex;align-items:center;padding:6px 10px;border-radius:6px'
    default:
      return ''
  }
}

/** 渲染单个节点为 HTML 字符串 */
export function renderNode(node: Node, map: TokenMap): string {
  if (node.hidden) return ''

  const base = baseTypeCss(node.type)
  const css = [base, styleToCss(node.style, node.layout, map)].filter(Boolean).join(';')
  const content = innerHtml(node, map)
  const nameAttr = node.name ? ` data-name="${esc(node.name)}"` : ''
  // 带 focus 类状态的节点需可聚焦，否则伪类永远不会命中（div 默认不可聚焦）
  const tabAttr = hasFocusState(node) ? ' tabindex="0"' : ''

  // 语义标签映射
  const tag =
    node.type === 'button'
      ? 'div'
      : node.type === 'divider'
        ? 'div'
        : node.type === 'image'
          ? 'div'
          : 'div'

  return `<${tag} class="n n-${node.type}" data-id="${esc(node.id)}"${nameAttr}${tabAttr} style="${css}">${content}</${tag}>`
}

/** 渲染整页 */
export function renderPage(
  page: { root: Node; background?: string },
  map: TokenMap,
  canvas: { width: number; height: number },
): string {
  const bg = resolveColor(page.background, map, '#FFFFFF')
  const content = renderNode(page.root, map)
  const css = statesCss(page.root, map)
  const styleBlock = css ? `<style>${css}</style>` : ''
  return `<div class="page-root" style="width:${canvas.width}px;height:${canvas.height}px;background:${bg};position:relative;overflow:hidden">${content}${styleBlock}</div>`
}
