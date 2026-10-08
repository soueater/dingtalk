// scripts/test-optimize.mjs
// F-ST-04 页面 AI 优化能力测试
//   ① 载荷校验/修补 ② ops 应用器（update/add/remove/replaceContent + 嵌套合并 + clamp）
//   ③ 掉库与 flows 级联 ④ 规则化诊断 ⑤ 意图保全 ⑥ 端到端 optimizePage（stub 模型）
// 运行：node scripts/test-optimize.mjs

import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'dist', 'test')
const tmpOpt = path.join(outDir, 'optimize-lib.cjs')

const SHARED = path.join(root, 'shared', 'design.ts')

/* optimize.ts 以相对路径 import './client'（经 ask-json 传递），esbuild 的 alias 不匹配相对路径，
   因此在解析阶段用插件把 client 换成可控替身。 */
const stubClientPlugin = {
  name: 'stub-client',
  setup(b) {
    b.onResolve({ filter: /(^|\/)client$/ }, (args) => {
      if (args.importer.endsWith(path.join('ai', 'ask-json.ts'))) {
        return { path: path.join(root, 'scripts', 'stub-client.js') }
      }
      return null
    })
  },
}

await build({
  entryPoints: [path.join(root, 'scripts', 'optimize-test-entry.mjs')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: tmpOpt,
  logLevel: 'error',
  plugins: [stubClientPlugin],
  alias: {
    '@shared/design': SHARED,
    '@/services/render/tokens': path.join(root, 'src', 'services', 'render', 'tokens.ts'),
    '@/services/design/specs': path.join(root, 'src', 'services', 'design', 'specs.ts'),
    '@/services/design/style-presets': path.join(root, 'scripts', 'stub-presets.js'),
    '@/services/mock/projects': path.join(root, 'scripts', 'stub-projects.js'),
  },
})

const require = createRequire(import.meta.url)
const O = require(tmpOpt)

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

/** 一个含多类问题的页面，供诊断类断言使用 */
function makeDesign() {
  return {
    schemaVersion: '1.1',
    meta: {
      id: 'proj_opt', name: '优化测试', device: 'MOBILE', canvas: { width: 390, height: 844 },
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', source: 'blank',
    },
    tokens: { color: { bg: '#FFFFFF', text: '#111827' }, space: { xs: 4, sm: 8, md: 16, lg: 24 } },
    assets: [],
    pages: [
      {
        id: 'page_a', name: '主页', order: 0, pos: { x: 0, y: 0 },
        root: N('root_a', 'frame', {
          layout: { mode: 'flex', direction: 'column', gap: 13, padding: { t: 7, r: 16, b: 16, l: 16 } },
          children: [
            N('txt_h1', 'text', { style: { font: { size: 20, lineHeight: 22 } }, props: { content: '主标题' } }),
            N('txt_body', 'text', { style: { font: { size: 14, lineHeight: 16 } }, props: { content: '正文内容' } }),
            N('btn_1', 'button', { style: { radius: 8, fill: '$color.bg' }, props: { label: '确定' } }),
            N('btn_2', 'button', { style: { radius: 20, fill: '$color.bg' }, props: { label: '取消' } }),
            N('empty_box', 'frame', {}),
          ],
        }),
      },
    ],
    flows: [],
  }
}

/* ============================ ① 载荷校验/修补 ============================ */

group('① 载荷校验 validateOpsPayload')
{
  check('空对象被拒', O.validateOpsPayload({}).ok === false)
  check('ops 缺失时给出面向用户的文案', O.validateOpsPayload({}).errors[0].includes('未返回任何改动'))
  check('ops 为空数组被拒', O.validateOpsPayload({ ops: [] }).ok === false)
  check('全部缺少 op 字段被拒', O.validateOpsPayload({ ops: [{ id: 'a' }] }).ok === false)
  check('至少一条可用即放行', O.validateOpsPayload({ ops: [{ op: 'remove', id: 'x' }] }).ok === true)
  const mixed = O.validateOpsPayload({ ops: [{ op: 'remove', id: 'x' }, { id: 'y' }] })
  check('混入坏条目时给出告警', mixed.ok === true && mixed.warnings.length === 1, JSON.stringify(mixed))
  check('explanation 非字符串给告警', O.validateOpsPayload({ ops: [{ op: 'remove', id: 'x' }], explanation: 3 }).warnings.length === 1)
  check('非对象被拒', O.validateOpsPayload(null).ok === false)
}

group('① 载荷修补 repairOpsPayload')
{
  const r = O.repairOpsPayload({
    ops: [
      { op: 'update', id: 'n1', style: { fill: '#fff' } },
      { op: 'update', id: 'n2' },                       // 无任何可改字段 → 丢
      { op: 'add', parent: 'p1', node: { type: 'text' } },
      { op: 'add', parent: '', node: {} },               // parent 空 → 丢
      { op: 'remove', id: 'n3' },
      { op: 'replaceContent', id: 'n4', content: 'hi' },
      { op: 'replaceContent', id: 'n5' },                // 缺 content → 丢
      { op: 'nope', id: 'n6' },                          // 未知 op → 丢
      null,                                              // 非对象 → 丢
    ],
  })
  check('保留 4 条合法 op', r.ops.length === 4, `实际 ${r.ops.length}`)
  check('丢弃 5 条非法 op 并记账', r.warnings.some((w) => w.includes('5 条')), JSON.stringify(r.warnings))
  check('update 保留 style', r.ops[0].op === 'update' && r.ops[0].style.fill === '#fff')
  check('add 保留 parent/node', r.ops[1].op === 'add' && r.ops[1].parent === 'p1')
  check('replaceContent 保留内容', r.ops[3].op === 'replaceContent' && r.ops[3].content === 'hi')

  const capped = O.repairOpsPayload({ ops: Array.from({ length: 10 }, (_, i) => ({ op: 'remove', id: `n${i}` })) }, 3)
  check('超出上限被截断', capped.ops.length === 3 && capped.warnings.some((w) => w.includes('上限')))
}

/* ============================ ② ops 应用器 ============================ */

group('② ops 应用器 applyOps')
{
  const root = N('r', 'frame', { children: [N('a', 'text', { style: { font: { size: 14, family: 'A' } } }), N('b', 'text')] })

  /* -- update：顶层浅合并 + 嵌套组深合并 -- */
  const u1 = O.applyOps(root, [{ op: 'update', id: 'a', style: { font: { size: 18 } } }])
  const na = O.findNodeInTree(u1.root, 'a')
  check('update 生效', na.style.font.size === 18)
  check('font 嵌套合并保留 family', na.style.font.family === 'A', JSON.stringify(na.style.font))

  const u2 = O.applyOps(root, [{ op: 'update', id: 'a', layout: { gap: 8 } }])
  check('update 只改指定字段', O.findNodeInTree(u2.root, 'a').layout.gap === 8)
  check('未指定的 style 保持不变', O.findNodeInTree(u2.root, 'a').style.font.size === 14)

  const u3 = O.applyOps(root, [{ op: 'update', id: 'a', style: { fill: '#F00' } }])
  check('style 顶层合并保留 font', O.findNodeInTree(u3.root, 'a').style.font.size === 14)

  const u4 = O.applyOps(root, [{ op: 'update', id: 'a', layout: { padding: { t: 10 } } }])
  const padOk = (() => {
    const r2 = O.applyOps(N('r', 'frame', { layout: { padding: { t: 1, r: 2, b: 3, l: 4 } }, children: [N('a', 'text')] }),
      [{ op: 'update', id: 'a', layout: { padding: { t: 10 } } }])
    return O.findNodeInTree(r2.root, 'a').layout.padding
  })()
  check('padding 深合并只改 t', padOk.t === 10)

  const u5 = O.applyOps(root, [{ op: 'update', id: 'missing', style: { fill: '#000' } }])
  check('update 找不到节点被跳过', u5.applied.length === 0 && u5.skipped.length === 1)
  check('跳过原因可读', u5.skipped[0].reason.includes('找不到节点'))

  /* -- 纯函数性：不改动入参 -- */
  const frozen = N('r', 'frame', { children: [N('a', 'text', { style: { fill: '#111' } })] })
  const snapshot = JSON.stringify(frozen)
  O.applyOps(frozen, [{ op: 'update', id: 'a', style: { fill: '#222' } }])
  check('applyOps 不污染入参（纯函数）', JSON.stringify(frozen) === snapshot)

  /* -- replaceContent：写入类型专属字段 -- */
  const btnRoot = N('r', 'frame', { children: [N('btn', 'button', { props: { label: '旧' } })] })
  const rc = O.applyOps(btnRoot, [{ op: 'replaceContent', id: 'btn', content: '新' }])
  const nb = O.findNodeInTree(rc.root, 'btn')
  check('replaceContent 写 label（按钮）', nb.props.label === '新', JSON.stringify(nb.props))
  check('replaceContent 同时写 content', nb.props.content === '新')

  const navRoot = N('r', 'frame', { children: [N('nav', 'navbar', { props: { title: '页' } })] })
  const rc2 = O.applyOps(navRoot, [{ op: 'replaceContent', id: 'nav', content: '新页' }])
  check('replaceContent 写 title（导航栏）', O.findNodeInTree(rc2.root, 'nav').props.title === '新页')

  const txtRoot = N('r', 'frame', { children: [N('t', 'text', { props: { content: 'a' } })] })
  const rc3 = O.applyOps(txtRoot, [{ op: 'replaceContent', id: 't', content: 'b' }])
  check('replaceContent 写 content（文本）', O.findNodeInTree(rc3.root, 't').props.content === 'b')

  /* -- add：index clamp / id 去冲突 -- */
  const addRoot = N('r', 'frame', { children: [N('a', 'text'), N('b', 'text')] })
  const a1 = O.applyOps(addRoot, [{ op: 'add', parent: 'r', index: 1, node: { type: 'badge', props: { label: 'x' } } }])
  const kids = a1.root.children
  check('add 按 index 插入', kids.length === 3 && kids[1].type === 'badge' && kids[1].id !== 'a')
  check('add 补全缺失 id', !!kids[1].id && kids[1].id !== '')
  check('add 走 repairNode 补 type', kids[1].type === 'badge')

  const a2 = O.applyOps(addRoot, [{ op: 'add', parent: 'r', index: 99, node: { type: 'text' } }])
  check('add index 越界 clamp 到末尾', a2.root.children[2].type === 'text')

  const a3 = O.applyOps(addRoot, [{ op: 'add', parent: 'r', index: -5, node: { type: 'text' } }])
  check('add index 负值 clamp 到 0', a3.root.children[0].type === 'text')

  const dupRoot = N('r', 'frame', { children: [N('a', 'text')] })
  const a4 = O.applyOps(dupRoot, [{ op: 'add', parent: 'r', node: { id: 'a', type: 'badge' } }])
  check('add id 冲突时重新分配', a4.root.children[1].id !== 'a')

  /* -- remove：根不可删 / 收集子树 -- */
  const rmRoot = N('r', 'frame', { children: [N('g', 'group', { children: [N('c1', 'text'), N('c2', 'text')] }), N('keep', 'text')] })
  const rm = O.applyOps(rmRoot, [{ op: 'remove', id: 'g' }])
  check('remove 生效', rm.root.children.length === 1 && rm.root.children[0].id === 'keep')
  check('remove 收集子树 id', rm.removedIds.includes('g') && rm.removedIds.includes('c1') && rm.removedIds.includes('c2'))
  const rmRootNode = O.applyOps(rmRoot, [{ op: 'remove', id: 'r' }])
  check('根节点不可删除', rmRootNode.applied.length === 0 && rmRootNode.skipped[0].reason.includes('根节点'))

  /* -- 顺序依赖：先 add 再 update 新节点 -- */
  const seq = O.applyOps(N('r', 'frame', {}), [
    { op: 'add', parent: 'r', node: { id: 'nn', type: 'text', style: { font: { size: 12 } } } },
    { op: 'update', id: 'nn', style: { font: { size: 20 } } },
  ])
  check('add 之后的 update 能命中新节点', O.findNodeInTree(seq.root, 'nn').style.font.size === 20)
  check('touchedIds 去重且含新节点', seq.touchedIds.includes('nn'))
}

/* ============================ ③ 掉库 + flows 级联 ============================ */

group('③ 落到项目 applyOpsToDesign')
{
  const d = makeDesign()
  d.flows = [
    { id: 'f1', from: 'btn_1', fromPage: 'page_a', to: 'page_b', trigger: 'click' },
    { id: 'f2', from: 'txt_h1', fromPage: 'page_a', to: 'page_b', trigger: 'click' },
  ]
  const res = O.applyOpsToDesign(d, 'page_a', [{ op: 'remove', id: 'btn_1' }])
  check('删除节点生效', !O.findNodeInTree(res.design.pages[0].root, 'btn_1'))
  check('引用被删节点的 flow 被级联清理', res.design.flows.length === 1 && res.design.flows[0].id === 'f2')
  check('droppedFlows 计数正确', res.droppedFlows === 1)
  check('原 design 未被改动（纯函数）', d.flows.length === 2)

  const res2 = O.applyOpsToDesign(d, 'nope', [{ op: 'remove', id: 'btn_1' }])
  check('页面不存在时安全返回', res2.applied.length === 0 && res2.droppedFlows === 0)

  // previewOps 不碰 flows
  const pv = O.previewOps(d.pages[0], [{ op: 'remove', id: 'btn_1' }])
  check('previewOps 仅作用单页', !O.findNodeInTree(pv, 'btn_1'))
}

/* ============================ ④ 规则化诊断 ============================ */

group('④ 规则化诊断 diagnosePage')
{
  const d = makeDesign()
  const page = d.pages[0]
  const sg = O.diagnosePage(d, page)
  const dims = new Set(sg.map((s) => s.dimension))

  check('诊断产出非空', sg.length > 0)
  check('覆盖间距维度', dims.has('spacing'))
  check('覆盖一致性维度', dims.has('consistency'))
  check('覆盖可读性维度', dims.has('readability'))
  check('覆盖冗余维度', dims.has('redundancy'))
  check('每条建议有唯一 id', new Set(sg.map((s) => s.id)).size === sg.length)
  check('建议条数不超上限', sg.length <= O.MAX_SUGGESTIONS)

  const spacing = sg.find((s) => s.dimension === 'spacing' && s.op)
  check('间距问题给出可执行 op', !!spacing && spacing.op.op === 'update')
  check('间距吸附到最近档位', (() => {
    const gaps = sg.filter((s) => s.dimension === 'spacing' && s.op?.layout?.gap != null)
    return gaps.some((s) => [4, 8, 16, 24].includes(s.op.layout.gap))
  })())

  const consistency = sg.find((s) => s.dimension === 'consistency')
  check('同类元素样式不统一被发现', !!consistency)
  check('少数派恰为 1 个时给出 op', (() => {
    const c = sg.find((s) => s.dimension === 'consistency' && s.op)
    return !!c
  })())

  const readability = sg.find((s) => s.dimension === 'readability' && s.op)
  check('行高偏紧被识别并给出修复 op', !!readability && readability.op.style?.font?.lineHeight > 0)

  const redundancy = sg.find((s) => s.dimension === 'redundancy' && s.op)
  check('空容器被识别为可删除', !!redundancy && redundancy.op.op === 'remove')

  // opsFromSuggestions 只收集可执行项
  const ops = O.opsFromSuggestions(sg)
  check('opsFromSuggestions 只取带 op 的建议', ops.length === sg.filter((s) => s.op).length)
  check('收集到的 ops 均可被 applyOps 消费', (() => {
    const r = O.applyOps(page.root, ops)
    return r.applied.length + r.skipped.length === ops.length
  })())

  // 无问题页面 → 空建议（或仅 info）
  const clean = {
    schemaVersion: '1.1',
    meta: { id: 'p2', name: 'c', device: 'MOBILE', canvas: { width: 390, height: 844 }, createdAt: '', updatedAt: '', source: 'blank' },
    tokens: { space: { xs: 4, sm: 8, md: 16 } },
    assets: [],
    pages: [{ id: 'pg', name: '干净页', order: 0, pos: { x: 0, y: 0 }, root: N('r', 'frame', { children: [N('t', 'text', { style: { font: { size: 16, lineHeight: 24 } } })] }) }],
    flows: [],
  }
  const sgClean = O.diagnosePage(clean, clean.pages[0])
  check('干净页面无 warn 级问题', sgClean.filter((s) => s.severity === 'warn').length === 0, JSON.stringify(sgClean.map((s) => s.title)))

  // 绑定规范 → 触发 spec 维度（复用 F-ST-01 漂移）
  const specDesign = {
    ...makeDesign(),
    tokens: { color: { primary: '#3B82F6', bg: '#FFFFFF', text: '#111827' } },
    meta: { ...makeDesign().meta, specId: 'spec_x' },
    specs: [{
      id: 'spec_x', name: '测试规范', source: 'derived',
      tokens: { color: { primary: '#3B82F6', bg: '#FFFFFF', text: '#111827' } },
      createdAt: '2024-01-01T00:00:00.000Z',
    }],
  }
  specDesign.pages[0].root.children.push(N('lit', 'text', { style: { textColor: '#111827' } }))
  const sgSpec = O.diagnosePage(specDesign, specDesign.pages[0])
  check('绑定规范后出现 spec 维度诊断', sgSpec.some((s) => s.dimension === 'spec'))
  const specWithOp = sgSpec.find((s) => s.dimension === 'spec' && s.op)
  check('literal-color 可自动改为 Token 引用', !!specWithOp && specWithOp.op.op === 'update')
}

/* ============================ ⑤ 意图保全 ============================ */

group('⑤ 意图保全 checkOpSafety')
{
  const before = N('r', 'frame', { children: [
    N('t', 'text', { props: { content: '重要信息' } }),
    N('b', 'button', { props: { label: '提交' } }),
  ] })

  // 仅改样式 → 安全
  const sameShape = N('r', 'frame', { children: [
    N('t', 'text', { style: { font: { size: 20 } }, props: { content: '重要信息' } }),
    N('b', 'button', { props: { label: '提交' } }),
  ] })
  const s1 = O.checkOpSafety(before, sameShape)
  check('仅改样式判定为安全', s1.safe === true)
  check('信息点全部保留', s1.removedInfoPoints.length === 0)
  check('小改动无需二次确认', s1.needsConfirm === false, JSON.stringify(s1))

  // 丢信息点 → 不安全
  const dropped = N('r', 'frame', { children: [N('b', 'button', { props: { label: '提交' } })] })
  const s2 = O.checkOpSafety(before, dropped)
  check('丢失信息点被识别', s2.removedInfoPoints.includes('重要信息'))
  check('丢信息点判定为不安全', s2.safe === false)
  check('不安全时需二次确认', s2.needsConfirm === true)

  // 语义类型变更 → 不安全
  const retyped = N('r', 'frame', { children: [
    N('t', 'button', { props: { content: '重要信息' } }),
    N('b', 'button', { props: { label: '提交' } }),
  ] })
  const s3 = O.checkOpSafety(before, retyped)
  check('语义类型变更被识别', s3.typeChanges.length === 1 && s3.typeChanges[0].from === 'text' && s3.typeChanges[0].to === 'button')
  check('语义变更判定为不安全', s3.safe === false)

  // 大改（>50% 节点变动）→ 需二次确认
  const big = N('r', 'frame', { children: [N('x1', 'text'), N('x2', 'text'), N('x3', 'text')] })
  const s4 = O.checkOpSafety(N('r', 'frame', { children: [N('y1', 'text')] }), big)
  check('大改比例被计算', s4.changeRatio > 0.5)
  check('大改即使信息点未丢也需确认', s4.needsConfirm === true)

  check('BIG_CHANGE_RATIO 为 0.5', O.BIG_CHANGE_RATIO === 0.5)
}

/* ============================ ⑥ op 描述 ============================ */

group('⑥ op 描述 describeOp')
{
  const root = N('r', 'frame', { children: [{ id: 'btn', type: 'button', props: { label: '确定' } }] })
  const d1 = O.describeOp({ op: 'update', id: 'btn', style: { fill: '#000' } }, root)
  check('update 描述含节点名', d1.label.includes('确定'), d1.label)
  check('update 描述含字段名', d1.label.includes('fill'))
  check('update 类型标签正确', O.opKindLabel(d1.kind) === '修改样式')

  const d2 = O.describeOp({ op: 'add', parent: 'r', index: 0, node: {} }, root)
  check('add 描述含插入位置', d2.label.includes('第 0 位'))
  const d3 = O.describeOp({ op: 'remove', id: 'btn' }, root)
  check('remove 描述含删除', d3.label.includes('删除'))
  const d4 = O.describeOp({ op: 'replaceContent', id: 'btn', content: '这是一个非常非常长的按钮文案需要被截断显示' }, root)
  check('replaceContent 长文案被截断', d4.label.includes('…'), d4.label)

  const d5 = O.describeOp({ op: 'remove', id: 'ghost' })
  check('无 root 时退回 id', d5.label.includes('ghost'))
}

group('⑥ 分类计数 opKindCounts')
{
  const c = O.opKindCounts([
    { op: 'update', id: 'a' }, { op: 'update', id: 'b' }, { op: 'remove', id: 'c' }, { op: 'replaceContent', id: 'd', content: 'x' },
  ])
  check('update 计数', c.update === 2)
  check('remove 计数', c.remove === 1)
  check('replaceContent 计数', c.replaceContent === 1)
  check('add 计数为 0', c.add === 0)
}

/* ============================ ⑦ 端到端 optimizePage ============================ */

group('⑦ 端到端 optimizePage（stub 模型）')
{
  const d = makeDesign()
  const pageId = 'page_a'

  // ① 指令优化：模型返回合法 ops
  O.__reset()
  O.__queue([JSON.stringify({
    ops: [
      { op: 'update', id: 'txt_h1', style: { font: { size: 28, lineHeight: 34 } } },
      { op: 'replaceContent', id: 'btn_1', content: '立即开始' },
    ],
    explanation: '拉开标题层级并强化主按钮文案',
  })])
  const plan = await O.optimizePage({ configId: 'cfg1', design: d, pageId, instruction: '让标题更突出' })
  check('返回 2 条 ops', plan.ops.length === 2, JSON.stringify(plan.ops))
  check('解析出 explanation', plan.explanation.includes('标题层级'), plan.explanation)
  check('ops 可真实应用', (() => {
    const r = O.applyOpsToDesign(d, pageId, plan.ops)
    return O.findNodeInTree(r.design.pages[0].root, 'txt_h1').style.font.size === 28
  })())
  const calls = O.__calls()
  check('调用模型 1 次', calls.length === 1)
  check('使用 jsonMode', calls[0].opts.jsonMode === true)
  check('输出上限不超过硬顶', calls[0].opts.maxTokens <= 8192, String(calls[0].opts.maxTokens))
  check('提示词含用户指令', calls[0].messages.some((m) => m.content.includes('让标题更突出')))
  check('提示词含 Design JSON', calls[0].messages.some((m) => m.content.includes('page_a')))

  // ② 自动优化：无指令 → 用本地诊断合成指令
  O.__reset()
  O.__queue([JSON.stringify({ ops: [{ op: 'update', id: 'txt_body', style: { font: { lineHeight: 21 } } }], explanation: '调整行高' })])
  const autoPlan = await O.optimizePage({ configId: 'cfg1', design: d, pageId, auto: true })
  check('自动优化返回 diagnosis', !!autoPlan.diagnosis && autoPlan.diagnosis.length > 0)
  check('自动优化 ops 可用', autoPlan.ops.length === 1)
  const autoCall = O.__calls()[0]
  check('自动优化提示词含诊断结果', autoCall.messages.some((m) => m.content.includes('诊断结果') || m.content.includes('最小改动')))

  // ③ 无指令且非自动 → 直接报错，不调模型
  O.__reset()
  let threw = ''
  try {
    await O.optimizePage({ configId: 'cfg1', design: d, pageId })
  } catch (e) { threw = e.message }
  check('无指令且非自动时报错', threw.includes('请先输入优化指令'), threw)
  check('未调用模型', O.__calls().length === 0)

  // ④ 页面不存在
  O.__reset()
  let threw2 = ''
  try {
    await O.optimizePage({ configId: 'cfg1', design: d, pageId: 'nope', instruction: 'x' })
  } catch (e) { threw2 = e.message }
  check('页面不存在时报错', threw2.includes('页面不存在'))

  // ⑤ 模型第一次输出残缺 → askJson 修复重试后成功
  O.__reset()
  O.__queue([
    '{ "ops": [ { "op": "update", "id": "txt_body"',  // 截断的 JSON
    JSON.stringify({ ops: [{ op: 'replaceContent', id: 'txt_body', content: '修好了' }], explanation: 'ok' }),
  ])
  const repaired = await O.optimizePage({ configId: 'cfg1', design: d, pageId, instruction: '改文案' })
  check('残缺输出经重试后成功', repaired.ops.length === 1 && repaired.ops[0].op === 'replaceContent')
  check('确实重试了一次', O.__calls().length === 2)

  // ⑥ 模型返回空 ops（校验失败）→ 两次后抛错
  O.__reset()
  O.__queue([JSON.stringify({ ops: [] }), JSON.stringify({ ops: [] })])
  let threw3 = ''
  try {
    await O.optimizePage({ configId: 'cfg1', design: d, pageId, instruction: 'x' })
  } catch (e) { threw3 = e.message }
  check('空 ops 最终抛错', threw3.includes('页面优化'), threw3)

  // ⑦ 部分 op 非法 → 容错保留合法的
  O.__reset()
  O.__queue([JSON.stringify({
    ops: [
      { op: 'update', id: 'txt_h1', style: { font: { size: 30 } } },
      { op: 'garbage' },
      { op: 'remove', id: 'missing_node' },
    ],
    explanation: '部分有效',
  })])
  const partial = await O.optimizePage({ configId: 'cfg1', design: d, pageId, instruction: 'x' })
  check('丢弃非法 op 保留合法', partial.ops.length === 2, `${partial.ops.length}`)
  check('记录丢弃告警', partial.warnings.length > 0)
}

/* ============================ 汇总 ============================ */

console.log(`\n通过 ${pass} · 失败 ${fail}`)
if (fail) {
  console.log('\n失败项：')
  failures.forEach((f) => console.log(`  - ${f}`))
  process.exit(1)
}
