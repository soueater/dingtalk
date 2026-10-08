// scripts/test-pipeline.mjs
// 三阶段生成流水线的端到端测试。
//
// 思路：generate.ts 依赖 window.dsa.llm（真实模型），无法在 Node 里直接跑。
// 因此本脚本把 client 模块整体替换为「脚本化假模型」——按阶段依次返回
// 规划 / Token / 页面 三类预设 JSON，从而在无凭据环境下验证：
//   阶段串联顺序、跨页 id 去重、跳转规范化、失败降级、整体组装、store 写入。
//
// 运行：node scripts/test-pipeline.mjs

import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { bestEffortRemove } from './_fsx.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const stubDir = path.join(root, 'scripts', '__pipeline_stub__')
fs.mkdirSync(stubDir, { recursive: true })

/* ---------- 1. 生成各类替身模块 ---------- */

// 假 client：按 generate.ts 固定传入的 system prompt 判定阶段（最可靠的区分依据）。
// 页面阶段从输出结构行 `"page": { "id": "xxx"` 里精确提取当前页 id，
// 再按 id 从 __PAGES__（map）取载荷 —— 避免「plan JSON 内嵌所有页面名」造成的误判。
// 状态挂到 globalThis，避免 bundle 内联导致测试脚本读到另一份实例。
//   plan   → system 含「资深产品设计师」
//   tokens → system 含「资深 UI 设计师」
//   page   → system 含「资深 UI 设计工程师」
const stubClientPath = path.join(stubDir, 'client.js')
fs.writeFileSync(
  stubClientPath,
  `globalThis.__CALLS__ = globalThis.__CALLS__ || []
export async function chatOnce(configId, messages, opts) {
  const system = messages[0]?.content || ''
  const user = messages[messages.length - 1].content || ''
  globalThis.__CALLS__.push({ configId, system, user, opts })

  let stage
  if (system.includes('产品设计师')) stage = 'plan'
  else if (system.includes('设计工程师')) stage = 'page'
  else if (system.includes('UI 设计师')) stage = 'tokens'
  else stage = 'unknown'

  const failOn = globalThis.__THROW_ON__

  if (stage === 'plan') {
    if (failOn === '@plan') throw new Error('SIMULATED_PLAN_FAILURE')
    return { content: JSON.stringify(globalThis.__PLAN__), model: 'mock', ms: 1, usage: null }
  }
  if (stage === 'tokens') {
    if (failOn === '@tokens') throw new Error('SIMULATED_TOKEN_FAILURE')
    return { content: JSON.stringify(globalThis.__TOKENS__), model: 'mock', ms: 1, usage: null }
  }

  // 页面阶段：精确提取当前页 id
  const m = user.match(/"page":\\s*\\{\\s*"id":\\s*"([^"]+)"/)
  const pageId = m ? m[1] : null
  if (failOn && failOn === pageId) throw new Error('SIMULATED_PAGE_FAILURE')

  const payload = (globalThis.__PAGES__ || {})[pageId]
  return { content: JSON.stringify(payload ?? {}), model: 'mock', ms: 1, usage: null }
}
`,
)

// 替身：style-presets
const stubPresetsPath = path.join(stubDir, 'presets.js')
fs.writeFileSync(
  stubPresetsPath,
  `export const DEVICE_CANVAS = {
  MOBILE: { width: 390, height: 844, label: '移动端' },
  TABLET: { width: 834, height: 1112, label: '平板' },
  DESKTOP: { width: 1440, height: 900, label: '桌面端' },
  RESPONSIVE: { width: 1280, height: 800, label: '响应式' },
}
export const STYLE_PRESETS = [{
  id: 'clear-blue', name: '清透蓝', desc: '',
  tokens: { color: { primary: '#3B82F6', bg: '#FFFFFF', text: '#111827', muted: '#6B7280' }, font: {}, space: {}, radius: {}, shadow: {} },
}]
export function getPreset() { return STYLE_PRESETS[0] }
`,
)

// 替身：project.store（状态挂 globalThis，供测试脚本跨 bundle 读取）
const stubProjectStorePath = path.join(stubDir, 'project-store.js')
fs.writeFileSync(
  stubProjectStorePath,
  `globalThis.__STORE__ = globalThis.__STORE__ || { design: null, dirty: false }
export const useProjectStore = {
  getState: () => ({
    design: globalThis.__STORE__.design,
    dirty: globalThis.__STORE__.dirty,
    loadProject: (p, file) => { globalThis.__STORE__.design = file.design },
  }),
  setState: (patch) => {
    if ('dirty' in patch) globalThis.__STORE__.dirty = patch.dirty
    if (patch.design) globalThis.__STORE__.design = patch.design
  },
}
`,
)

