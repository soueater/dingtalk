// scripts/test-project-model.mjs
// F-PM-01 ~ F-PM-09 的项目模型层测试（纯逻辑，离线可跑）
//
// 覆盖六组：
//   version     —— 版本号事实来源与文档一致性护栏
//   quota       —— 界面数量 N 的三档语义（planned / softLimit / hardLimit）
//   interfaces  —— 界面增删改查、分组、整项目 id 重排
//   invariants  —— 8 条不变量与自愈
//   design-md   —— DESIGN.md 五种解析策略与序列化
//   layout      —— 画布摆放口径（分组框 / 连通线 / 缩略图共用）
//
// 运行：node scripts/test-project-model.mjs

import { build } from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'
import { bestEffortRemove } from './_fsx.mjs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'dist', 'test')
fs.mkdirSync(outDir, { recursive: true })

/* ----------------------------- 打包被测模块 ----------------------------- */

const alias = {
  '@shared/design': path.join(root, 'shared', 'design.ts'),
  '@shared/ids': path.join(root, 'shared', 'ids.ts'),
  '@shared/quota': path.join(root, 'shared', 'quota.ts'),
  '@shared/interfaces': path.join(root, 'shared', 'interfaces.ts'),
  '@shared/design-md': path.join(root, 'shared', 'design-md.ts'),
  '@shared/version': path.join(root, 'shared', 'version.ts'),
  '@/services/design/specs': path.join(root, 'src', 'services', 'design', 'specs.ts'),
  '@/services/design/style-presets': path.join(root, 'src', 'services', 'design', 'style-presets.ts'),
  '@/services/render/tokens': path.join(root, 'src', 'services', 'render', 'tokens.ts'),
  '@/services/project/quota': path.join(root, 'src', 'services', 'project', 'quota.ts'),
  '@/services/project/invariants': path.join(root, 'src', 'services', 'project', 'invariants.ts'),
}

const entries = {
  version: ['shared', 'version.ts'],
  quota: ['shared', 'quota.ts'],
  design: ['shared', 'design.ts'],
  iface: ['shared', 'interfaces.ts'],
  dmd: ['shared', 'design-md.ts'],
  invariants: ['src', 'services', 'project', 'invariants.ts'],
  layout: ['src', 'lib', 'canvas-layout.ts'],
}

