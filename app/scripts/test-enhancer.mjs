// scripts/test-enhancer.mjs
// 提示词增强器的纯函数测试（不依赖模型，可独立运行）。
// 运行：node scripts/test-enhancer.mjs
// 说明：enhancer.ts 是 TS 文件，这里用 esbuild 先转译为临时 CJS 再执行。

import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { bestEffortRemove } from './_fsx.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tmp = path.join(root, 'dist', 'test', 'enhancer.cjs')

await build({
  entryPoints: [path.join(root, 'src', 'services', 'ai', 'enhancer.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: tmp,
  logLevel: 'error',
  // client.ts 依赖 window.dsa，纯逻辑测试用不到，用空实现替换
  alias: {
    '@/services/ai/client': path.join(root, 'scripts', 'stub-client.js'),
    '@shared/design': path.join(root, 'shared', 'design.ts'),
  },
})

const require = createRequire(import.meta.url)
const { classifyPrompt, enhanceHeuristic, verifyIntent, extractEntities } = require(tmp)

/* ------------------------------ 测试框架 ------------------------------ */

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

function group(title) {
  console.log(`\n${title}`)
}

/* ------------------------------ 分级判定 ------------------------------ */

group('输入分级')
{
  check('「记账」→ L0', classifyPrompt('记账').level === 'L0')
  check('「帮我做个记账的 App」→ L1', classifyPrompt('帮我做个记账的 App').level === 'L1')
  check('短描述建议增强', classifyPrompt('帮我做个记账的 App').suggest === true)

  const full =
    '做一个面向年轻人的健身打卡 App，包含首页、训练记录、个人中心三个页面，采用深色科技风格，主色青蓝，移动端 390×844，需要支持训练数据图表展示。'
  check('完整描述 → L3', classifyPrompt(full).level === 'L3', `实际 ${classifyPrompt(full).level}`)
  check('L3 不建议增强', classifyPrompt(full).suggest === false)
}

/* ---------------------------- 术语规范化 ---------------------------- */

group('术语规范化（R-5）')
{
  const r = enhanceHeuristic('做个好看点的商城首页')
  check('「好看点」被规范化', r.enhanced.includes('视觉层级清晰') || r.notes.some((n) => n.includes('术语')))
  check('保留原始业务实体「商城」', r.enhanced.includes('商城') || r.enhanced.includes('首页'))
}

/* ---------------------------- 设备与风格推断 ---------------------------- */

group('补全与推断（R-1 / R-2）')
{
  const web = enhanceHeuristic('做一个网页后台管理系统')
  check('网页 → 桌面端', web.enhanced.includes('桌面端'))
  check('推断已标注', web.notes.some((n) => n.includes('[推断]')))

  const mobile = enhanceHeuristic('做个外卖点单 App，要有菜单和购物车')
  check('App → 移动端', mobile.enhanced.includes('移动端'))
  check('未指定风格时给出默认', mobile.notes.some((n) => n.includes('视觉风格')))
}

/* ---------------------------- 页面抽取 ---------------------------- */

group('页面结构抽取（R-3）')
{
  const r = enhanceHeuristic('一个应用包含首页、商品详情、购物车三个页面')
  check('识别出首页', r.enhanced.includes('首页'))
  check('识别出详情页', r.enhanced.includes('详情页'))
  check('识别出购物车', r.enhanced.includes('购物车'))
  check('输出含 8 区块模板', (r.enhanced.match(/^## \d\./gm) ?? []).length === 8)
}

/* ---------------------------- 意图保全（R-13 红线） ---------------------------- */

group('意图保全校验（R-13）')
{
  const raw = '做一个电商 App，要有优惠券、积分和发票功能'
  const entities = extractEntities(raw)
  check('抽取出「优惠券」', entities.some((e) => e.includes('优惠券')), entities.join(','))
  check('抽取出「积分」', entities.some((e) => e.includes('积分')))

  const good = verifyIntent(raw, '这是一个电商应用，包含优惠券、积分与发票管理能力')
  check('实体齐全 → 通过', good.pass === true, JSON.stringify(good))

  const bad = verifyIntent(raw, '本产品是一个电商应用，包含商品浏览与下单能力')
  check('实体缺失 → 不通过', bad.pass === false, JSON.stringify(bad))
  check('列出缺失实体', bad.missing.some((m) => m.includes('优惠券')), bad.missing.join(','))

  const empty = verifyIntent('', '任意内容')
  check('空输入 → 直接通过', empty.pass === true && empty.checked === 0)
}

/* ---------------------------- 幂等性 ---------------------------- */

group('幂等性')
{
  const once = enhanceHeuristic('做个记账 App，包含首页和报表')
  const twice = enhanceHeuristic(once.enhanced)
  check('二次增强长度增幅 < 60%', twice.enhanced.length < once.enhanced.length * 1.6,
    `${once.enhanced.length} → ${twice.enhanced.length}`)
  check('二次增强仍是 8 区块', (twice.enhanced.match(/^## \d\./gm) ?? []).length === 8)
}

/* ---------------------------- 降级行为 ---------------------------- */

group('降级行为')
{
  const r = enhanceHeuristic('')
  check('空输入不抛异常', typeof r.enhanced === 'string' && r.enhanced.length > 0)

  const tiny = enhanceHeuristic('记账')
  check('极短输入仍产出完整模板', (tiny.enhanced.match(/^## \d\./gm) ?? []).length === 8)
  check('极短输入 level 为 L0', tiny.level === 'L0')
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