// 替身：ui.store（toast 记录挂 globalThis）
const stubUiStorePath = path.join(stubDir, 'ui-store.js')
fs.writeFileSync(
  stubUiStorePath,
  `globalThis.__TOASTS__ = globalThis.__TOASTS__ || []
export const useUiStore = {
  getState: () => ({ toast: (kind, message) => globalThis.__TOASTS__.push({ kind, message }) }),
}
`,
)

/* ---------- 2. 打包 generate.ts ---------- */

const tmp = path.join(root, 'dist', 'test', 'pipeline.cjs')
await build({
  entryPoints: [path.join(root, 'src', 'services', 'ai', 'generate.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: tmp,
  logLevel: 'error',
  alias: {
    '@/services/design/style-presets': stubPresetsPath,
    '@/services/mock/projects': path.join(root, 'scripts', 'stub-projects.js'),
    '@/stores/project.store': stubProjectStorePath,
    '@/stores/ui.store': stubUiStorePath,
    '@shared/design': path.join(root, 'shared', 'design.ts'),
  },
  // generate.ts 用相对路径 `./client` 导入真实模型客户端，alias 无法拦截相对说明符，
  // 故用插件在解析阶段把它重定向到假模型。
  plugins: [
    {
      name: 'stub-ai-client',
      setup(b) {
        b.onResolve({ filter: /(^|\/)client$/ }, () => ({ path: stubClientPath }))
        b.onResolve({ filter: /style-presets$/ }, () => ({ path: stubPresetsPath }))
        b.onResolve({ filter: /@\/stores\/project\.store$/ }, () => ({ path: stubProjectStorePath }))
        b.onResolve({ filter: /@\/stores\/ui\.store$/ }, () => ({ path: stubUiStorePath }))
        b.onResolve({ filter: /^@shared\/design$/ }, () => ({ path: path.join(root, 'shared', 'design.ts') }))
      },
    },
  ],
})

const require = createRequire(import.meta.url)
const { generateProject } = require(tmp)

/* Schema 版本取自唯一事实来源，避免断言里写死字面量导致升版误报 */
const designTmp = path.join(root, 'dist', 'test', 'pipeline-design.cjs')
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

/** 跨 bundle 读取替身状态（替身内部挂在 globalThis 上） */
const peekStore = () => globalThis.__STORE__
const toasts = () => globalThis.__TOASTS__
const calls = () => globalThis.__CALLS__

/* ---------- 3. 断言工具 ---------- */

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

/* ---------- 4. 预设模型输出 ---------- */

const PLAN = {
  projectName: '沿海民宿预订',
  device: 'MOBILE',
  canvas: { width: 390, height: 844 },
  styleDirection: '清爽海洋风',
  pages: [
    { id: 'home', name: '首页', purpose: '展示推荐民宿', keySections: ['搜索', '推荐列表'] },
    { id: 'detail', name: '详情页', purpose: '查看民宿详情', keySections: ['图片', '房型', '预订'] },
    { id: 'order', name: '订单页', purpose: '确认订单', keySections: ['房型信息', '支付'] },
  ],
  flows: [
    { from: 'home', to: 'detail', trigger: 'click' },
    { from: 'detail', to: 'order', trigger: 'click' },
  ],
}

const TOKENS = {
  color: { primary: '#0EA5E9', bg: '#F8FAFC', text: '#0F172A', muted: '#64748B', border: '#E2E8F0' },
  font: { base: { family: 'Inter', size: 14, weight: 400 } },
  space: { sm: 8, md: 16, lg: 24 },
  radius: { md: 12 },
  shadow: {},
}

function pagePayload(id, name, opts = {}) {
  return {
    page: {
      id,
      name,
      order: 0,
      root: {
        id: `${id}_root`,
        type: 'frame',
        children: [
          { id: `${id}_title`, type: 'text', text: name, style: { color: '$color.text' } },
          ...(opts.extraNodes ?? []),
        ],
      },
    },
    flows: opts.flows ?? [],
  }
}

/** 每个用例前重置全局假模型 */
function setupMocks({ plan = PLAN, tokens = TOKENS, pages, throwOn = null }) {
  globalThis.__CALLS__ = []
  globalThis.__TOASTS__ = []
  globalThis.__PLAN__ = plan
  globalThis.__TOKENS__ = tokens
  globalThis.__PAGES__ = pages
  globalThis.__THROW_ON__ = throwOn
}

const OPTS = { configId: 'cfg_test' }

/* ==================== 用例 ==================== */

group('用例 1 · 顺利路径：三阶段串联 + 组装 + 写入 store')
{
  setupMocks({
    pages: {
      home: pagePayload('home', '首页'),
      detail: pagePayload('detail', '详情页', {
        flows: [{ id: 'f1', from: 'detail_btn', to: 'order', trigger: 'click' }],
        extraNodes: [{ id: 'detail_btn', type: 'button', text: '立即预订' }],
      }),
      order: pagePayload('order', '订单页'),
    },
  })

  const stages = []
  const project = await generateProject('做一个沿海民宿预订 App', {
    ...OPTS,
    onStage: (s) => stages.push(s),
  })

  check('返回项目对象', !!project && typeof project === 'object')
  check('schemaVersion 正确', project.schemaVersion === SCHEMA_VERSION, `${project.schemaVersion} vs ${SCHEMA_VERSION}`)
  check('项目名来自规划阶段', project.meta.name === '沿海民宿预订', project.meta.name)
  check('设备来自规划阶段', project.meta.device === 'MOBILE', project.meta.device)
  check('source 标记为 ai', project.meta.source === 'ai', project.meta.source)
  check('prompt 被记录', project.meta.prompt === '做一个沿海民宿预订 App')
  check('页面数量 = 3', project.pages.length === 3, String(project.pages.length))
  check('页面 order 重排为 0,1,2', project.pages.every((p, i) => p.order === i))
  check('页面坐标自动错开', project.pages[1].pos.x > project.pages[0].pos.x)
  check('Token 采用模型输出', project.tokens.color.primary === '#0EA5E9', project.tokens.color.primary)
  check('三个阶段均有进度回调', stages.length >= 3, `实际 ${stages.length}`)
  check('首个回调为规划阶段', /规划/.test(stages[0]), stages[0])

  check('模型被调用 1(plan)+1(tokens)+3(pages) = 5 次', calls().length === 5, String(calls().length))
  check('plan 阶段 jsonMode 开启', calls()[0].opts?.jsonMode === true)

  const { design, dirty } = peekStore()
  check('已写入 store.design', design?.meta?.name === '沿海民宿预订')
  check('store.dirty 置为 true', dirty === true)

  // 跳转规范化：detail→order 的 from 指向真实节点，应保留
  const kept = project.flows.find((f) => f.to === 'order')
  check('合法跳转被保留', !!kept, JSON.stringify(project.flows))
  check('跳转补全 fromPage', kept?.fromPage === 'detail', kept?.fromPage)
}

group('用例 2 · 跨页节点 id 去重')
{
  // 三页根节点都用同一个 id p_root，若不处理会冲突
  setupMocks({
    plan: { ...PLAN, pages: [{ id: 'home', name: '首页' }, { id: 'detail', name: '详情页' }], flows: [] },
    // 两页根节点使用相同 id，用于验证跨页去重
    pages: {
      home: { page: { id: 'home', name: '首页', root: { id: 'same_root', type: 'frame', children: [] } } },
      detail: { page: { id: 'detail', name: '详情页', root: { id: 'same_root', type: 'frame', children: [] } } },
    },
  })

  const project = await generateProject('同 id 测试', OPTS)
  const ids = []
  const walk = (n) => {
    ids.push(n.id)
    ;(n.children ?? []).forEach(walk)
  }
  project.pages.forEach((p) => walk(p.root))

  check('全部节点 id 唯一', new Set(ids).size === ids.length, ids.join(','))
  check('页面数量 = 2', project.pages.length === 2)
}

group('用例 3 · 单页失败降级：跳过失败页，其余照常产出')
{
  setupMocks({
    plan: {
      ...PLAN,
      pages: [
        { id: 'a', name: '页面A' },
        { id: 'bad', name: '会失败的页' },
        { id: 'c', name: '页面C' },
      ],
      flows: [],
    },
    pages: {
      a: pagePayload('a', '页面A'),
      c: pagePayload('c', '页面C'),
    },
    // 让 id 为 bad 的页面持续抛错
    throwOn: 'bad',
  })

  const project = await generateProject('降级测试', OPTS)
  check('失败页被跳过，产出 2 页', project.pages.length === 2, String(project.pages.length))
  check('产出页名正确', project.pages.map((p) => p.name).join(',') === '页面A,页面C')
  check('产生告警 toast', toasts().some((t) => t.kind === 'warn'), JSON.stringify(toasts()))
  check('告警信息含页面名', toasts().some((t) => t.message.includes('会失败的页')))
}

group('用例 4 · 全部页面失败 → 抛错')
{
  setupMocks({
    plan: { ...PLAN, pages: [{ id: 'x', name: '唯一页' }], flows: [] },
    pages: { x: pagePayload('x', '唯一页') },
    throwOn: 'x',
  })

  let err = null
  try {
    await generateProject('全失败测试', OPTS)
  } catch (e) {
    err = e
  }
  check('抛出错误', !!err)
  check('错误信息含「均失败」', /均失败/.test(err?.message ?? ''), err?.message)
}

group('用例 5 · Token 阶段失败 → 回退预设不致命')
{
  setupMocks({
    plan: { ...PLAN, pages: [{ id: 'h', name: '首页' }], flows: [] },
    pages: { h: pagePayload('h', '首页') },
    throwOn: '@tokens', // 让 Token 阶段直接抛错，走 generate 的 catch 回退分支
  })

  const project = await generateProject('Token 降级', OPTS)
  check('生成成功（未因 Token 失败中断）', !!project)
  check('Token 回退到预设主色', project.tokens.color.primary === '#3B82F6', project.tokens.color.primary)
  check('页面仍正常产出', project.pages.length === 1)
}

group('用例 6 · 中止信号：规划后中止')
{
  setupMocks({
    pages: { home: pagePayload('home', '首页'), detail: pagePayload('detail', '详情页') },
  })
  let abortCount = 0
  let err = null
  try {
    await generateProject('中止测试', {
      ...OPTS,
      shouldAbort: () => ++abortCount > 1, // 第二次检查即中止
    })
  } catch (e) {
    err = e
  }
  check('抛出 ABORTED', /ABORTED/.test(err?.message ?? ''), err?.message)
  check('中止后未继续调用模型', calls().length <= 1, String(calls().length))
}

group('用例 7 · 非法设备与画布兜底')
{
  setupMocks({
    plan: { projectName: '兜底测试', device: 'WATCH', canvas: null, pages: [{ id: 'p', name: '页' }], flows: [] },
    pages: { p: pagePayload('p', '页') },
  })
  const project = await generateProject('兜底', OPTS)
  check('非法设备回退 MOBILE', project.meta.device === 'MOBILE', project.meta.device)
  check('画布尺寸被兜底', project.meta.canvas.width === 390 && project.meta.canvas.height === 844, JSON.stringify(project.meta.canvas))
}

group('用例 8 · 跳转指向不存在页面 → 被过滤')
{
  setupMocks({
    plan: { ...PLAN, pages: [{ id: 'home', name: '首页' }], flows: [] },
    pages: {
      home: pagePayload('home', '首页', {
        flows: [
          { id: 'f_ok', from: 'home_title', to: 'home' },
          { id: 'f_dead', from: 'home_title', to: 'ghost_page' },
          { id: 'f_badnode', from: 'no_such_node', to: 'home' },
        ],
      }),
    },
  })
  const project = await generateProject('跳转过滤', OPTS)
  check('死跳转被过滤，仅保留合法 1 条', project.flows.length === 1, JSON.stringify(project.flows))
  check('保留的跳转目标正确', project.flows[0]?.to === 'home')
}

group('用例 9 · 规划阶段无页面 → 抛错')
{
  setupMocks({
    plan: { projectName: '空', pages: [], flows: [] },
    pages: {},
  })
  let err = null
  try {
    await generateProject('空页面', OPTS)
  } catch (e) {
    err = e
  }
  check('抛出错误', !!err)
  // 空 pages 会被 validatePlanPayload 拦下 → 走修复重试 → 最终错误含「未包含任何页面」
  check('错误信息指明页面规划缺失', /未包含任何页面|未返回任何/.test(err?.message ?? ''), err?.message)
  check('错误信息带阶段前缀', /规划阶段/.test(err?.message ?? ''), err?.message)
}

/* ------------------------------ 汇总 ------------------------------ */

console.log('\n' + '─'.repeat(48))
console.log(`通过 ${pass} · 失败 ${fail}`)
if (fail) {
  console.log('\n失败项：')
  failures.forEach((f) => console.log(`  · ${f}`))
  console.log('存在失败 ✗')
  process.exit(1)
}
console.log('全部通过 ✓')
bestEffortRemove(stubDir)