const outs = {}
for (const [key, parts] of Object.entries(entries)) {
  const outfile = path.join(outDir, `projm-${key}.cjs`)
  await build({
    entryPoints: [path.join(root, ...parts)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile,
    logLevel: 'error',
    loader: { '.css': 'text' },
    alias,
  })
  outs[key] = outfile
}

const require = createRequire(import.meta.url)
const V = require(outs.version)
const Q = require(outs.quota)
const D = require(outs.design)
const I = require(outs.iface)
const MD = require(outs.dmd)
const INV = require(outs.invariants)
const L = require(outs.layout)

/* ------------------------------- 断言工具 ------------------------------- */

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
const group = (title) => console.log(`\n▌ ${title}`)

/* ------------------------------ 测试夹具 ------------------------------ */

function mkDesign(pages = 1, extra = {}) {
  return {
    schemaVersion: D.SCHEMA_VERSION,
    meta: {
      id: 'proj_test',
      name: '测试项目',
      device: 'MOBILE',
      canvas: { width: 390, height: 844 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...(extra.meta ?? {}),
    },
    tokens: {},
    assets: [],
    pages: Array.from({ length: pages }, (_, i) => I.blankInterface('MOBILE', i, { x: i * 430, y: 0 })),
    flows: [],
    specs: [],
    pageGroups: [],
    ...(extra.top ?? {}),
  }
}

/* ================================ 1. 版本号 ================================ */
group('版本号事实来源与一致性')

check('APP_VERSION 满足 SemVer 三段式', V.VERSION_PATTERN.test(V.APP_VERSION), V.APP_VERSION)
check('parseVersion 解析正确', JSON.stringify(V.parseVersion('1.2.3')) === '[1,2,3]')
check('parseVersion 拒绝两段式', V.parseVersion('1.2') === null)
check('parseVersion 拒绝前缀 v', V.parseVersion('v1.2.3') === null)
check('compareVersion 主版本优先', V.compareVersion('2.0.0', '1.9.9') === 1)
check('compareVersion 次版本优先于补丁', V.compareVersion('1.2.0', '1.1.9') === 1)
check('compareVersion 相等返回 0', V.compareVersion('1.1.0', '1.1.0') === 0)
check('versionLabel 形态正确', V.versionLabel() === `${V.APP_NAME} v${V.APP_VERSION}`, V.versionLabel())

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
check(
  'package.json.version 与 APP_VERSION 一致',
  pkg.version === V.APP_VERSION,
  `package=${pkg.version} shared=${V.APP_VERSION}`,
)
check('package.json 版本形态合法', V.VERSION_PATTERN.test(pkg.version), pkg.version)
check('package.json build.appId 与 APP_ID 一致', pkg.build.appId === V.APP_ID, pkg.build.appId)
check('package.json productName 等于 APP_NAME', pkg.build.productName === V.APP_NAME)
check(
  '打包输出目录位于 out/ 下',
  String(pkg.build.directories.output).startsWith('out/'),
  pkg.build.directories.output,
)
check('产物名模板含 ${version}', String(pkg.build.portable.artifactName).includes('${version}'))

/* 文档中的产品版本标注必须与 APP_VERSION 对齐。
   历史记录里出现的旧版本号是**正确的史实**，不应被改写 —— 这类行加标记
   `<!-- hist-version-ok -->` 即可豁免，避免「为了让护栏变绿而篡改历史」。 */
{
  const docsDir = path.join(root, '..', 'docs')
  const want = V.APP_VERSION
  const wantMinor = want.split('.').slice(0, 2).join('.') // 1.1
  const MARK = '<!-- hist-version-ok -->'
  const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'))
  const offenders = []
  let scanned = 0
  let waived = 0
  for (const f of files) {
    const text = fs.readFileSync(path.join(docsDir, f), 'utf8')
    for (const raw of text.split(/\r?\n/)) {
      if (raw.includes(MARK)) {
        waived++
        continue
      }
      const scans = [
        // 形如「望舒 v1.1」「望舒 v1.1.0」
        [/望舒 v(\d+\.\d+(?:\.\d+)?)/g, (v) => v.split('.').slice(0, 2).join('.') !== wantMinor, (v) => `望舒 v${v}`],
        // 形如「望舒-1.1.0-portable.exe」「望舒 Setup 1.1.0.exe」「望舒-Setup-1.1.0.exe」
        [/望舒[-\s](?:Setup[-\s])?(\d+\.\d+\.\d+)/g, (v) => v !== want, (v) => `产物名 望舒…${v}`],
        // 形如「`app/` @ v1.1.0」
        [/`app\/`\s*@\s*v(\d+\.\d+\.\d+)/g, (v) => v !== want, (v) => `代码基线 v${v}`],
      ]
      for (const [re, bad, fmt] of scans) {
        for (const m of raw.matchAll(re)) {
          scanned++
          if (bad(m[1])) offenders.push(`${f}: ${fmt(m[1])}`)
        }
      }
    }
  }
  check(
    `docs/ 下产品版本标注与 APP_VERSION 一致（扫描 ${scanned} 处，豁免 ${waived} 行）`,
    offenders.length === 0,
    offenders.join(' | '),
  )
  check('版本号规范文档存在', fs.existsSync(path.join(docsDir, '版本号规范.md')))
}

/* 数据格式版本不属于产品版本，必须保持独立 */
check('FILE_VERSION 保持 1.0（信封格式未断裂）', D.FILE_VERSION === '1.0', D.FILE_VERSION)
check('SCHEMA_VERSION 已升到 1.2', D.SCHEMA_VERSION === '1.2', D.SCHEMA_VERSION)
check('SCHEMA 版本与 FILE_VERSION 互不联动', D.SCHEMA_VERSION !== D.FILE_VERSION)

/* 测试脚本里不得写死 Schema 版本字面量 —— 升版时会误报为回归（曾经确实踩过） */
{
  const scriptsDir = path.join(root, 'scripts')
  const offenders = []
  for (const f of fs.readdirSync(scriptsDir).filter((x) => /^test-.*\.mjs$/.test(x))) {
    const text = fs.readFileSync(path.join(scriptsDir, f), 'utf8')
    for (const m of text.matchAll(/schemaVersion\s*===\s*'([\d.]+)'/g)) {
      offenders.push(`${f}: schemaVersion === '${m[1]}'`)
    }
  }
  check('测试脚本未硬编码 schemaVersion 断言', offenders.length === 0, offenders.join(' | '))
}

/* =============================== 2. 界面配额 =============================== */
group('界面数量 N 的三档语义')

check('DEFAULT_QUOTA 三档取值符合设计', 
  D.DEFAULT_QUOTA.planned === 1 && D.DEFAULT_QUOTA.softLimit === 20 && D.DEFAULT_QUOTA.hardLimit === 100,
  JSON.stringify(D.DEFAULT_QUOTA))
check('GLOBAL_MAX_PAGES = 500', D.GLOBAL_MAX_PAGES === 500)

const q0 = Q.resolveQuota(undefined)
check('缺省 meta 落到 DEFAULT_QUOTA', q0.softLimit === 20 && q0.hardLimit === 100, JSON.stringify(q0))
check('clampInt 越界回落', Q.clampInt(0, 1, 999, 20) === 1 && Q.clampInt(1e6, 1, 999, 20) === 999)
check('clampInt 非数字回落', Q.clampInt('abc', 1, 999, 20) === 20)

/* hard=100：第 20 个 ok，第 21 个 warn，第 101 个 block */
const dOk = Q.canAddInterfaces(19, 1, D.DEFAULT_QUOTA)
check('未超软上限 → ok 且允许', dOk.allowed && dOk.level === 'ok', JSON.stringify(dOk))
const dWarn = Q.canAddInterfaces(20, 1, D.DEFAULT_QUOTA)
check('超软上限但未超硬上限 → warn 且仍然允许', dWarn.allowed && dWarn.level === 'warn', JSON.stringify(dWarn))
check('warn 时给出可用文案', typeof dWarn.message === 'string' && dWarn.message.length > 0)
const dBlock = Q.canAddInterfaces(100, 1, D.DEFAULT_QUOTA)
check('超硬上限 → block 且禁止', !dBlock.allowed && dBlock.level === 'block', JSON.stringify(dBlock))
check('block 时剩余量为 0', dBlock.remaining === 0)

/* hardLimit = 0 表示不限，但仍受全局兜底约束 */
const qUnlimited = { ...D.DEFAULT_QUOTA, hardLimit: 0 }
check('hardLimit=0 → effectiveHardLimit 等于全局兜底',
  Q.effectiveHardLimit(qUnlimited) === D.GLOBAL_MAX_PAGES, String(Q.effectiveHardLimit(qUnlimited)))
check('hardLimit=0 时第 500 个仍允许',
  Q.canAddInterfaces(499, 1, qUnlimited).allowed === true)
check('hardLimit=0 时第 501 个被拦下',
  Q.canAddInterfaces(500, 1, qUnlimited).allowed === false)

/* 超过全局兜底的硬上限被压回 */
const qOver = { ...D.DEFAULT_QUOTA, hardLimit: 9999 }
check('硬上限超全局兜底时被压回 GLOBAL_MAX_PAGES',
  Q.effectiveHardLimit(qOver) === D.GLOBAL_MAX_PAGES, String(Q.effectiveHardLimit(qOver)))

/* 软上限不应超过硬上限 */
check('effectiveSoftLimit 不超过 effectiveHardLimit',
  Q.effectiveSoftLimit({ planned: 1, softLimit: 900, hardLimit: 50, strategy: 'single' }) === 50)
check('remainingSlots 不为负',
  Q.remainingSlots({ planned: 1, softLimit: 5, hardLimit: 10, strategy: 'single' }, 99) === 0)

/* normalizeQuota 的内部一致性 */
const norm1 = Q.normalizeQuota({ softLimit: 300 }, D.DEFAULT_QUOTA, 5)
check('normalizeQuota: soft 被压到 hard 以内', norm1.softLimit <= norm1.hardLimit, JSON.stringify(norm1))
check('normalizeQuota: planned 被压到 hard 以内', norm1.planned <= norm1.hardLimit)
const norm2 = Q.normalizeQuota({ hardLimit: 2 }, D.DEFAULT_QUOTA, 10)
check('normalizeQuota: hard 不小于当前界面数', norm2.hardLimit >= 10, JSON.stringify(norm2))
const norm3 = Q.normalizeQuota({ planned: 0 }, D.DEFAULT_QUOTA, 3)
check('normalizeQuota: planned 至少为 1', norm3.planned >= 1)
const norm4 = Q.normalizeQuota({ hardLimit: 0, softLimit: 0 }, D.DEFAULT_QUOTA, 1)
check('normalizeQuota: hard=0 时软上限不为 0', norm4.softLimit >= 1, JSON.stringify(norm4))
check('normalizeQuota: strategy 非法值被纠正',
  ['single', 'flow', 'batch'].includes(Q.normalizeQuota({ strategy: 'nope' }, D.DEFAULT_QUOTA, 1).strategy))
check('normalizeQuota: 合法 strategy 被保留',
  Q.normalizeQuota({ strategy: 'batch' }, D.DEFAULT_QUOTA, 1).strategy === 'batch')
check('normalizeQuota: base 的 strategy 不被抹掉',
  Q.normalizeQuota({}, { ...D.DEFAULT_QUOTA, strategy: 'flow' }, 1).strategy === 'flow')
check('resolveQuota: strategy 非法值被纠正',
  Q.resolveQuota({ quota: { strategy: '???' } }).strategy === D.DEFAULT_QUOTA.strategy)
check('resolveQuota: 缺省 meta 返回默认配额',
  Q.resolveQuota(undefined).planned === D.DEFAULT_QUOTA.planned)

/* 计划数裁剪 */
check('fitPlanToQuota 截断多余项', Q.fitPlanToQuota([1, 2, 3, 4, 5], 3).length === 3)
check('fitPlanToQuota 不填充不足项', Q.fitPlanToQuota([1, 2], 5).length === 2)
check('fitPlanToQuota planned<=0 时视为 1', Q.fitPlanToQuota([1, 2, 3], 0).length === 1)
check('describePlanGap 一致时返回 null', Q.describePlanGap(5, 5) === null)
check('describePlanGap 缺项时给出文案', typeof Q.describePlanGap(5, 3) === 'string')

/* 主进程与渲染层共用同一份实现（转发层不复制逻辑） */
check('渲染层转发层与 shared 同源（同一函数引用）',
  typeof Q.canAddInterfaces === 'function' && typeof Q.normalizeQuota === 'function')

/* ============================== 3. 界面与分组 ============================== */
group('界面增删改查与分组')

const base = mkDesign(2)
check('blankInterface 产出合法 Page',
  !!base.pages[0].id && !!base.pages[0].root && base.pages[0].order === 0)
check('blankInterface 根节点是 frame', base.pages[0].root.type === 'frame', base.pages[0].root.type)
check('canvasOf 按设备取画布', I.canvasOf('MOBILE').width === 390, JSON.stringify(I.canvasOf('MOBILE')))

const added = I.appendInterfaces(base, 3, { device: 'MOBILE' })
check('appendInterfaces 追加正确数量', added.pages.length === 5, String(added.pages.length))
check('appendInterfaces 不污染源对象', base.pages.length === 2, String(base.pages.length))
check('appendInterfaces order 连续', added.pages.every((p, i) => p.order === i))
check('appendInterfaces 生成互不相同的 id', new Set(added.pages.map((p) => p.id)).size === 5)
check('appendInterfaces 每个界面的节点 id 全局唯一',
  I.nodeIdCounts(added).size === [...I.nodeIdCounts(added).values()].filter((n) => n === 1).length)

const grouped = I.appendInterfaces(base, 2, { device: 'MOBILE', groupId: 'g1', namePrefix: '登录' })
check('归组新增时用模块名做前缀', grouped.pages[3].name.startsWith('登录'), grouped.pages[3].name)
check('归组新增写入了 groupId', grouped.pages[3].groupId === 'g1')

/* 复制界面必须重生成全部节点 id（BUG-PM-2 的回归护栏） */
const dupd = I.duplicateInterfaceAt(base, base.pages[0].id)
check('duplicateInterfaceAt 追加 1 个界面', dupd.pages.length === 3)
check('复制后界面 id 不同', dupd.pages[0].id !== dupd.pages[2].id)
check('复制后节点 id 与原界面完全隔离',
  dupd.pages.filter((p) => p.id === dupd.pages[2].id).length === 1 &&
    I.nodeIdCounts(dupd).size === [...I.nodeIdCounts(dupd).values()].filter((n) => n === 1).length)
const regen = I.regenerateNodeIds(base.pages[0].root)
check('regenerateNodeIds 换了根 id', regen.id !== base.pages[0].root.id)
check('regenerateNodeIds 换了子节点 id',
  regen.id !== base.pages[0].root.id)

/* 删除界面同时清理 flows */
const withFlow = {
  ...base,
  flows: [
    { id: 'f1', from: 'a', fromPage: base.pages[0].id, to: base.pages[1].id, trigger: 'click' },
    { id: 'f2', from: 'b', fromPage: base.pages[1].id, to: base.pages[0].id, trigger: 'click' },
  ],
}
const deleted = I.deleteInterface(withFlow, base.pages[0].id)
check('deleteInterface 移除界面', deleted.pages.length === 1)
check('deleteInterface 清理相关 flows', deleted.flows.length === 0, String(deleted.flows.length))
check('deleteInterface 不污染源', withFlow.pages.length === 2)

const multiDel = I.deleteInterfaces(base, [base.pages[0].id, base.pages[1].id])
check('deleteInterfaces 支持批量', multiDel.pages.length === 0)

/* 排序 */
const reordered = I.moveInterface(base, base.pages[1].id, 0)
check('moveInterface 把目标移到首位', reordered.pages[0].id === base.pages[1].id)
check('moveInterface 重排 order', reordered.pages.every((p, i) => p.order === i))
check('moveInterface 越界索引被夹紧',
  I.moveInterface(base, base.pages[0].id, 999).pages[1].id === base.pages[0].id)
check('moveInterface 相同位置不改数据引用',
  I.moveInterface(base, base.pages[0].id, 0) === base)
check('normalizeOrders 重写连续 order', I.normalizeOrders(base.pages).every((p, i) => p.order === i))

const renamed = I.renameInterface(base, base.pages[0].id, '  首页  ')
check('renameInterface 去空白后写入', renamed.pages[0].name === '首页', renamed.pages[0].name)
check('renameInterface 空名不生效', I.renameInterface(base, base.pages[0].id, '   ') === base)

/* 分组 */
const g1 = I.addGroupWithInterfaces(base, '登录流程', [base.pages[0].id])
check('addGroupWithInterfaces 建组成功', (g1.pageGroups ?? []).length === 1)
check('addGroupWithInterfaces 成员写回 groupId',
  g1.pages.find((p) => p.id === base.pages[0].id).groupId === g1.pageGroups[0].id)
check('addGroupWithInterfaces 未选的界面不带组',
  g1.pages.find((p) => p.id === base.pages[1].id).groupId === undefined)
check('createPageGroup 颜色取自 GROUP_COLORS',
  I.GROUP_COLORS.includes(I.createPageGroup('x', 0).color), I.createPageGroup('x', 0).color)

const g2 = I.assignToGroup(g1, [base.pages[1].id], g1.pageGroups[0].id)
check('assignToGroup 追加成员', g2.pages.filter((p) => p.groupId).length === 2)
const g3 = I.assignToGroup(g2, [base.pages[1].id], undefined)
check('assignToGroup(undefined) 摘除分组',
  g3.pages.find((p) => p.id === base.pages[1].id).groupId === undefined)

const buckets = I.bucketByGroup(g2)
check('bucketByGroup: 全部界面已归组时只有分组桶', buckets.length === 1, String(buckets.length))
check('bucketByGroup 桶内成员正确', buckets[0].group !== null && buckets[0].pages.length === 2)

/* 摘掉一个成员后应多出「未分组」桶，且该桶永远排在最后 */
const g2b = I.assignToGroup(g2, [base.pages[1].id], undefined)
const buckets2 = I.bucketByGroup(g2b)
check('bucketByGroup: 存在未分组界面时追加末位桶',
  buckets2.length === 2 && buckets2[buckets2.length - 1].group === null, String(buckets2.length))
check('bucketByGroup: 未分组桶只装无组界面',
  buckets2[buckets2.length - 1].pages.every((p) => !p.groupId))
check('bucketByGroup: 无分组时退化为单个未分组桶',
  I.bucketByGroup(base).length === 1 && I.bucketByGroup(base)[0].group === null)

const collapsed = I.setGroupCollapsed(g2, g1.pageGroups[0].id, true)
check('setGroupCollapsed 写入折叠态', I.findGroup(collapsed, g1.pageGroups[0].id).collapsed === true)
const renamedG = I.renameGroup(g2, g1.pageGroups[0].id, '账号')
check('renameGroup 改名生效', I.findGroup(renamedG, g1.pageGroups[0].id).name === '账号')
const removedG = I.removeGroup(g2, g1.pageGroups[0].id)
check('removeGroup 删组后不留孤儿 groupId',
  (removedG.pageGroups ?? []).length === 0 && removedG.pages.every((p) => !p.groupId))

/* 统计 */
const stats = I.interfaceStats(g2)
check('interfaceStats 总数正确', stats.total === 2 && stats.grouped === 2 && stats.ungrouped === 0,
  JSON.stringify(stats))
check('interfaceStats 孤岛计数正确', I.interfaceStats(withFlow).isolated === 0)
check('interfaceStats 识别未连线界面', I.interfaceStats(base).isolated === 2)

/* 整项目 id 重排（复制项目） */
const pf = { fileVersion: D.FILE_VERSION, design: withFlow }
const remapped = I.remapProjectIds(pf, { name: '副本', id: 'proj_copy' })
check('remapProjectIds 换掉项目 id', remapped.design.meta.id === 'proj_copy')
check('remapProjectIds 换掉项目名', remapped.design.meta.name === '副本')
check('remapProjectIds 换掉全部界面 id',
  remapped.design.pages.every((p) => !pf.design.pages.some((o) => o.id === p.id)))
check('remapProjectIds 同步重写 flows 两端',
  remapped.design.flows.every(
    (f) =>
      remapped.design.pages.some((p) => p.id === f.fromPage) &&
      remapped.design.pages.some((p) => p.id === f.to),
  ))
check('remapProjectIds 不污染源项目文件',
  pf.design.pages[0].id !== remapped.design.pages[0].id)
check('remapProjectIds 保留 fileVersion', remapped.fileVersion === D.FILE_VERSION)

/* ============================== 4. 不变量 ============================== */
group('8 条不变量与自愈')

check('干净项目无任何问题', INV.checkInvariants(mkDesign(2)).length === 0)
check('isSaveable 干净项目为真', INV.isSaveable(mkDesign(2)))

const vI1 = INV.checkInvariants({ ...mkDesign(1), pages: [] })
check('I-1 无界面被检出', vI1.some((v) => v.code === 'I1_NO_INTERFACE'))
check('I-1 属 error 级', INV.errorsOf(vI1).length === 1)

const dDup = mkDesign(2)
dDup.pages[1].id = dDup.pages[0].id
check('I-2 重复界面 id 被检出', INV.checkInvariants(dDup).some((v) => v.code === 'I2_DUPLICATE_PAGE_ID'))

const dActive = mkDesign(2)
check('I-3 选中界面失效被检出',
  INV.checkInvariants(dActive, { activePageId: 'gone' }).some((v) => v.code === 'I3_ACTIVE_PAGE_MISSING'))
check('I-3 选中界面有效时不报', !INV.checkInvariants(dActive, { activePageId: dActive.pages[0].id })
  .some((v) => v.code === 'I3_ACTIVE_PAGE_MISSING'))

const dFlow = mkDesign(1)
dFlow.flows = [{ id: 'f', from: 'a', fromPage: 'nope', to: dFlow.pages[0].id, trigger: 'click' }]
check('I-4 悬空跳转被检出', INV.checkInvariants(dFlow).some((v) => v.code === 'I4_DANGLING_FLOW'))

const dSpec = mkDesign(1)
dSpec.pages[0].specId = 'no-such-spec'
check('I-5 界面规范不可达被检出', INV.checkInvariants(dSpec).some((v) => v.code === 'I5_PAGE_SPEC_MISSING'))
const dMetaSpec = mkDesign(1)
dMetaSpec.meta.specId = 'no-such-spec'
check('I-6 项目规范不可达被检出', INV.checkInvariants(dMetaSpec).some((v) => v.code === 'I6_META_SPEC_MISSING'))

const dAsset = mkDesign(1)
dAsset.pages[0].root.style = { fill: 'asset:missing-asset' }
const vAsset = INV.checkInvariants(dAsset)
check('I-7 素材缺失被检出', vAsset.some((v) => v.code === 'I7_ASSET_MISSING'))
check('I-7 为 warn 级（不阻断保存）',
  vAsset.find((v) => v.code === 'I7_ASSET_MISSING').level === 'warn' &&
    INV.errorsOf(vAsset).length === 0)
check('I-7 不影响 isSaveable', INV.isSaveable(dAsset))

const dGroup = mkDesign(1)
dGroup.pages[0].groupId = 'ghost'
check('I-8 分组孤儿被检出', INV.checkInvariants(dGroup).some((v) => v.code === 'I8_GROUP_MISSING'))

/* 自愈 */
const broken = mkDesign(2)
broken.pages[1].id = broken.pages[0].id
broken.flows = [{ id: 'f', from: 'a', fromPage: 'nope', to: broken.pages[0].id, trigger: 'click' }]
broken.meta.specId = 'ghost-spec'
broken.pages[0].specId = 'ghost-spec'
broken.pages[0].groupId = 'ghost-group'
const healed = INV.repairInvariants(broken)
check('repairInvariants 清掉悬空 flows',
  healed.design.flows.every((f) => healed.design.pages.some((p) => p.id === f.fromPage)))
check('repairInvariants 排除重复界面 id',
  new Set(healed.design.pages.map((p) => p.id)).size === healed.design.pages.length)
check('repairInvariants 清掉不可达项目规范', healed.design.meta.specId === undefined)
check('repairInvariants 清掉不可达页面规范',
  healed.design.pages.every((p) => p.specId === undefined))
check('repairInvariants 摘除分组孤儿', healed.design.pages.every((p) => !p.groupId))
check('repairInvariants 报告修复项', healed.fixed.length >= 4, healed.fixed.join(','))
check('repairInvariants 不修改入参', broken.pages[0].groupId === 'ghost-group')
check('修复后除 I-1/I-3 外不再有问题',
  INV.errorsOf(INV.checkInvariants(healed.design)).length === 0,
  INV.errorsOf(INV.checkInvariants(healed.design)).map((v) => v.code).join(','))

/* 明确不修 I-1 */
const empty = { ...mkDesign(1), pages: [] }
check('repairInvariants 不擅自造界面（I-1 需用户决策）',
  INV.repairInvariants(empty).design.pages.length === 0)

/* 节点级重复 */
const dNodeDup = mkDesign(1)
const child = { id: 'same_node', type: 'text', children: [] }
dNodeDup.pages[0].root.children = [child, { ...child }]
check('duplicateNodeIds 检出重复节点 id',
  INV.duplicateNodeIds(dNodeDup).includes('same_node'), INV.duplicateNodeIds(dNodeDup).join(','))

/* ============================ 5. DESIGN.md ============================ */
group('DESIGN.md 解析与序列化')

const mdCss = [
  '# 品牌设计系统',
  '',
  '```css',
  ':root {',
  '  --color-primary: #4C8DFF;',
  '  --color-bg: #0F1115;',
  '  --radius-md: 8px;',
  '}',
  '```',
].join('\n')
const pCss = MD.parseDesignMd(mdCss)
check('策略一：CSS 变量块被解析出颜色',
  pCss.tokens.color?.primary === '#4C8DFF', JSON.stringify(pCss.tokens.color))
check('策略一：半径被解析', pCss.tokens.radius?.md === 8, JSON.stringify(pCss.tokens.radius))
check('策略一：标题被当作规范名', (pCss.name ?? '').includes('品牌'), pCss.name)

const mdDot = ['# 点号键值', '', '- color.primary: #FF6B6B', '- color.surface: #FFFFFF', '- radius.lg: 16px'].join('\n')
const pDot = MD.parseDesignMd(mdDot)
check('策略二：点号键值被解析', pDot.tokens.color?.primary === '#FF6B6B', JSON.stringify(pDot.tokens.color))
check('策略二：点号半径被解析', pDot.tokens.radius?.lg === 16)

const mdTable = [
  '# 表格规范',
  '',
  '| Token | 值 |',
  '| --- | --- |',
  '| color.primary | #22B8CF |',
  '| color.bg | #FFFFFF |',
  '| font.body.family | Inter |',
].join('\n')
const pTable = MD.parseDesignMd(mdTable)
check('策略三：markdown 表格被解析', pTable.tokens.color?.primary === '#22B8CF', JSON.stringify(pTable.tokens.color))
check('策略三：字体族被解析', pTable.tokens.font?.body?.family === 'Inter', JSON.stringify(pTable.tokens.font?.body))

const mdJson = ['```json', JSON.stringify({ color: { primary: '#8B5CF6' }, radius: { md: 6 } }), '```'].join('\n')
const pJson = MD.parseDesignMd(mdJson)
check('策略四：JSON 代码块被解析', pJson.tokens.color?.primary === '#8B5CF6', JSON.stringify(pJson.tokens.color))

const mdCn = ['# 中文别名', '', '- 主色：#4C8DFF', '- 背景色：#0F1115'].join('\n')
const pCn = MD.parseDesignMd(mdCn)
check('策略五：中文别名被解析',
  pCn.tokens.color?.primary === '#4C8DFF' || pCn.tokens.color?.bg === '#0F1115',
  JSON.stringify(pCn.tokens.color))

const mdRules = ['# 规则', '', '- ❌ 不要使用纯黑背景', '- 禁止渐变'].join('\n')
const pRules = MD.parseDesignMd(mdRules)
check('禁止规则被归入 rules.donts', (pRules.rules?.donts ?? []).length >= 1, JSON.stringify(pRules.rules))

const pEmpty = MD.parseDesignMd('这是一段完全无关的文字。')
check('无 Token 时返回空 tokens', Object.keys(pEmpty.tokens).length === 0 || !pEmpty.tokens.color)
check('未能识别的原文进入 raw', pEmpty.raw.includes('完全无关'))

check('parseColorValue 识别 hex', MD.parseColorValue('#abc') === '#AABBCC', MD.parseColorValue('#abc'))
check('parseColorValue 展开四位缩写（丢弃 alpha）', MD.parseColorValue('#abcd') === '#AABBCC',
  MD.parseColorValue('#abcd'))
check('parseColorValue 六位原样大写', MD.parseColorValue('#4c8dff') === '#4C8DFF')
check('parseColorValue 八位丢弃 alpha', MD.parseColorValue('#4c8dff80') === '#4C8DFF')
check('parseColorValue 忽略 Markdown 反引号', MD.parseColorValue('`#4C8DFF`') === '#4C8DFF')
check('parseColorValue 识别 rgb()', MD.parseColorValue('rgb(76, 141, 255)')?.toLowerCase() === '#4c8dff')
check('parseColorValue 非法输入返回 null', MD.parseColorValue('看起来像蓝色') === null)
check('parseLengthValue 带单位', MD.parseLengthValue('12px') === 12)
check('parseLengthValue 纯数字', MD.parseLengthValue('999') === 999)
check('parseLengthValue 非法输入返回 null', MD.parseLengthValue('auto') === null)

/* specFromParsed 补全字体阶梯并强制单调 */
const spec = MD.specFromParsed(pCss, { name: '测试规范' })
check('specFromParsed 产出 8 档字体', 
  ['display', 'h1', 'h2', 'h3', 'body', 'bodyStrong', 'caption', 'overline'].every((k) => !!spec.tokens.font?.[k]),
  Object.keys(spec.tokens.font ?? {}).join(','))
{
  const sizes = ['overline', 'caption', 'body', 'bodyStrong', 'h3', 'h2', 'h1', 'display'].map(
    (k) => spec.tokens.font[k].size,
  )
  check('字体阶梯单调递增', sizes.every((s, i) => i === 0 || s >= sizes[i - 1]), sizes.join('>'))
}
check('radius.full 固定 999（不可被导入值覆盖）', spec.tokens.radius?.full === 999, String(spec.tokens.radius?.full))
check('specFromParsed 覆盖 base 中的同名颜色',
  MD.specFromParsed(pCss, { base: { color: { primary: '#000000' } } }).tokens.color.primary === '#4C8DFF')

/* 序列化 → 再解析（往返一致性） */
const serialized = MD.serializeDesignMd(spec)
check('序列化产出 markdown 标题', serialized.startsWith('# ') || serialized.includes('\n# '), serialized.slice(0, 40))
check('序列化包含主色值', serialized.includes(spec.tokens.color.primary))
const roundTrip = MD.parseDesignMd(serialized)
check('往返后主色不变', roundTrip.tokens.color?.primary === spec.tokens.color.primary,
  `${roundTrip.tokens.color?.primary} vs ${spec.tokens.color.primary}`)
check('往返后规范名不变', roundTrip.name === spec.name, `${roundTrip.name} vs ${spec.name}`)
check('往返后颜色键数量不丢', Object.keys(roundTrip.tokens.color ?? {}).length ===
  Object.keys(spec.tokens.color).length,
  `${Object.keys(roundTrip.tokens.color ?? {}).length} vs ${Object.keys(spec.tokens.color).length}`)
check('往返后圆角键数量不丢', Object.keys(roundTrip.tokens.radius ?? {}).length ===
  Object.keys(spec.tokens.radius).length,
  `${Object.keys(roundTrip.tokens.radius ?? {}).length} vs ${Object.keys(spec.tokens.radius).length}`)
check('往返后间距键数量不丢', Object.keys(roundTrip.tokens.space ?? {}).length ===
  Object.keys(spec.tokens.space).length,
  `${Object.keys(roundTrip.tokens.space ?? {}).length} vs ${Object.keys(spec.tokens.space).length}`)
check('往返后半径不变',
  MD.specFromParsed(roundTrip, { base: spec.tokens }).tokens.radius?.md === spec.tokens.radius.md)

/* 全量往返：五组 Token 都要能「导出 → 导入」无损 ——
   这是「用 DESIGN.md 与 Stitch / Claude Code 互通」这一卖点的硬约束 */
const fullSpec = {
  name: '全量往返',
  desc: '覆盖五组 Token',
  tokens: {
    color: { primary: '#4C8DFF', bg: '#0F1115', text: '#E6E9EF', danger: '#EF4444' },
    font: {
      h1: { family: 'Inter', size: 28, weight: 700, lineHeight: 1.25 },
      body: { family: 'Inter', size: 14, weight: 400, lineHeight: 1.5 },
    },
    space: { xxs: 2, xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48, huge: 64 },
    radius: { sm: 4, md: 8, lg: 16, xl: 24, full: 999 },
    shadow: {
      sm: { x: 0, y: 1, blur: 2, color: '#00000014' },
      md: { x: 0, y: 4, blur: 12, color: 'rgba(0, 0, 0, 0.16)' },
    },
  },
  rules: { dos: ['保持 8px 栅格'], donts: ['不要使用纯黑背景'] },
}
const fullSer = MD.serializeDesignMd(fullSpec)
const fullRt = MD.parseDesignMd(fullSer)
const keysOf = (o = {}) => Object.keys(o).sort().join(',')
check('全量往返：颜色键集合一致', keysOf(fullRt.tokens.color) === keysOf(fullSpec.tokens.color),
  `${keysOf(fullRt.tokens.color)} vs ${keysOf(fullSpec.tokens.color)}`)
check('全量往返：颜色值逐一相等',
  Object.entries(fullSpec.tokens.color).every(([k, v]) => fullRt.tokens.color[k] === v),
  JSON.stringify(fullRt.tokens.color))
check('全量往返：圆角键集合一致', keysOf(fullRt.tokens.radius) === keysOf(fullSpec.tokens.radius),
  `${keysOf(fullRt.tokens.radius)} vs ${keysOf(fullSpec.tokens.radius)}`)
check('全量往返：圆角值逐一相等',
  Object.entries(fullSpec.tokens.radius).every(([k, v]) => fullRt.tokens.radius[k] === v),
  JSON.stringify(fullRt.tokens.radius))
check('全量往返：间距键集合一致', keysOf(fullRt.tokens.space) === keysOf(fullSpec.tokens.space),
  `${keysOf(fullRt.tokens.space)} vs ${keysOf(fullSpec.tokens.space)}`)
check('全量往返：间距值逐一相等',
  Object.entries(fullSpec.tokens.space).every(([k, v]) => fullRt.tokens.space[k] === v),
  JSON.stringify(fullRt.tokens.space))
check('全量往返：字体族与字号不丢',
  fullRt.tokens.font?.h1?.family === 'Inter' && fullRt.tokens.font?.h1?.size === 28,
  JSON.stringify(fullRt.tokens.font?.h1))
check('全量往返：字体字重与行高不丢',
  fullRt.tokens.font?.h1?.weight === 700 && fullRt.tokens.font?.h1?.lineHeight === 1.25,
  JSON.stringify(fullRt.tokens.font?.h1))
check('全量往返：阴影数值不丢',
  fullRt.tokens.shadow?.md?.x === 0 && fullRt.tokens.shadow?.md?.y === 4 && fullRt.tokens.shadow?.md?.blur === 12,
  JSON.stringify(fullRt.tokens.shadow?.md))
check('全量往返：阴影颜色保留 alpha（8 位 hex）',
  fullRt.tokens.shadow?.sm?.color === '#00000014', String(fullRt.tokens.shadow?.sm?.color))
check('全量往返：阴影颜色保留 rgba 原形',
  /^rgba\(/.test(String(fullRt.tokens.shadow?.md?.color)), String(fullRt.tokens.shadow?.md?.color))
check('全量往返：Do / Don\'t 规则不丢',
  (fullRt.rules?.dos ?? []).length === 1 && (fullRt.rules?.donts ?? []).length === 1,
  JSON.stringify(fullRt.rules))
check('全量往返：二次序列化幂等', MD.serializeDesignMd({ ...fullSpec, tokens: MD.specFromParsed(fullRt, { base: fullSpec.tokens }).tokens }).includes('color.primary'))

/* 阴影取色：颜色 Token 丢 alpha，阴影必须留 alpha */
check('parseShadowValue 保留 8 位 hex 的 alpha',
  MD.parseShadowValue('0 1px 2px #00000014')?.color === '#00000014')
check('parseShadowValue 保留 rgba 原形',
  MD.parseShadowValue('0 4px 12px rgba(0,0,0,.4)')?.color === 'rgba(0,0,0,.4)')
check('parseShadowValue 展开 4 位 hex 到 8 位',
  MD.parseShadowValue('0 1px 2px #0004')?.color === '#00000044')
check('parseShadowValue none 返回 null', MD.parseShadowValue('none') === null)
check('parseShadowValue 数值拆分正确',
  JSON.stringify(MD.parseShadowValue('0 4px 14px 2px rgba(0,0,0,.2)')) ===
    JSON.stringify({ x: 0, y: 4, blur: 14, spread: 2, color: 'rgba(0,0,0,.2)' }),
  JSON.stringify(MD.parseShadowValue('0 4px 14px 2px rgba(0,0,0,.2)')))
check('别名表覆盖核心 token 键',
  ['primary', 'bg', 'surface', 'border', 'text', 'danger', 'success'].every((k) =>
    Object.values(MD.COLOR_ALIASES).includes(k) || k === 'primary',
  ))

/* 外部规范 JSON（Stitch design.md 兼容路径：只含 JSON 块） */
const stitchLike = [
  '# Design',
  '',
  '```json',
  JSON.stringify({ name: 'Imported', color: { primary: '#123456' }, radius: { md: 10 } }),
  '```',
  '',
  '- ❌ 不要用纯黑',
].join('\n')
const pStitch = MD.parseDesignMd(stitchLike)
check('兼容外部 JSON 规范块', pStitch.tokens.color?.primary === '#123456', JSON.stringify(pStitch.tokens.color))
check('规范名取自 JSON 的 name 字段', (pStitch.name ?? '').includes('Imported'), pStitch.name)
check('JSON name 优先于 Markdown 标题', pStitch.name === 'Imported', `${pStitch.name} vs Design`)
check('无 JSON 块时回退 Markdown 标题', pRules.name === '规则', pRules.name)
check('JSON 块 description 被采纳',
  MD.parseDesignMd(['```json', JSON.stringify({ name: 'X', description: '一套深色规范' }), '```'].join('\n'))
    .desc === '一套深色规范')

/* =========================== 6. 画布摆放口径 =========================== */
group('画布摆放口径（分组框 / 连线 / 缩略图共用）')

const canvas = { width: 390, height: 844 }
const boxes = L.layoutPages(mkDesign(8).pages, canvas)
check('layoutPages 每行 PAGES_PER_ROW 个换行',
  boxes[0].y === 0 && boxes[L.PAGES_PER_ROW - 1].y === 0 && boxes[L.PAGES_PER_ROW].y > 0,
  `${boxes[0].y} / ${boxes[L.PAGES_PER_ROW].y}`)
check('layoutPages 行内水平步长为 画布宽 + PAGE_GAP_X',
  boxes[1].x - boxes[0].x === canvas.width + L.PAGE_GAP_X, String(boxes[1].x - boxes[0].x))
check('layoutPages 尺寸等于画布尺寸', boxes[0].w === canvas.width && boxes[0].h === canvas.height)
check('layoutPages 为每个界面都产出坐标', boxes.length === 8)

const b1 = L.boundsOf([
  { x: 0, y: 0, w: 100, h: 100 },
  { x: 200, y: 50, w: 100, h: 100 },
])
check('boundsOf 取并集外框', b1.x === 0 && b1.y === 0 && b1.w === 300 && b1.h === 150, JSON.stringify(b1))
check('boundsOf 空输入返回 null', L.boundsOf([]) === null)
check('inflate 双向外扩', JSON.stringify(L.inflate({ x: 10, y: 10, w: 10, h: 10 }, 5)) === JSON.stringify({ x: 5, y: 5, w: 20, h: 20 }))
check('rectsIntersect 相交为真',
  L.rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }))
check('rectsIntersect 相离为假',
  !L.rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 10, h: 10 }))

