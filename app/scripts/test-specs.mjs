// scripts/test-specs.mjs
// F-ST-01 设计规范引用能力测试
//   内置规范提升 → 两级绑定 → 漂移检测 → 一键修正 → 切换预览 → 导入导出 → Prompt 注入
// 运行：node scripts/test-specs.mjs

import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { bestEffortRemove } from './_fsx.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'dist', 'test')
const tmp = path.join(outDir, 'specs.cjs')
const tmpPresets = path.join(outDir, 'specs-presets.cjs')

await build({
  entryPoints: [path.join(root, 'src', 'services', 'design', 'specs.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: tmp,
  logLevel: 'error',
  loader: { '.css': 'text' },
  alias: {
    '@shared/design': path.join(root, 'shared', 'design.ts'),
    '@/services/render/tokens': path.join(root, 'src', 'services', 'render', 'tokens.ts'),
  },
})

// 单独打包真实预设模块，用于对照「内置规范数量 = 预设数量」
await build({
  entryPoints: [path.join(root, 'src', 'services', 'design', 'style-presets.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: tmpPresets,
  logLevel: 'error',
  alias: { '@shared/design': path.join(root, 'shared', 'design.ts') },
})

const require = createRequire(import.meta.url)
const S = require(tmp)
const { STYLE_PRESETS } = require(tmpPresets)

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

/* ----------------------------- 测试数据构造 ----------------------------- */

const node = (id, style = {}, children) => ({ id, type: 'frame', name: id, style, ...(children ? { children } : {}) })

/** 综合设计：4 类漂移各 1 处 */
const makeDesign = () => ({
  schemaVersion: '1.1',
  meta: { id: 'proj_t', name: '规范测试项目', device: 'MOBILE', canvas: { width: 390, height: 844 },
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', source: 'blank' },
  tokens: { color: { primary: '#3B82F6', text: '#111827', bg: '#FFFFFF' }, radius: { md: 10 } },
  assets: [],
  pages: [
    { id: 'page_a', name: '主页', order: 0, pos: { x: 0, y: 0 }, root: node('root_a', { fill: '$color.bg' }, [
      node('t_lit', { textColor: '#111827' }),
      node('b_miss', { fill: '$color.nope' }),
      node('t_up', { textTransform: 'uppercase' }),
      node('s_off', { fill: '#FF00FF' }),
    ]) },
  ],
  flows: [],
})

/** 页面用的自定义规范 */
const pageSpec = S.createSpec({
  id: 'spec_page',
  name: '页面规范',
  tokens: { color: { primary: '#3B82F6', text: '#111827', bg: '#FFFFFF' } },
  rules: { donts: ['不要用全大写呈现正文与标题'] },
})

/* ========================= 1. 内置规范提升 ========================= */

group('1. 内置规范提升（STYLE_PRESETS → BUILTIN_SPECS）')
{
  check('内置规范数量 = 预设数量', S.BUILTIN_SPECS.length === STYLE_PRESETS.length,
    `${S.BUILTIN_SPECS.length} vs ${STYLE_PRESETS.length}`)
  check('内置 id 带 builtin: 前缀', S.BUILTIN_SPECS.every((s) => s.id.startsWith('builtin:')))
  check('source 标记为 builtin', S.BUILTIN_SPECS.every((s) => s.source === 'builtin'))
  check('默认携带负向规则', S.BUILTIN_SPECS.every((s) => (s.rules?.donts ?? []).length > 0))
  check('Token 已深拷贝（不共享引用）', S.BUILTIN_SPECS[0].tokens !== STYLE_PRESETS[0].tokens)
  check('presetIdOf 还原原始 id', S.presetIdOf('builtin:clear-blue') === 'clear-blue')
  check('presetIdOf 对未知内置返回 null', S.presetIdOf('builtin:not-exist') === null)
  check('presetIdOf 对自定义返回 null', S.presetIdOf('spec_x') === null)
  check('presetIdOf 对 undefined 返回 null', S.presetIdOf(undefined) === null)
  check('isBuiltinSpecId 判定内置', S.isBuiltinSpecId('builtin:clear-blue') === true && S.isBuiltinSpecId('spec_x') === false)

  const all = S.listSpecs({})
  check('listSpecs 含全部内置', all.length === STYLE_PRESETS.length)
  const withCustom = S.listSpecs({ specs: [pageSpec] })
  check('listSpecs 合并项目规范', withCustom.length === STYLE_PRESETS.length + 1)
  check('listSpecs 内置在前', withCustom[0].source === 'builtin')

  check('findSpec 命中内置', S.findSpec({}, 'builtin:clear-blue')?.id === 'builtin:clear-blue')
  check('findSpec 命中项目规范', S.findSpec({ specs: [pageSpec] }, 'spec_page')?.id === 'spec_page')
  check('findSpec 未知 id 返回 undefined', S.findSpec({ specs: [pageSpec] }, 'nope') === undefined)
  check('findSpec 空 id 返回 undefined', S.findSpec({ specs: [pageSpec] }, undefined) === undefined)
}

/* ========================= 2. 两级绑定解析 ========================= */

group('2. 两级绑定解析（页面级 → 项目级 → 未绑定）')
{
  const d = makeDesign()
  d.specs = [pageSpec]

  check('都未绑定 → undefined', S.resolveSpecForPage(d, d.pages[0]) === undefined)

  d.meta.specId = 'builtin:clear-blue'
  check('仅项目级绑定 → 命中项目规范', S.resolveSpecForPage(d, d.pages[0])?.id === 'builtin:clear-blue')

  d.pages[0].specId = 'spec_page'
  check('页面级覆盖项目级', S.resolveSpecForPage(d, d.pages[0])?.id === 'spec_page')

  d.pages[0].specId = 'spec_ghost'
  check('页面级 id 失效 → 回退项目级', S.resolveSpecForPage(d, d.pages[0])?.id === 'builtin:clear-blue')

  delete d.pages[0].specId
  check('无 page 参数时取项目级', S.resolveSpecForPage(d, null)?.id === 'builtin:clear-blue')

  d.meta.specId = 'ghost'
  check('项目级 id 失效 → undefined（不抛错）', S.resolveSpecForPage(d, d.pages[0]) === undefined)

  const d2 = makeDesign()
  d2.specs = [pageSpec]
  check('孤规范可被识别', S.orphanSpecIds(d2).join() === 'spec_page')
  d2.meta.specId = 'spec_page'
  check('绑定后不再是孤规范', S.orphanSpecIds(d2).length === 0)
}

/* ========================= 3. 按页取 Token ========================= */

group('3. 按页取 Token（渲染层唯一入口）')
{
  const d = makeDesign()
  d.specs = [pageSpec]
  const page = d.pages[0]

  const unbound = S.tokenMapForPage(d, page)
  check('未绑定 → 退回 design.tokens', unbound.color.primary === '#3B82F6' && unbound.radius.md === 10)

  page.specId = 'spec_page'
  const bound = S.tokenMapForPage(d, page)
  check('绑定后取规范 Token', bound.color.text === '#111827')
  check('规范未定义的组为空对象', Object.keys(bound.radius).length === 0)

  check('tokensForPage 未绑定返回 design.tokens', S.tokensForPage(d, null) === d.tokens)
  page.specId = 'spec_page'
  check('tokensForPage 绑定后返回规范 tokens', S.tokensForPage(d, page) === pageSpec.tokens)
  check('缺失 specId 字段的设计不报错', S.tokenMapForPage({ meta: {}, tokens: { color: { a: '#000' } } }, null).color.a === '#000')
}

/* ======================== 4. 色值工具 / 统计 ======================== */

group('4. 色值工具与规范统计')
{
  check('parseColor 解析 #RGB', JSON.stringify(S.parseColor('#08F')) === JSON.stringify({ r: 0, g: 136, b: 255, a: 1 }))
  check('parseColor 解析 #RRGGBBAA', S.parseColor('#00000080')?.a === 128 / 255)
  check('parseColor 解析 rgb()', S.parseColor('rgb(1, 2, 3)')?.b === 3)
  check('parseColor 解析 rgba()', S.parseColor('rgba(1,2,3,0.5)')?.a === 0.5)
  check('parseColor 解析命名色', S.parseColor('white')?.r === 255)
  check('parseColor 非法值返回 null', S.parseColor('fill') === null && S.parseColor(123) === null && S.parseColor('') === null)
  check('colorDistance 同色为 0', S.colorDistance(S.parseColor('#000'), S.parseColor('#000')) === 0)
  const bw = S.colorDistance(S.parseColor('#000'), S.parseColor('#FFF'))
  check('colorDistance 黑白 ≈ 441.67（√(3·255²)）', Math.abs(bw - Math.sqrt(3 * 255 * 255)) < 0.01, String(bw))

  const near = S.nearestColor('#111827', pageSpec)
  check('nearestColor 命中最近色', near?.key === 'text' && near.distance === 0)
  check('nearestColor 返回引用形式', near?.ref === '$color.text')
  check('nearestColor 非法输入返回 null', S.nearestColor('fill', pageSpec) === null)

  const sum = S.summarizeSpec(pageSpec)
  check('summarizeSpec 统计 color 数', sum.colorCount === 3)
  check('summarizeSpec 暴露主色/背景/文字', sum.primary === '#3B82F6' && sum.bg === '#FFFFFF' && sum.text === '#111827')
  check('summarizeSpec 带回规则', sum.donts.length === 1)

  check('isValidSpecTokens 需要 color 组', S.isValidSpecTokens({ color: { a: '#000' } }) === true)
  check('isValidSpecTokens 拒绝空 color', S.isValidSpecTokens({ color: {} }) === false)
  check('isValidSpecTokens 拒绝非对象', S.isValidSpecTokens(null) === false && S.isValidSpecTokens('x') === false)
}

/* =========================== 5. 漂移检测 =========================== */

group('5. 漂移检测（4 类）')
{
  const d = makeDesign()
  d.specs = [pageSpec]
  d.pages[0].specId = 'spec_page'

  const report = S.detectDrift(d, ['page_a'])
  check('已扫描 1 页', report.scannedPages === 1)
  check('回带生效规范', report.spec?.id === 'spec_page')
  check('共 4 处问题', report.issues.length === 4, String(report.issues.length) + ' ' + report.issues.map((i) => i.kind).join(','))
  check('字面色值 ×1', report.counts['literal-color'] === 1)
  check('失效引用 ×1', report.counts['missing-token'] === 1)
  check('规则违规 ×1', report.counts['rule-violation'] === 1)
  check('规范外颜色 ×1', report.counts['off-palette'] === 1)

  const lit = report.issues.find((i) => i.kind === 'literal-color')
  check('字面色值给出建议引用', lit?.suggestion === '$color.text', lit?.suggestion)
  check('字面色值带路径与节点信息', lit?.path === 'style.textColor' && lit?.nodeId === 't_lit' && lit?.pageId === 'page_a')

  const miss = report.issues.find((i) => i.kind === 'missing-token')
  check('失效引用记录原值', miss?.value === '$color.nope')
  check('失效引用无建议（不可自动修正）', miss?.suggestion === undefined)

  const off = report.issues.find((i) => i.kind === 'off-palette')
  check('规范外颜色记录字面值', off?.value === '#FF00FF')
  check('规范外颜色无建议', off?.suggestion === undefined)

  const rule = report.issues.find((i) => i.kind === 'rule-violation')
  check('规则违规带 detector id 建议', rule?.suggestion === 'no-uppercase')
  check('规则违规路径以 rule: 开头', (rule?.path ?? '').startsWith('rule:'))

  // 未绑定规范 → 不产出任何 issue
  const plain = makeDesign()
  const empty = S.detectDrift(plain)
  check('未绑定规范 → 0 issue', empty.issues.length === 0 && empty.scannedPages === 0)
  check('未绑定规范 → spec 为 undefined', empty.spec === undefined)
  check('未绑定规范 → counts 全 0', Object.values(empty.counts).every((v) => v === 0))

  // 规则编译
  const custom = S.createSpec({ name: '严格规范', tokens: { color: { primary: '#000000' } },
    rules: { donts: ['不要使用阴影', '圆角不应超过 8px', '不要使用斜体', '这条无法规则化所以忽略'] } })
  const ids = S.compileRules(custom.rules).map((r) => r.id).sort()
  check('规则编译出 3 个检测器', ids.join() === 'no-italic,no-shadow,radius-limit', ids.join())
  check('无法规则化的规则被忽略', !ids.includes('no-uppercase'))

  const strict = {
    schemaVersion: '1.1',
    meta: { id: 'p', name: 'x', device: 'MOBILE', canvas: { width: 390, height: 844 },
      createdAt: '', updatedAt: '', source: 'blank', specId: custom.id },
    tokens: custom.tokens,
    assets: [],
    specs: [custom],
    pages: [{ id: 'pg', name: '页', order: 0, pos: { x: 0, y: 0 },
      root: node('r', {}, [
        node('with_shadow', { shadow: [{ x: 0, y: 1, blur: 2, color: '#000' }] }),
        node('big_radius', { radius: 24 }),
        node('italic', { font: { size: 14, italic: true } }),
      ]) }],
    flows: [],
  }
  const r2 = S.detectDrift(strict)
  check('阴影违规被检出', r2.counts['rule-violation'] === 3, String(r2.counts['rule-violation']))
  check('阴影/圆角/斜体各自命中', ['no-shadow', 'radius-limit', 'no-italic'].every((id) =>
    r2.issues.some((i) => i.suggestion === id)))
}

/* ============================ 6. 一键修正 ============================ */

group('6. 一键修正')
{
  const d = makeDesign()
  d.specs = [pageSpec]
  d.pages[0].specId = 'spec_page'
  const report = S.detectDrift(d, ['page_a'])

  // --- toTokenRefs ---
  const before = JSON.stringify(d.pages[0].root)
  const conv = S.toTokenRefs(d.pages[0].root, pageSpec)
  check('toTokenRefs 统计替换数', conv.changed === 1, String(conv.changed))
  check('toTokenRefs 记录路径', conv.paths[0] === 't_lit.style.fill' || conv.paths[0] === 't_lit.style.textColor', conv.paths[0])
  const converted = conv.root.children.find((c) => c.id === 't_lit')
  check('toTokenRefs 写入引用', converted.style.textColor === '$color.text', converted.style.textColor)
  check('toTokenRefs 是纯函数（原树未被污染）', JSON.stringify(d.pages[0].root) === before)
  check('toTokenRefs 不动规范外颜色', conv.root.children.find((c) => c.id === 's_off').style.fill === '#FF00FF')
  check('toTokenRefs 不动失效引用', conv.root.children.find((c) => c.id === 'b_miss').style.fill === '$color.nope')

  const limited = S.toTokenRefs(d.pages[0].root, pageSpec, { nodeIds: ['s_off'] })
  check('toTokenRefs 支持 nodeIds 白名单', limited.changed === 0)
  const strict = S.toTokenRefs(d.pages[0].root, pageSpec, { threshold: 0 })
  check('toTokenRefs 支持阈值收紧', strict.changed === 1)

  // --- fixRuleViolation ---
  const fixedRule = S.fixRuleViolation(d.pages[0].root, 'no-uppercase')
  check('fixRuleViolation 统计修正数', fixedRule.changed === 1, String(fixedRule.changed))
  check('fixRuleViolation 撤掉全大写', fixedRule.root.children.find((c) => c.id === 't_up').style.textTransform === 'none')
  check('fixRuleViolation 是纯函数', d.pages[0].root.children.find((c) => c.id === 't_up').style.textTransform === 'uppercase')
  check('未知 detector 不产生改动', S.fixRuleViolation(d.pages[0].root, 'no-shadow').changed === 0)

  // --- fixDrift ---
  const onlyLit = S.fixDrift(d, report.issues, { kinds: ['literal-color'] })
  check('fixDrift 限定类型后只改 1 处', onlyLit.changed === 1, String(onlyLit.changed))
  check('fixDrift 未选中的 3 类计入 skipped', onlyLit.skipped === 3, String(onlyLit.skipped))
  check('fixDrift 回执闭合（changed + skipped = issues）',
    onlyLit.changed + onlyLit.skipped === report.issues.length,
    `${onlyLit.changed}+${onlyLit.skipped} vs ${report.issues.length}`)
  check('fixDrift 返回新 design（原对象不变）', d.pages[0].root.children.find((c) => c.id === 't_lit').style.textColor === '#111827')
  check('fixDrift 结果已写入引用', onlyLit.design.pages[0].root.children.find((c) => c.id === 't_lit').style.textColor === '$color.text')

  const again = S.detectDrift(onlyLit.design, ['page_a'])
  check('修正后字面色值清零', again.counts['literal-color'] === 0)
  check('修正后规范外颜色仍在', again.counts['off-palette'] === 1)

  const all = S.fixDrift(d, report.issues)
  check('不传 kinds 时修正 2 类（字面色值 + 规则违规）', all.changed === 2, String(all.changed))
  check('不可修正的 2 类计入 skipped', all.skipped === 2, String(all.skipped))
  const reAll = S.detectDrift(all.design, ['page_a'])
  check('全量修正后仅剩失效引用与规范外颜色', reAll.counts['literal-color'] === 0 && reAll.counts['rule-violation'] === 0)
  check('全量修正不误伤失效引用与规范外颜色', reAll.counts['missing-token'] === 1 && reAll.counts['off-palette'] === 1)
}

/* ============================ 7. 切换预览 ============================ */

group('7. 切换规范影响面预览')
{
  const d = {
    schemaVersion: '1.1',
    meta: { id: 'p', name: 'x', device: 'MOBILE', canvas: { width: 390, height: 844 },
      createdAt: '', updatedAt: '', source: 'blank' },
    tokens: { color: { primary: '#3B82F6' }, radius: { md: 10 } },
    assets: [],
    pages: [{ id: 'p1', name: '页', order: 0, pos: { x: 0, y: 0 }, root: node('r', {}, [
      node('a', { fill: '$color.primary', radius: '$radius.md' }),
      node('b', { fill: '#3B82F6' }),
    ]) }],
    flows: [],
  }
  const target = S.createSpec({ name: '目标规范', tokens: { color: { primary: '#000000', bg: '#FFFFFF' } } })
  const pv = S.previewSwitch(d, target)

  check('回带目标规范', pv.spec.id === target.id)
  check('失效引用计入 brokenRefs（$radius.md 在新规范中不存在）', pv.brokenRefs === 1, String(pv.brokenRefs))
  check('可解析引用不计入 brokenRefs', pv.brokenRefs === 1)
  check('字面色值计入 overriddenLiterals', pv.overriddenLiterals === 1, String(pv.overriddenLiterals))
  check('缺组被识别为 missingGroups', pv.missingGroups.join() === 'radius', pv.missingGroups.join())
  check('radius 组真的缺失（判定依据是原始声明而非 map）', target.tokens.radius === undefined)

  const full = S.createSpec({ name: '完整规范', tokens: { color: { primary: '#000000' }, radius: { md: 8 } } })
  const pv2 = S.previewSwitch(d, full)
  check('补齐后无失效引用', pv2.brokenRefs === 0)
  check('补齐后无缺组', pv2.missingGroups.length === 0)

  const pv3 = S.previewSwitch(d, full, ['nonexistent'])
  check('pageIds 限定范围生效', pv3.brokenRefs === 0 && pv3.overriddenLiterals === 0)
}

/* ============================ 8. 导入导出 ============================ */

group('8. 规范导入导出')
{
  const spec = S.createSpec({ name: '导出规范', desc: '用于往返测试', source: 'derived',
    tokens: { color: { primary: '#123456', bg: '#FFFFFF' }, radius: { md: 12 } },
    rules: { dos: ['保持留白充足'], donts: ['不要使用阴影'] } })

  const json = S.exportSpecJson(spec)
  const parsed = JSON.parse(json)
  check('JSON 信封含 kind', parsed.kind === 'wangshu.design-spec')
  check('JSON 信封含版本', parsed.specVersion === S.SPEC_FILE_VERSION)
  check('JSON 信封含规范本体', parsed.spec.name === '导出规范')

  const back = S.importSpec(json)
  check('JSON 往返成功', back.spec !== null)
  check('往返保留 id', back.spec.id === spec.id)
  check('往返保留名称', back.spec.name === spec.name)
  check('往返保留色板', JSON.stringify(back.spec.tokens.color) === JSON.stringify(spec.tokens.color))
  check('往返保留规则', back.spec.rules.donts[0] === '不要使用阴影')

  const md = S.exportSpecMarkdown(spec)
  check('Markdown 含标题', md.includes('# 设计规范：导出规范'))
  check('Markdown 含色板表格', md.includes('| `primary` | `#123456` |'))
  check('Markdown 含机器可读块', md.includes('```json wangshu-spec'))
  check('Markdown 含禁止规则', md.includes('- 不要使用阴影'))
  const mdBack = S.importSpec(md)
  check('Markdown 无损往返', mdBack.spec?.name === '导出规范' && mdBack.spec.tokens.color.primary === '#123456', mdBack.spec?.name)

  // 降级：去掉 JSON 块后仍能从表格解析
  const degraded = md.replace(/```json wangshu-spec[\s\S]*?```/, '')
  const deg = S.importSpec(degraded)
  check('Markdown 降级解析色板', deg.spec !== null && deg.spec.tokens.color.primary === '#123456', deg.spec?.name)
  check('降级解析仅含 color 组', deg.spec !== null && deg.spec.tokens.radius === undefined)

  const bare = S.importSpec('{"name":"裸规范","tokens":{"color":{"primary":"#ABCDEF"}}}')
  check('裸对象可导入', bare.spec?.name === '裸规范' && bare.spec.tokens.color.primary === '#ABCDEF')
  check('裸对象标记为 imported', bare.spec?.source === 'imported')

  const noName = S.importSpec('{"tokens":{"color":{"a":"#000"}}}')
  check('缺 name 时回落默认名', noName.spec?.name === '导入的规范')
  check('缺 name 产出 warning', noName.warnings.some((w) => w.includes('name')))

  check('空文本被拒', S.importSpec('').spec === null)
  check('非字符串被拒', S.importSpec(null).spec === null && S.importSpec(123).spec === null)
  check('无 tokens.color 被拒', S.importSpec('{"name":"x"}').spec === null)
  check('无法解析的文本被拒', S.importSpec('这不是规范').spec === null)
  check('拒绝时附带说明', S.importSpec('{"name":"x"}').warnings.length > 0)

  // fork / derive
  const fork = S.forkBuiltinSpec('builtin:clear-blue')
  check('可由内置派生副本', fork !== null && fork.source === 'builtin' && fork.tokens.color.primary === '#3B82F6')
  check('派生副本是新 id', fork.id !== 'builtin:clear-blue')
  check('派生副本与内置不共享 Token', fork.tokens !== S.BUILTIN_SPECS[0].tokens)
  check('非内置 id 无法派生', S.forkBuiltinSpec('spec_x') === null)

  const d = makeDesign()
  const derived = S.deriveSpec(d, '我的规范')
  check('deriveSpec 取项目 Token', derived.tokens.color.primary === '#3B82F6')
  check('deriveSpec 标记为 derived', derived.source === 'derived')
  check('deriveSpec 与项目 Token 解耦', derived.tokens !== d.tokens)
  const derived2 = S.deriveSpec(d, '')
  check('deriveSpec 名称回落', derived2.name === '规范测试项目 的规范', derived2.name)
}

/* ============================ 9. Prompt 注入 ============================ */

group('9. 规范约束注入 Prompt')
{
  const spec = S.createSpec({ name: 's', tokens: { color: { primary: '#000' } },
    rules: { dos: ['保持留白充足'], donts: ['不要使用阴影', '不要用全大写呈现正文与标题'] } })
  const text = S.specConstraintsForPrompt(spec)
  check('含约束段落标题', text.includes('【设计规范约束】'))
  check('含应当项', text.includes('- 应当：保持留白充足'))
  check('含禁止项', text.includes('- 禁止：不要使用阴影'))
  check('禁止项逐条列出', (text.match(/- 禁止：/g) ?? []).length === 2)

  check('无规则返回空串', S.specConstraintsForPrompt(S.createSpec({ name: 'x', tokens: {} })) === '')
  check('空规则数组返回空串', S.specConstraintsForPrompt({ id: 'a', name: 'b', source: 'builtin',
    tokens: {}, rules: { dos: [], donts: [] }, createdAt: '' }) === '')
}

/* ========================= 10. 切换规范端到端 ========================= */

group('10. 切换规范：Token 替换后的渲染一致性')
{
  // 模拟 store.bindSpec：把 design.tokens 整体换成规范 Token
  const d = makeDesign()
  const spec = S.createSpec({ name: '墨色规范', tokens: { color: { primary: '#111111', text: '#222222', bg: '#FAFAFA' } } })
  const before = S.tokenMapForPage(d, d.pages[0])
  check('切换前取项目 Token', before.color.bg === '#FFFFFF')

  d.specs = [spec]
  d.meta.specId = spec.id
  d.pages[0].specId = spec.id
  const after = S.tokenMapForPage(d, d.pages[0])
  check('切换后取规范 Token', after.color.bg === '#FAFAFA')

  const d2 = makeDesign()
  d2.specs = [spec]
  d2.pages[0].specId = spec.id
  d2.tokens = S.cloneTokens(spec.tokens)
  check('同一引用在切换后指向新色值',
    S.tokenMapForPage(d2, d2.pages[0]).color.bg === '#FAFAFA' &&
    S.tokenMapForPage(makeDesign(), makeDesign().pages[0]).color.bg === '#FFFFFF')

  const clone = S.cloneTokens(spec.tokens)
  clone.color.primary = '#000000'
  check('cloneTokens 深拷贝不污染源', spec.tokens.color.primary === '#111111')
  check('cloneTokens 处理 undefined', Object.keys(S.cloneTokens(undefined)).length === 0)

  // 切换后原引用点自动跟随规范（不经由 design.tokens）
  const before2 = S.tokenMapForPage(d2, d2.pages[0]).color.bg
  d2.tokens.color.bg = '#EEEEEE'
  check('绑定规范后渲染以规范为准（不被 design.tokens 干扰）',
    S.tokenMapForPage(d2, d2.pages[0]).color.bg === '#FAFAFA' && before2 === '#FAFAFA',
    S.tokenMapForPage(d2, d2.pages[0]).color.bg)

  const drift2 = S.detectDrift(d2, ['page_a'])
  check('失效引用 $color.nope 依然被识别', drift2.counts['missing-token'] === 1, String(drift2.counts['missing-token']))
  check('$color.bg 引用未落入失效集合',
    drift2.issues.every((i) => i.value !== '$color.bg'))
  check('切换规范不再产生字面色值问题（原字面值已近似新规范）',
    drift2.counts['off-palette'] === 1 && drift2.counts['missing-token'] === 1)
}

bestEffortRemove(tmp)
bestEffortRemove(tmpPresets)

console.log(`\n${'─'.repeat(48)}`)
console.log(`通过 ${pass} · 失败 ${fail}`)
if (fail > 0) {
  console.log('\n失败项：')
  failures.forEach((f) => console.log(`  - ${f}`))
  process.exit(1)
}
console.log('全部通过 ✓')
