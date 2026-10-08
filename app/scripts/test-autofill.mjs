// scripts/test-autofill.mjs —— F-ST-02 页面自动补全能力测试
//
// 覆盖：
//   ① 渲染内核 states → 作用域 CSS 规则块（伪类可用、!important 压内联、四处同源）
//   ② 本地规则版 states 填充（§3.3.2 五类元素 / 11 个 type）
//   ③ states 应用器（不可变、已存在不覆盖、可多状态合并）
//   ④ flows 自动推理（文案语义匹配 / 返回语义 / 转场选择）+ normalizeFlows 校验
//   ⑤ 断链检测（dangling + missing-page）与补页建议清单
//   ⑥ 端到端 buildAutofillPlan
// 运行：node scripts/test-autofill.mjs

import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'dist', 'test')
const tmpLib = path.join(outDir, 'autofill-lib.cjs')

await build({
  entryPoints: [path.join(root, 'scripts', 'autofill-test-entry.mjs')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: tmpLib,
  logLevel: 'error',
  alias: {
    '@shared/design': path.join(root, 'shared', 'design.ts'),
    '@/services/render/tokens': path.join(root, 'src', 'services', 'render', 'tokens.ts'),
    '@/services/design/specs': path.join(root, 'src', 'services', 'design', 'specs.ts'),
    '@/services/design/style-presets': path.join(root, 'scripts', 'stub-presets.js'),
    '@/services/mock/projects': path.join(root, 'scripts', 'stub-projects.js'),
  },
})

const require = createRequire(import.meta.url)
const A = require(tmpLib)

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const group = (t) => console.log(`\n${t}`)

/* ============================ 测试数据 ============================ */

const N = (id, type, extra = {}) => ({ id, type, name: id, ...extra })

const TOKENS = {
  color: {
    primary: '#3B82F6',
    primaryHover: '#2563EB',
    primaryActive: '#1D4ED8',
    bg: '#FFFFFF',
    surface: '#F9FAFB',
    surfaceAlt: '#F3F4F6',
    text: '#111827',
  },
  space: { xs: 4, sm: 8, md: 16 },
  radius: { sm: 6, md: 10 },
}

/** 一份含多类待补元素的单页设计 */
function makeDesign(pagesExtra = [], flows = []) {
  return {
    schemaVersion: '1.1',
    meta: {
      id: 'proj_af', name: '补全测试', device: 'MOBILE', canvas: { width: 390, height: 844 },
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', source: 'blank',
    },
    tokens: TOKENS,
    assets: [],
    pages: [
      {
        id: 'page_home', name: '首页', order: 0, pos: { x: 0, y: 0 },
        root: N('root_h', 'frame', {
          layout: { mode: 'flex', direction: 'column' },
          children: [
            N('btn_primary', 'button', { style: { fill: '$color.primary' }, props: { label: '立即预约' } }),
            N('btn_ghost', 'button', { style: { fill: '#FFFFFF' }, props: { label: '取消' } }),
            N('card_1', 'card', { children: [N('txt_c', 'text', { props: { content: '卡片' } })] }),
            N('li_1', 'listItem', { props: { label: '列表项' } }),
            N('inp_1', 'input', { props: { placeholder: '请输入' } }),
            N('ta_1', 'textarea', { props: { placeholder: '描述' } }),
            N('sel_1', 'select', { props: { placeholder: '请选择' } }),
            N('sw_1', 'switch', {}),
            N('cb_1', 'checkbox', {}),
            N('rd_1', 'radio', {}),
            N('tag_1', 'tag', { props: { label: '标签' } }),
            N('chip_1', 'chip', { props: { label: '筛选' } }),
            N('div_1', 'divider', {}),
          ],
        }),
      },
      ...pagesExtra,
    ],
    flows,
  }
}

const MAP = A.buildTokenMap(TOKENS)
const MAPS = new Map([['page_home', MAP]])

/* ==================================================================== */
/*                ① 渲染内核：states → 作用域 CSS 规则块                 */
/* ==================================================================== */

group('① 渲染内核 · statesToCss 生成作用域规则')
{
  const node = N('b1', 'button', {
    style: { fill: '$color.primary' },
    props: { label: '提交' },
    states: {
      hover: { style: { fill: '$color.primaryHover' } },
      active: { style: { transform: 'scale(0.96)' } },
    },
  })
  const css = A.statesCss(node, MAP)

  check('产出非空 CSS', css.length > 0, css)
  check('hover 规则挂在 [data-id] 上', css.includes('[data-id="b1"]:hover'), css)
  check('active 规则挂在 [data-id] 上', css.includes('[data-id="b1"]:active'), css)
  check('Token 引用被解析为真实色值', css.includes('#2563EB'), css)
  check('每条声明带 !important（压过内联 style）', css.includes('!important'), css)
  check('transform 被渲染', css.includes('scale(0.96)'), css)
  check('规则块不含内联 style 属性', !css.includes('style='), css)
}

group('① 渲染内核 · 无 states 时不产出规则（不污染 DOM）')
{
  check('普通节点返回空串', A.statesCss(N('plain', 'text', {}), MAP) === '')
  check('states 为空对象亦返回空串', A.statesCss(N('e', 'button', { states: {} }), MAP) === '')
  check('states 只有未知键时返回空串', A.statesCss(N('u', 'button', { states: { weird: { style: { fill: '#000' } } } }), MAP) === '')
  check('未知键不产出非法选择器', !A.statesCss(N('u2', 'button', { states: { weird: { style: { fill: '#000' } } } }), MAP).includes('weird'))
}

group('① 渲染内核 · 递归收集子树状态规则')
{
  const root = N('r', 'frame', {
    children: [
      N('c1', 'button', { states: { hover: { style: { fill: '#111' } } } }),
      N('c2', 'frame', {
        children: [N('c3', 'input', { states: { focus: { style: { fill: '#222' } } } })],
      }),
    ],
  })
  const rules = A.collectStateRules(root, MAP)
  check('收集到 2 条规则（深层子节点也含）', rules.length === 2, JSON.stringify(rules))
  check('含 c1 的 hover', rules.some((r) => r.includes('[data-id="c1"]:hover')))
  check('含深层 c3 的 focus', rules.some((r) => r.includes('[data-id="c3"]:focus')))
  check('无状态节点不产出规则', !rules.some((r) => r.includes('[data-id="r"]')))
}

group('① 渲染内核 · renderNodeWithStates 组合输出')
{
  const node = N('x1', 'button', { props: { label: '确定' }, states: { hover: { style: { fill: '#0f0' } } } })
  const html = A.renderNodeWithStates(node, MAP)
  check('含节点本体', html.includes('data-id="x1"'), html)
  check('含 <style> 块', html.includes('<style>'), html)
  check('style 块在节点之后（后置胜出）', html.indexOf('<style>') > html.indexOf('data-id="x1"'), html)

  const plain = N('x2', 'text', { props: { content: 'hi' } })
  check('无 states 时不含 style 块', !A.renderNodeWithStates(plain, MAP).includes('<style>'))
}

group('① 渲染内核 · focus 态节点自动补 tabindex')
{
  const withFocus = N('f1', 'input', { props: {}, states: { focus: { style: { fill: '#000' } } } })
  const noFocus = N('f2', 'input', { props: {}, states: { hover: { style: { fill: '#000' } } } })
  check('带 focus 态的节点补 tabindex="0"', A.renderNode(withFocus, MAP).includes('tabindex="0"'))
  check('无 focus 态的节点不补 tabindex', !A.renderNode(noFocus, MAP).includes('tabindex'))
  check('hasFocusState 判定正确', A.hasFocusState(withFocus) === true && A.hasFocusState(noFocus) === false)
}

group('① 渲染内核 · hidden 节点不产出状态规则')
{
  const root = N('r', 'frame', {
    children: [N('h1', 'button', { hidden: true, states: { hover: { style: { fill: '#000' } } } })],
  })
  check('隐藏节点的规则被跳过', A.collectStateRules(root, MAP).length === 0)
}

group('① 渲染内核 · renderPage 携带状态块')
{
  const page = { root: N('pr', 'frame', { children: [N('pb', 'button', { states: { hover: { style: { fill: '#123456' } } } })] }), background: '$color.bg' }
  const html = A.renderPage(page, MAP, { width: 390, height: 844 })
  check('渲染后含状态规则', html.includes('[data-id="pb"]:hover'), html)
  check('含 page-root 容器', html.includes('class="page-root"'))
  check('背景 Token 被解析', html.includes('#FFFFFF'), html)
}

group('① 渲染内核 · 静态样式不受影响（回归）')
{
  const node = N('s1', 'button', { layout: { mode: 'flex', width: 120, x: 10, y: 20 }, style: { fill: '$color.primary', radius: '$radius.md' }, props: { label: '按钮' } })
  const html = A.renderNode(node, MAP)
  check('保留 class 契约', html.includes('class="n n-button"'), html)
  check('保留内联 style 属性', html.includes('style="'), html)
  check('fill 内联解析正确', html.includes('background:#3B82F6'), html)
  check('radius Token 解析正确', html.includes('border-radius:10px'), html)
  check('绝对定位保留', html.includes('position:absolute') && html.includes('left:10px'))
  check('无 states 输出与旧版一致', !html.includes('<style>'))
}

/* ==================================================================== */
/*                    ② 本地规则版 states 填充                           */
/* ==================================================================== */

group('② 规则版 states —— 覆盖 §3.3.2 全部 5 类元素')
{
  const d = makeDesign()
  const sug = A.suggestStates(d, MAPS)
  const types = new Set(sug.map((s) => s.nodeType))

  check('button 被覆盖', types.has('button'))
  check('card 被覆盖', types.has('card'))
  check('listItem 被覆盖', types.has('listItem'))
  check('input/textarea/select 被覆盖', types.has('input') && types.has('textarea') && types.has('select'))
  check('switch/checkbox/radio 被覆盖', types.has('switch') && types.has('checkbox') && types.has('radio'))
  check('tag/chip 被覆盖', types.has('tag') && types.has('chip'))
  check('divider 等无规则类型不产出建议', !types.has('divider'))
  check('text/frame 不产出建议', !types.has('text') && !types.has('frame'))
}

group('② 规则版 states —— 具体映射正确性')
{
  const d = makeDesign()
  const sug = A.suggestStates(d, MAPS)
  const of = (nodeId, state) => sug.find((s) => s.nodeId === nodeId && s.state === state)

  const btnHover = of('btn_primary', 'hover')
  check('主色按钮 hover 用 primaryHover', btnHover?.style.fill === '$color.primaryHover', JSON.stringify(btnHover?.style))
  const btnActive = of('btn_primary', 'active')
  check('主色按钮 active 用 primaryActive', btnActive?.style.fill === '$color.primaryActive')
  const btnFocus = of('btn_primary', 'focus')
  check('主色按钮 focus 带主色描边', btnFocus?.style.stroke?.color === '$color.primary')
  check('主色按钮 focus 带外发光', Array.isArray(btnFocus?.style.shadow) && btnFocus.style.shadow.length > 0)

  const ghostHover = of('btn_ghost', 'hover')
  check('非主色按钮 hover 不改成主色', ghostHover?.style.fill === '$color.surfaceAlt', JSON.stringify(ghostHover?.style))

  const cardHover = of('card_1', 'hover')
  check('card hover 阴影升一档', Array.isArray(cardHover?.style.shadow) && cardHover.style.shadow.length > 0)
  check('card hover 显示手型', cardHover?.style.cursor === 'pointer')

  const liHover = of('li_1', 'hover')
  check('listItem hover 加底色 + 手型', liHover?.style.cursor === 'pointer' && liHover?.style.fill === '$color.surfaceAlt')

  const inpFocus = of('inp_1', 'focus')
  check('input focus 转主色边框', inpFocus?.style.stroke?.color === '$color.primary')

  const swActive = of('sw_1', 'active')
  check('switch active 缩放 0.96', swActive?.style.transform === 'scale(0.96)', JSON.stringify(swActive?.style))
  check('checkbox active 缩放', of('cb_1', 'active')?.style.transform === 'scale(0.96)')
  check('radio active 缩放', of('rd_1', 'active')?.style.transform === 'scale(0.96)')

  check('tag hover 背景加深', of('tag_1', 'hover')?.style.fill === '$color.surfaceAlt')
  check('chip hover 背景加深', of('chip_1', 'hover')?.style.fill === '$color.surfaceAlt')
}

group('② 规则版 states —— 幂等与不覆盖')
{
  const d = makeDesign()
  d.pages[0].root.children[0].states = { hover: { style: { fill: '#CUSTOM' } } }
  const sug = A.suggestStates(d, MAPS)
  check('已有 hover 的节点不再建议 hover', !sug.some((s) => s.nodeId === 'btn_primary' && s.state === 'hover'))
  check('同节点的其它 state 仍被建议', sug.some((s) => s.nodeId === 'btn_primary' && s.state === 'active'))

  const again = A.suggestStates(d, MAPS)
  check('重复调用结果稳定（纯函数）', JSON.stringify(again) === JSON.stringify(sug))
}

group('② 规则版 states —— 建议项字段完整')
{
  const sug = A.suggestStates(makeDesign(), MAPS)
  const s = sug.find((x) => x.nodeId === 'btn_primary' && x.state === 'hover')
  check('含 id', typeof s?.id === 'string' && s.id.includes('btn_primary'))
  check('含 pageId', s?.pageId === 'page_home')
  check('含 pageName', s?.pageName === '首页')
  check('含 nodeLabel（按钮文案）', s?.nodeLabel === '立即预约', s?.nodeLabel)
  check('含 nodePath（可读路径）', typeof s?.nodePath === 'string' && s.nodePath.includes('首页'), s?.nodePath)
  check('含人类可读说明', typeof s?.label === 'string' && s.label.length > 0)
}

/* ==================================================================== */
/*                      ③ states 应用器                                 */
/* ==================================================================== */

group('③ applyStates —— 不可变更新')
{
  const d = makeDesign()
  const before = JSON.stringify(d)
  const sug = A.suggestStates(d, MAPS)
  const picked = sug.filter((s) => s.nodeId === 'btn_primary' && s.state === 'hover')
  const next = A.applyStates(d, picked)

  check('原对象未被改动', JSON.stringify(d) === before)
  check('返回新对象', next !== d)
  const node = A.findNode(next, 'btn_primary')
  check('states 已写入目标节点', node?.states?.hover?.style?.fill === '$color.primaryHover', JSON.stringify(node?.states))
  check('其它节点未受影响', A.findNode(next, 'div_1')?.states === undefined)
}

group('③ applyStates —— 已存在状态被合并而非覆盖')
{
  const d = makeDesign()
  const node = A.findNode(d, 'btn_primary')
  node.states = { hover: { style: { fill: '#PRESET', cursor: 'pointer' } } }
  const sug = A.suggestStates(d, MAPS)
  const picked = sug.filter((s) => s.nodeId === 'btn_primary' && s.state === 'hover')
  const next = A.applyStates(d, picked)
  const after = A.findNode(next, 'btn_primary')
  check('已有字段被保留', after?.states?.hover?.style?.cursor === 'pointer', JSON.stringify(after?.states))
}

group('③ applyStates —— 多状态 / 多节点')
{
  const d = makeDesign()
  const sug = A.suggestStates(d, MAPS)
  const next = A.applyStates(d, sug)
  const btn = A.findNode(next, 'btn_primary')
  check('同一节点可写多个 state', !!btn?.states?.hover && !!btn?.states?.active && !!btn?.states?.focus)
  check('switch 的 active 已写入', A.findNode(next, 'sw_1')?.states?.active?.style?.transform === 'scale(0.96)')
  check('空选择返回原对象（零开销）', A.applyStates(d, []) === d)
}

group('③ applyStates 与渲染联动 —— 补完后伪类可用')
{
  const d = makeDesign()
  const sug = A.suggestStates(d, MAPS)
  const next = A.applyStates(d, sug)
  const page = next.pages[0]
  const css = A.statesCss(page.root, MAP)
  check('补完后生成规则块', css.length > 0)
  check('主色按钮 hover 规则存在', css.includes('[data-id="btn_primary"]:hover'))
  check('switch active 缩放规则存在', css.includes('[data-id="sw_1"]:active') && css.includes('scale(0.96)'))
  check('已解析为真实色值', css.includes('#2563EB'), css.slice(0, 200))

  const counts = A.countStatedNodes(next)
  check('统计：已带 states 的节点数正确', counts.stated > 0, JSON.stringify(counts))
  check('统计：节点总数 > 已带状态数', counts.nodes > counts.stated)
}

/* ==================================================================== */
/*                       ④ flows 自动推理                               */
/* ==================================================================== */

const DETAIL_PAGE = {
  id: 'page_detail', name: '详情页', order: 1, pos: { x: 430, y: 0 },
  root: N('root_d', 'frame', { children: [N('txt_d', 'text', { props: { content: '详情' } })] }),
}

group('④ matchPageByText —— 文案与页面名语义匹配')
{
  const pages = [
    { id: 'page_home', name: '首页' },
    { id: 'page_detail', name: '详情页' },
    { id: 'page_pay', name: '结算页' },
  ]
  check('「查看详情」→ 详情页', A.matchPageByText('查看详情', pages, 'page_home')?.id === 'page_detail')
  check('「去结算」→ 结算页', A.matchPageByText('去结算', pages, 'page_home')?.id === 'page_pay')
  check('「结算」→ 结算页', A.matchPageByText('结算', pages, 'page_home')?.id === 'page_pay')
  check('不含页面名的文案返回 null', A.matchPageByText('随便点点', pages, 'page_home') === null)
  check('不会匹配到自己所在页', A.matchPageByText('首页', pages, 'page_home') === null)
  check('空文案返回 null', A.matchPageByText('', pages, 'page_home') === null)
  check('超长文案不做匹配（避免误报）', A.matchPageByText('这是一段非常长的文本内容不应该参与跳转匹配的', pages, 'page_home') === null)
}

group('④ suggestFlows —— 自动推理跳转')
{
  const d = makeDesign([DETAIL_PAGE])
  d.pages[0].root.children.push(N('btn_detail', 'button', { props: { label: '查看详情' } }))
  const sug = A.suggestFlows(d)
  check('推理出至少 1 条 flow', sug.length >= 1, JSON.stringify(sug.map((s) => s.label)))
  const f = sug.find((s) => s.fromNodeId === undefined || s.flow.from === 'btn_detail')
  check('源节点正确', f?.flow.from === 'btn_detail')
  check('目标页正确', f?.flow.to === 'page_detail')
  check('fromPage 正确', f?.flow.fromPage === 'page_home')
  check('trigger 为 click', f?.flow.trigger === 'click')
  check('层级推进用 slide-left', f?.flow.transition === 'slide-left', f?.flow.transition)
  check('含可读 label', typeof f?.label === 'string' && f.label.includes('详情'), f?.label)
}

group('④ suggestFlows —— 返回语义节点')
{
  const d = makeDesign([DETAIL_PAGE])
  d.pages[1].root.children.push(N('btn_back', 'button', { props: { label: '返回' } }))
  const sug = A.suggestFlows(d)
  const back = sug.find((s) => s.flow.from === 'btn_back')
  check('识别出返回语义', back?.flow.trigger === 'back', JSON.stringify(back?.flow))
  check('返回目标是前一页', back?.flow.to === 'page_home', back?.flow.to)
  check('返回转场用 slide-right', back?.flow.transition === 'slide-right')
  check('kind 标记为 back', back?.kind === 'back')
}

group('④ suggestFlows —— 幂等')
{
  const d = makeDesign([DETAIL_PAGE])
  d.pages[0].root.children.push(N('btn_detail', 'button', { props: { label: '查看详情' } }))
  const a = A.suggestFlows(d)
  const b = A.suggestFlows(d)
  check('重复调用结果稳定', JSON.stringify(a) === JSON.stringify(b))
}

group('④ suggestFlows —— 已有 flow 不重复建议')
{
  const d = makeDesign([DETAIL_PAGE], [
    { id: 'f1', from: 'btn_detail', fromPage: 'page_home', to: 'page_detail', trigger: 'click' },
  ])
  d.pages[0].root.children.push(N('btn_detail', 'button', { props: { label: '查看详情' } }))
  const sug = A.suggestFlows(d)
  check('已存在同向 flow 时不建议', !sug.some((s) => s.flow.from === 'btn_detail' && s.flow.to === 'page_detail'))
}

group('④ suggestFlows —— 单页项目无跳转可推')
{
  check('仅 1 个页面时返回空', A.suggestFlows(makeDesign()).length === 0)
}

group('④ validateFlowSuggestions —— 复用 normalizeFlows')
{
  const pages = [makeDesign([DETAIL_PAGE]).pages[0], DETAIL_PAGE]
  const good = {
    id: 'g', flow: { id: 'flow_g', from: 'btn_primary', fromPage: 'page_home', to: 'page_detail', trigger: 'click' },
    fromPageName: '首页', toPageName: '详情页', triggerLabel: 'x', kind: 'plain', label: 'l',
  }
  const danglingTarget = {
    id: 'd1', flow: { id: 'flow_d1', from: 'btn_primary', fromPage: 'page_home', to: 'page_ghost', trigger: 'click' },
    fromPageName: '首页', toPageName: '幽灵页', triggerLabel: 'x', kind: 'plain', label: 'l',
  }
  const badSource = {
    id: 'd2', flow: { id: 'flow_d2', from: 'node_ghost', fromPage: 'page_home', to: 'page_detail', trigger: 'click' },
    fromPageName: '首页', toPageName: '详情页', triggerLabel: 'x', kind: 'plain', label: 'l',
  }
  const r = A.validateFlowSuggestions([good, danglingTarget, badSource], pages)
  check('保留合法 flow', r.ok.length === 1 && r.ok[0].flow.id === 'flow_g', JSON.stringify(r.ok.map((x) => x.id)))
  check('丢弃指向不存在页面的 flow', !r.ok.some((x) => x.flow.to === 'page_ghost'))
  check('丢弃源节点不存在的 flow', !r.ok.some((x) => x.flow.from === 'node_ghost'))
  check('统计被丢弃条数', r.dropped === 2, String(r.dropped))
}

group('④ applyFlows —— 合并与去重')
{
  const d = makeDesign([DETAIL_PAGE])
  d.pages[0].root.children.push(N('btn_detail', 'button', { props: { label: '查看详情' } }))
  const sug = A.suggestFlows(d)
  const next = A.applyFlows(d, sug)
  check('flow 已写入', next.flows.length === sug.length, `${next.flows.length} vs ${sug.length}`)
  check('原对象未被改动', d.flows.length === 0)
  check('flow 携带 id', next.flows.every((f) => typeof f.id === 'string' && f.id.length > 0))

  const twice = A.applyFlows(next, sug)
  check('重复应用不产生重复 flow', twice.flows.length === next.flows.length, String(twice.flows.length))
  check('空选择返回原对象', A.applyFlows(d, []) === d)
}

group('④ applyFlows —— 结果一定通过 normalizeFlows')
{
  const d = makeDesign([DETAIL_PAGE])
  d.pages[0].root.children.push(N('btn_detail', 'button', { props: { label: '查看详情' } }))
  const sug = A.suggestFlows(d)
  const next = A.applyFlows(d, sug)
  // 手写一次 normalizeFlows，结果应与 applyFlows 内部一致
  const expect = A.normalizeFlows(d.flows.concat(sug.map((s) => s.flow)), next.pages)
  check('与 normalizeFlows 输出一致', JSON.stringify(next.flows) === JSON.stringify(expect), JSON.stringify(next.flows))
  check('无悬空跳转（to 都存在）', next.flows.every((f) => next.pages.some((p) => p.id === f.to)))
  check('无悬空源节点（from 都存在）', next.flows.every((f) => !!A.findNode(next, f.from)))
  check('条数不超过 40', next.flows.length <= 40)
}

/* ==================================================================== */
/*                     ⑤ 断链检测与补页建议                             */
/* ==================================================================== */

group('⑤ detectBrokenLinks —— flows 指向不存在的页')
{
  const d = makeDesign([], [
    { id: 'f1', from: 'btn_primary', fromPage: 'page_home', to: 'page_ghost', trigger: 'click' },
  ])
  const links = A.detectBrokenLinks(d)
  const dangling = links.filter((l) => l.kind === 'dangling')
  check('检出 1 条断链', dangling.length === 1, JSON.stringify(links))
  check('断链类型正确', dangling[0]?.kind === 'dangling')
  check('记录缺失的 pageId', dangling[0]?.missingPageId === 'page_ghost')
  check('记录来源页面名', dangling[0]?.fromPageName === '首页')
  check('含面向用户的说明', typeof dangling[0]?.detail === 'string' && dangling[0].detail.includes('page_ghost'))
}

group('⑤ detectBrokenLinks —— CTA 文案暗示缺页')
{
  const d = makeDesign()
  d.pages[0].root.children.push(N('btn_pay', 'button', { props: { label: '去支付' } }))
  const links = A.detectBrokenLinks(d)
  const missing = links.filter((l) => l.kind === 'missing-page')
  check('检出 CTA 缺页', missing.length === 1, JSON.stringify(links.map((l) => l.detail)))
  check('期望页面名取自按钮文案', missing[0]?.expectedName === '支付', missing[0]?.expectedName)
  check('记录源节点', missing[0]?.fromNodeId === 'btn_pay')
  check('记录触发文案', missing[0]?.triggerLabel === '去支付')
}

group('⑤ detectBrokenLinks —— 已有对应页面时不算缺页')
{
  const payPage = { id: 'page_pay', name: '支付页', order: 1, pos: { x: 430, y: 0 }, root: N('root_p', 'frame', {}) }
  const d = makeDesign([payPage])
  d.pages[0].root.children.push(N('btn_pay', 'button', { props: { label: '去支付' } }))
  const links = A.detectBrokenLinks(d).filter((l) => l.kind === 'missing-page')
  check('存在语义相近页面时不建议补页', links.length === 0, JSON.stringify(links.map((l) => l.detail)))
}

group('⑤ detectBrokenLinks —— 已有跳转的节点不重复建议')
{
  const d = makeDesign([], [
    { id: 'f1', from: 'btn_pay', fromPage: 'page_home', to: 'page_home', trigger: 'click' },
  ])
  d.pages[0].root.children.push(N('btn_pay', 'button', { props: { label: '去支付' } }))
  const links = A.detectBrokenLinks(d).filter((l) => l.kind === 'missing-page')
  check('已连跳转的节点不再建议补页', links.length === 0)
}

group('⑤ inferMissingPage —— 文案 → 页面语义')
{
  check('「去结算」→ 结算', A.inferMissingPage('去结算')?.name === '结算')
  check('「立即购买」→ 购买', A.inferMissingPage('立即购买')?.name === '购买')
  check('「登录」→ 登录', A.inferMissingPage('登录')?.name === '登录')
  check('「我的」→ 我的', A.inferMissingPage('我的')?.name === '我的')
  check('给出用途说明', (A.inferMissingPage('去支付')?.purpose ?? '').length > 0)
  check('无 CTA 语义返回 null', A.inferMissingPage('随便一句') === null)
  check('空串返回 null', A.inferMissingPage('') === null)
  check('超长文案返回 null', A.inferMissingPage('这是一段很长很长的说明性文案不应该被当作按钮') === null)
}

group('⑤ buildPageSuggestions —— 补页建议清单')
{
  const d = makeDesign([], [
    { id: 'f1', from: 'btn_primary', fromPage: 'page_home', to: 'page_ghost', trigger: 'click' },
  ])
  d.pages[0].root.children.push(N('btn_pay', 'button', { props: { label: '去支付' } }))
  const sug = A.buildPageSuggestions(d)
  check('聚合出建议（一个缺失页一条）', sug.length === 2, JSON.stringify(sug.map((s) => s.name)))
  const names = sug.map((s) => s.name)
  check('含断链页建议', names.includes('page_ghost'))
  check('含 CTA 页建议', names.includes('支付'))
  const pay = sug.find((s) => s.name === '支付')
  check('含建议页面 id', typeof pay?.suggestedId === 'string' && pay.suggestedId.startsWith('page_'))
  check('建议 id 不与现有页面冲突', !d.pages.some((p) => p.id === pay?.suggestedId))
  check('含用途', (pay?.purpose ?? '').length > 0)
  check('含默认区块骨架', Array.isArray(pay?.keySections) && pay.keySections.length > 0, JSON.stringify(pay?.keySections))
  check('含补页理由', Array.isArray(pay?.reasons) && (pay?.reasons.length ?? 0) > 0)
  check('理由含触发文案上下文', pay?.reasons.some((r) => r.includes('去支付')), JSON.stringify(pay?.reasons))
  check('含关联断链', Array.isArray(pay?.links) && (pay?.links.length ?? 0) > 0)
}

group('⑤ buildPageSuggestions —— 无断链时为空')
{
  const d = makeDesign([DETAIL_PAGE], [
    { id: 'f1', from: 'btn_primary', fromPage: 'page_home', to: 'page_detail', trigger: 'click' },
  ])
  const sug = A.buildPageSuggestions(d)
  check('完全连通的项目不产出补页建议', sug.length === 0, JSON.stringify(sug.map((s) => s.name)))
}

group('⑤ defaultSectionsFor 用途映射（经 buildPageSuggestions 间接验证）')
{
  const mk = (label) => {
    const d = makeDesign()
    d.pages[0].root.children.push(N('btn_x', 'button', { props: { label } }))
    return A.buildPageSuggestions(d)[0]
  }
  check('支付类含订单摘要', (mk('去支付')?.keySections ?? []).some((s) => s.includes('订单')))
  check('登录类含账号输入', (mk('登录')?.keySections ?? []).some((s) => s.includes('账号')))
  check('设置类含退出登录', (mk('设置')?.keySections ?? []).some((s) => s.includes('退出')))
}

/* ==================================================================== */
/*                     ⑥ 端到端 buildAutofillPlan                        */
/* ==================================================================== */

group('⑥ buildAutofillPlan —— 汇总计划')
{
  const d = makeDesign([DETAIL_PAGE], [
    { id: 'f1', from: 'btn_primary', fromPage: 'page_home', to: 'page_ghost', trigger: 'click' },
  ])
  d.pages[0].root.children.push(N('btn_detail', 'button', { props: { label: '查看详情' } }))
  d.pages[0].root.children.push(N('btn_pay', 'button', { props: { label: '去支付' } }))

  const plan = A.buildAutofillPlan(d, () => MAP)
  check('含补页建议', plan.pages.length >= 1, JSON.stringify(plan.pages.map((p) => p.name)))
  check('含断链清单', plan.brokenLinks.length >= 1)
  check('含 states 建议', plan.states.length > 0, String(plan.states.length))
  check('含 flows 建议', plan.flows.length > 0, JSON.stringify(plan.flows.map((f) => f.label)))
  check('flows 全部合法（to 存在）', plan.flows.every((f) => d.pages.some((p) => p.id === f.flow.to)))
  check('报告被 normalizeFlows 丢弃的条数', typeof plan.droppedFlows === 'number')
  check('states 建议不含 divider', !plan.states.some((s) => s.nodeType === 'divider'))
}

group('⑥ buildAutofillPlan —— 干净项目返回空计划')
{
  const d = makeDesign([DETAIL_PAGE], [
    { id: 'f1', from: 'btn_primary', fromPage: 'page_home', to: 'page_detail', trigger: 'click' },
  ])
  const sug = A.suggestStates(d, MAPS)
  const withStates = A.applyStates(d, sug)
  const plan = A.buildAutofillPlan(withStates, () => MAP)
  check('已补 states 后不再建议 states', plan.states.length === 0, String(plan.states.length))
  check('无断链', plan.brokenLinks.length === 0, JSON.stringify(plan.brokenLinks.map((b) => b.detail)))
  check('无补页建议', plan.pages.length === 0)
}

group('⑥ 端到端 —— 补全后渲染可用的交互原型')
{
  const d = makeDesign([DETAIL_PAGE])
  d.pages[0].root.children.push(N('btn_detail', 'button', { props: { label: '查看详情' } }))
  const plan = A.buildAutofillPlan(d, () => MAP)

  // 模拟用户全选采纳
  let next = A.applyStates(d, plan.states)
  next = A.applyFlows(next, plan.flows)

  check('states 已落盘', A.countStatedNodes(next).stated > 0)
  check('flows 已落盘', next.flows.length > 0)
  const css = A.statesCss(next.pages[0].root, MAP)
  check('渲染输出含伪类规则', css.includes(':hover'), css.slice(0, 120))
  check('规则不含悬空引用', !css.includes('undefined') && !css.includes('$color.'), css.slice(0, 200))
}

group('⑥ resolveStateStyle —— 预览用色值解析')
{
  const out = A.resolveStateStyle({ fill: '$color.primaryHover', cursor: 'pointer' }, MAP)
  check('fill 解析为真实色值', out.background === '#2563EB', JSON.stringify(out))
  check('cursor 原样保留', out.cursor === 'pointer')
  check('空样式返回空对象', Object.keys(A.resolveStateStyle(undefined, MAP)).length === 0)
}

/* ==================================================================== */
/*                     ⑦ 工具函数（覆盖率补充）                           */
/* ==================================================================== */

group('⑦ walkNodes / findNode / nodeLabel')
{
  const d = makeDesign()
  let count = 0
  A.walkNodes(d.pages[0].root, () => count++)
  check('walkNodes 遍历全部节点', count > 10, String(count))
  check('findNode 能在指定页找到', A.findNode(d, 'btn_primary', 'page_home')?.id === 'btn_primary')
  check('findNode 找不到时返回 null', A.findNode(d, 'nope') === null)
  check('nodeLabel 优先取 props.label', A.nodeLabel(A.findNode(d, 'btn_primary')) === '立即预约')
  check('nodeLabel 回退到 props.content', A.nodeLabel(A.findNode(d, 'txt_c')) === '卡片')
  check('nodeLabel 再回退到 name', A.nodeLabel(N('n', 'frame', { name: '容器' })) === '容器')
  // 注意：测试助手 N() 会强制写入 name = id，所以要拿到 type 兜底必须显式置空
  check('nodeLabel 最后回退到 type', A.nodeLabel({ id: 'n2', type: 'frame' }) === 'frame')
}

group('⑦ cloneTree 深拷贝')
{
  const src = { a: { b: [1, 2, 3] } }
  const copy = A.cloneTree(src)
  copy.a.b.push(4)
  check('拷贝独立于源', src.a.b.length === 3)
}

group('⑦ slugifyPageId 稳定性与冲突规避')
{
  const taken = new Set(['page_x'])
  const a = A.slugifyPageId('结算', taken)
  const b = A.slugifyPageId('结算', taken)
  check('产出以 page_ 开头', a.startsWith('page_'))
  check('规避已占用 id', !taken.has(a))
  // 稳定性：同名页面必须得到同一个 id，否则重复采纳会造出一堆重复页
  check('同名页面 id 稳定', a === b, `${a} vs ${b}`)
  check('不同页面名产出不同 id', A.slugifyPageId('登录', taken) !== a)
  // 冲突规避：真正占用后再取，应自动追加序号
  const taken2 = new Set([a])
  const c = A.slugifyPageId('结算', taken2)
  check('已被占用时自动追加序号', c !== a && c.startsWith(a), c)
}

/* ============================== 汇总 ============================== */

console.log(`\n通过 ${pass} · 失败 ${fail}`)
if (fail) {
  console.log('\n失败明细：')
  failures.forEach((f) => console.log(`  - ${f}`))
  process.exit(1)
}