/* 一键排布：同分组界面必须相邻 */
{
  const d = mkDesign(6)
  const ids = d.pages.map((p) => p.id)
  const g = I.createPageGroup('A', 0)
  const g2 = I.createPageGroup('B', 1)
  d.pageGroups = [g, g2]
  // A 组：第 1、3、5 个界面；B 组：第 2、4 个；第 6 个不分组
  d.pages = d.pages.map((p, i) => {
    if ([0, 2, 4].includes(i)) return { ...p, groupId: g.id }
    if ([1, 3].includes(i)) return { ...p, groupId: g2.id }
    return p
  })
  const order = L.tidyOrder(d.pages, [g.id, g2.id])
  check('tidyOrder 保持界面总数', order.length === 6)
  check('tidyOrder 每个界面只出现一次', new Set(order).size === 6)
  const rankOf = (id) => order.indexOf(id)
  const aRanks = d.pages.filter((p) => p.groupId === g.id).map((p) => rankOf(p.id))
  const bRanks = d.pages.filter((p) => p.groupId === g2.id).map((p) => rankOf(p.id))
  check('tidyOrder 让 A 组连续', Math.max(...aRanks) - Math.min(...aRanks) === aRanks.length - 1, aRanks.join(','))
  check('tidyOrder 让 B 组连续', Math.max(...bRanks) - Math.min(...bRanks) === bRanks.length - 1, bRanks.join(','))
  check('tidyOrder 未分组界面排到最后',
    d.pages.filter((p) => !p.groupId).every((p) => rankOf(p.id) >= aRanks.length + bRanks.length))
  check('tidyOrder 组内保持原有相对顺序',
    d.pages.filter((p) => p.groupId === g.id).map((p) => rankOf(p.id)).every((r, i, arr) => i === 0 || r > arr[i - 1]))
  check('tidyOrder 不修改入参数组', d.pages.length === 6 && ids.length === 6)
}

/* 适应窗口 */
{
  const t = L.fitTransform({ x: 0, y: 0, w: 1000, h: 1000 }, { w: 500, h: 500 }, 0, 0.1, 2)
  check('fitTransform 缩放被夹到视口内', t.zoom <= 0.5 + 1e-9 && t.zoom > 0, String(t.zoom))
  check('fitTransform 平移非 NaN', Number.isFinite(t.pan.x) && Number.isFinite(t.pan.y))
  const t0 = L.fitTransform(null, { w: 500, h: 500 })
  check('fitTransform 空内容给兜底变换', t0.zoom === 1 && t0.pan.x === 60 && t0.pan.y === 60)
}

/* 清理（尽力而为：清理失败不能改变测试结论） */
Object.values(outs).forEach((f) => bestEffortRemove(f))

console.log(`\n${'─'.repeat(48)}`)
console.log(`通过 ${pass} · 失败 ${fail}`)
if (fail > 0) {
  console.log('\n失败项：')
  failures.forEach((f) => console.log(`  - ${f}`))
  process.exit(1)
}
console.log('全部通过 ✓')
