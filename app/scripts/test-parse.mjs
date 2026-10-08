// scripts/test-parse.mjs
// 五级容错链路测试：抽取 → 宽松解析 → 结构校验 → 语义修补
// 运行：node scripts/test-parse.mjs

import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { bestEffortRemove } from './_fsx.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tmp = path.join(root, 'dist', 'test', 'parse.cjs')

await build({
  entryPoints: [path.join(root, 'src', 'services', 'ai', 'parse.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: tmp,
  logLevel: 'error',
  alias: {
    '@/services/mock/projects': path.join(root, 'scripts', 'stub-projects.js'),
    '@/services/design/style-presets': path.join(root, 'scripts', 'stub-presets.js'),
    '@shared/design': path.join(root, 'shared', 'design.ts'),
  },
})

const require = createRequire(import.meta.url)

/* Schema 版本必须取自唯一事实来源，不能在断言里写死字面量 ——
   否则每次升 SCHEMA_VERSION 都会误报成回归。 */
const designTmp = path.join(root, 'dist', 'test', 'parse-design.cjs')
await build({
  entryPoints: [path.join(root, 'shared', 'design.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: designTmp,
  logLevel: 'error',
})
const { SCHEMA_VERSION } = require(designTmp)
const {
  extractJson,
  lenientParse,
  validatePagePayload,
  repairPagePayload,
  repairNode,
  assembleProject,
} = require(tmp)

let pass = 0
let fail = 0
const failures = []

function check(name, cond, detail = '') {
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

/* ------------------------------ 1. 抽取 ------------------------------ */

group('第一级 · JSON 抽取')
{
  check('裸 JSON', extractJson('{"a":1}') !== null)

  const fenced = '这是结果：\n```json\n{"page":{"id":"p1"}}\n```\n以上。'
  const got = extractJson(fenced)
  check('剥代码围栏', got !== null && got.includes('"page"'), got ?? 'null')

  const noisy = '好的，我来生成。{"page":{"id":"p1","root":{"id":"r"}}} 希望有帮助'
  const got2 = extractJson(noisy)
  check('从废话中抠出 JSON', got2 !== null && got2.startsWith('{') && got2.endsWith('}'))

  check('无 JSON 时返回 null', extractJson('完全没有 JSON 的文本') === null)

  // 字符串内含花括号，不应误判边界
  const tricky = '{"content":"这里有个 { 花括号 } 在字符串里"}'
  const got3 = extractJson(tricky)
  check('字符串内花括号不算边界', got3 === tricky)
}

/* ---------------------------- 2. 宽松解析 ---------------------------- */

group('第二级 · 宽松解析')
{
  check('标准 JSON', lenientParse('{"a":1}') !== null)
  check('尾逗号', lenientParse('{"a":1,}') !== null)
  check('数组尾逗号', lenientParse('{"a":[1,2,]}') !== null)

  const single = lenientParse("{'a':1}")
  check('单引号键', single !== null && single.a === 1, JSON.stringify(single))

  const cnQuote = lenientParse('{"name":"测试"}'.replace(/"/g, (m, i) => (i === 7 || i === 10 ? '“' : '"')))
  check('中文引号容错', cnQuote !== null, JSON.stringify(cnQuote))

  // 截断补救：模型输出被 max_tokens 截断
  const truncated = '{"page":{"id":"p1","root":{"id":"r","type":"frame","children":[{"id":"c1"'
  const fixed = lenientParse(truncated)
  check('截断可补救', fixed !== null, JSON.stringify(fixed))

  check('彻底无效返回 null', lenientParse('这不是 JSON 也不是对象') === null)
}

/* ---------------------------- 3. 结构校验 ---------------------------- */

group('第三级 · 结构校验')
{
  check('合法载荷通过', validatePagePayload({ page: { root: { type: 'frame' } } }).ok === true)
  check('缺 page 被拒', validatePagePayload({}).ok === false)
  check('缺 root 被拒', validatePagePayload({ page: {} }).ok === false)

  const r = validatePagePayload({ page: { root: { type: 'text' } } })
  check('root 非 frame 仅告警', r.ok === true && r.warnings.length > 0)

  const flowsBad = validatePagePayload({ page: { root: { type: 'frame' } }, flows: 'not-array' })
  check('flows 非数组仅告警', flowsBad.ok === true && flowsBad.warnings.some((w) => w.includes('flows')))
}

/* ---------------------------- 4. 语义修补 ---------------------------- */

group('第四级 · 语义修补')
{
  // 缺 id / 类型非法
  const n1 = repairNode({ type: '不存在的类型', children: [] })
  check('非法 type 兜底为 frame', n1.type === 'frame')
  check('缺失 id 自动生成', typeof n1.id === 'string' && n1.id.length > 0)

  // 根容器强制撑满
  const root = repairNode({ type: 'frame', children: [] }, 0)
  check('根容器 width=fill', root.layout?.width === 'fill')
  check('根容器 height=fill', root.layout?.height === 'fill')
  check('根容器 mode=flex', root.layout?.mode === 'flex')

  // 嵌套子树
  const nested = repairNode({
    id: 'root',
    type: 'frame',
    children: [{ id: 'a', type: 'text' }, { id: 'b', type: 'frame', children: [{ id: 'c', type: 'button' }] }],
  })
  check('子树完整保留', nested.children?.length === 2 && nested.children[1].children?.[0].type === 'button')

  // 容器类型自动补 children 数组
  const emptyCard = repairNode({ type: 'card' }, 1)
  check('容器补空 children', Array.isArray(emptyCard.children))

  // 页面载荷修补
  const { page, flows, warnings } = repairPagePayload(
    { page: { id: 'p_x', name: '测试页', root: { type: 'frame', children: [] } }, flows: [{ from: 'a', to: 'p_y' }] },
    'p_fallback',
  )
  check('页面 id 保留', page.id === 'p_x')
  check('跳转被保留', flows.length === 1 && flows[0].to === 'p_y')
  check('跳转补全 fromPage', flows[0].fromPage === 'p_x')
  check('无异常告警', warnings.length === 0, warnings.join(';'))

  // 完全缺失 root
  const fallback = repairPagePayload({ page: { id: 'p1', name: 'x' } }, 'p1')
  check('缺 root 时兜底空白容器', !!fallback.page.root)
  check('缺 root 有告警', fallback.warnings.length > 0)

  // root 类型错误（不是对象）
  const badRoot = repairPagePayload({ page: { root: '这是一个字符串' } }, 'p1')
  check('root 非对象也能修补', !!badRoot.page.root && badRoot.warnings.length > 0)
}

/* ---------------------------- 5. 项目组装 ---------------------------- */

group('第五级 · 项目组装')
{
  const mkPage = (id, name) => ({
    id,
    name,
    order: 0,
    pos: { x: 0, y: 0 },
    background: '$color.bg',
    root: repairNode({ type: 'frame', children: [] }, 0),
  })

  const proj = assembleProject({
    name: '测试项目',
    device: 'MOBILE',
    canvas: { width: 390, height: 844 },
    tokens: { color: { primary: '#3B82F6' } },
    pages: [mkPage('p1', '首页'), mkPage('p2', '详情')],
    flows: [{ id: 'f1', from: 'a', fromPage: 'p1', to: 'p2', trigger: 'click', transition: 'slide-left' }],
    prompt: '原始需求',
  })

  check('schemaVersion 正确', proj.schemaVersion === SCHEMA_VERSION, `${proj.schemaVersion} vs ${SCHEMA_VERSION}`)
  check('名称正确', proj.meta.name === '测试项目')
  check('source 标记为 ai', proj.meta.source === 'ai')
  check('页面数量正确', proj.pages.length === 2)
  check('页面 order 重排', proj.pages[0].order === 0 && proj.pages[1].order === 1)
  check('页面坐标自动错开', proj.pages[1].pos.x > proj.pages[0].pos.x)
  check('Token 被保留', proj.tokens.color?.primary === '#3B82F6')
  check('跳转被保留', proj.flows.length === 1)
  check('prompt 被记录', proj.meta.prompt === '原始需求')

  // 非法设备名兜底
  const bad = assembleProject({
    name: 'x', device: '不存在的设备', canvas: {}, tokens: {},
    pages: [mkPage('p1', 'a')], flows: [], prompt: '',
  })
  check('非法设备兜底为 MOBILE', bad.meta.device === 'MOBILE')
  check('缺失画布尺寸被兜底', bad.meta.canvas.width > 0)
  check('空名称兜底', bad.meta.name.length > 0)
}

/* ------------------------------ 结果 ------------------------------ */

bestEffortRemove(tmp)

console.log(`\n${'─'.repeat(48)}`)
console.log(`通过 ${pass} · 失败 ${fail}`)
if (fail > 0) {
  console.log('\n失败项：')
  failures.forEach((f) => console.log(`  - ${f}`))
  process.exit(1)
}
console.log('全部通过 ✓')
