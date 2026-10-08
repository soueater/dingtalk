// scripts/test-defects.mjs
// 缺陷回归测试：① 软件无法正常关闭 ② 「生成设计变体」报错
//
// ① 关闭链路（electron/main/close-guard-core.ts，纯决策内核）
//    根因：渲染层 beforeunload 在 dirty 时 preventDefault，主进程未监听
//    will-prevent-unload → Chromium 默认阻止卸载 → 窗口关不掉。
//    验收：决策表正确、对话框返回值映射保守、保存失败不放行。
//
// ② 变体链路（src/services/ai/ask-json.ts + parse.ts 的变体校验/修补）
//    根因：maxTokens 写死 12000 超限 → 输出被截断；无校验重试；
//    单个变体失败拖垮整批。
//    验收：上限被封顶、校验能识别残缺载荷、逐项容错不整批失败。
//
// 运行：node scripts/test-defects.mjs

import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { bestEffortRemove } from './_fsx.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'dist', 'test')
const tmpGuard = path.join(outDir, 'close-guard.cjs')
const tmpAsk = path.join(outDir, 'ask-json.cjs')
const tmpVariants = path.join(outDir, 'variants-lib.cjs')

const SHARED = path.join(root, 'shared', 'design.ts')

/* ---- ① 关闭守卫内核（零依赖，可直接打包） ---- */
await build({
  entryPoints: [path.join(root, 'electron', 'main', 'close-guard-core.ts')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  outfile: tmpGuard, logLevel: 'error',
})

/* ---- ② askJson：把 client 换成可控替身，parse/prompt 用真实实现 ---- */
// 注意：ask-json.ts 用相对路径 `./client` 引入，esbuild 的 alias 不匹配相对路径，
// 因此这里用插件在解析阶段把该文件替换成脚本替身。
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
  entryPoints: [path.join(root, 'scripts', 'ask-json-test-entry.mjs')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  outfile: tmpAsk, logLevel: 'error',
  plugins: [stubClientPlugin],
  alias: { '@shared/design': SHARED },
})

/* ---- ② 变体校验/修补纯函数 ---- */
await build({
  entryPoints: [path.join(root, 'src', 'services', 'ai', 'parse.ts')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  outfile: tmpVariants, logLevel: 'error',
  alias: {
    '@shared/design': SHARED,
    '@/services/mock/projects': path.join(root, 'scripts', 'stub-projects.js'),
    '@/services/design/style-presets': path.join(root, 'scripts', 'stub-presets.js'),
  },
})

const require = createRequire(import.meta.url)
const G = require(tmpGuard)
const A = require(tmpAsk)
const P = require(tmpVariants)
// 通过测试入口拿到与 ask-json 同源的 client 替身控制面
const client = A
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

/* ==================================================================== */
/* ①  关闭缺陷（decideClose 决策表）                                     */
/* ==================================================================== */

group('① 关闭决策表 decideClose')
{
  const s = (over = {}) => ({ confirmed: false, dirty: false, dialogOpen: false, ...over })

  check('无未保存改动 → 直接关闭', G.decideClose(s()) === 'allow')
  check('有未保存改动 → 弹确认框', G.decideClose(s({ dirty: true })) === 'ask')
  check('已确认（选不保存）→ 直接关闭', G.decideClose(s({ confirmed: true, dirty: true })) === 'allow')
  check('保存成功后置 confirmed → 直接关闭',
    G.decideClose(s({ confirmed: true, dirty: false })) === 'allow')
  check('对话框在路上 → 忽略本次（不放行）', G.decideClose(s({ dirty: true, dialogOpen: true })) === 'ignore')
  check('对话框在路上且已确认 → 放行', G.decideClose(s({ confirmed: true, dialogOpen: true })) === 'allow')
  // dialogOpen 优先级高于 dirty：即使渲染层在弹框期间恰好保存成功，也必须等对话框决断，
  // 否则用户还看着弹框、窗口已经消失。
  check('对话框在路上且已变干净 → 仍忽略（交给在途对话框决断）',
    G.decideClose(s({ dialogOpen: true })) === 'ignore')
  check('ignore 不等于 allow（连点关闭不丢改动）',
    G.decideClose(s({ dirty: true, dialogOpen: true })) !== 'allow')
}

group('① 关闭状态机不变量（回归「窗口关不掉」）')
{
  const s = (over = {}) => ({ confirmed: false, dirty: false, dialogOpen: false, ...over })

  // 关键不变量：一次 close 要么放行、要么在「非 dialogOpen」时进入 ask，
  // 也就是不存在「既不放行、又不弹框」的静默拦截。
  const states = []
  for (const confirmed of [false, true]) {
    for (const dirty of [false, true]) {
      for (const dialogOpen of [false, true]) {
        states.push({ confirmed, dirty, dialogOpen })
      }
    }
  }
  const silentBlock = states.filter((st) => {
    const d = G.decideClose(st)
    // 允许放行；忽略（在途对话框）也不算静默；其余必须能变成 ask
    return d !== 'allow' && d !== 'ask' && !st.dialogOpen
  })
  check('不存在「静默拦截」状态组合', silentBlock.length === 0, JSON.stringify(silentBlock))

  // 从『有改动、无在途对话框』出发，一定能走到 ask（而不是死锁）
  check('有改动且无在途对话框 → 必然询问', G.decideClose(s({ dirty: true })) === 'ask')

  // ask 之后 dialogOpen 置位 → 重入被忽略；对话框关闭（dialogOpen 归位）→ 可再次决断
  check('对话框关闭后可再次决断',
    G.decideClose(s({ dirty: true, dialogOpen: false })) === 'ask')
  check('对话框关闭且已确认 → 放行',
    G.decideClose(s({ dirty: true, dialogOpen: false, confirmed: true })) === 'allow')
}

group('① 对话框返回值映射（保守优先）')
{
  check('0 → 保存并关闭', G.mapDialogResponse(0) === 'save')
  check('1 → 不保存', G.mapDialogResponse(1) === 'discard')
  check('2 → 取消', G.mapDialogResponse(2) === 'cancel')
  check('undefined（用户 X 掉窗口）→ 取消', G.mapDialogResponse(undefined) === 'cancel')
  check('null → 取消', G.mapDialogResponse(null) === 'cancel')
  check('负数 → 取消', G.mapDialogResponse(-1) === 'cancel')
  check('越界值 → 取消', G.mapDialogResponse(99) === 'cancel')

  check('按钮文案与映射对齐（3 个）', G.CLOSE_DIALOG_BUTTONS.length === 3)
  check('按钮顺序：保存/不保存/取消',
    G.CLOSE_DIALOG_BUTTONS[0].includes('保存') &&
    G.CLOSE_DIALOG_BUTTONS[1].includes('不保存') &&
    G.CLOSE_DIALOG_BUTTONS[2].includes('取消'))
  check('mapDialogResponse(CLOSE_DIALOG_DEFAULT_ID) = save',
    G.mapDialogResponse(G.CLOSE_DIALOG_DEFAULT_ID) === 'save')
  check('mapDialogResponse(CLOSE_DIALOG_CANCEL_ID) = cancel',
    G.mapDialogResponse(G.CLOSE_DIALOG_CANCEL_ID) === 'cancel')

  check('保存 → 先存后关', G.effectOfChoice('save') === 'save-then-close')
  check('不保存 → 立即关', G.effectOfChoice('discard') === 'close-now')
  check('取消 → 留在窗口', G.effectOfChoice('cancel') === 'stay')

  check('保存成功 → 放行关闭', G.shouldCloseAfterSave(true) === true)
  check('保存失败 → 不关窗（防丢改动）', G.shouldCloseAfterSave(false) === false)
}

group('① 完整关闭流程推演（回归「窗口关不掉」）')
{
  // 场景：有未保存改动，用户点关闭 → 选「保存并关闭」→ 保存成功
  let snap = { confirmed: false, dirty: true, dialogOpen: false }
  const step1 = G.decideClose(snap)
  check('步骤1：首次关闭 → ask（此前这里是「无响应」）', step1 === 'ask', step1)

  snap = { ...snap, dialogOpen: true }
  check('步骤2：重复点击 → ignore（不叠加弹窗）', G.decideClose(snap) === 'ignore')

  const choice = G.mapDialogResponse(0)
  check('步骤3：用户选「保存并关闭」', choice === 'save')
  check('步骤4：动作 = 先存后关', G.effectOfChoice(choice) === 'save-then-close')
  check('步骤5：保存成功 → 放行', G.shouldCloseAfterSave(true) === true)

  snap = { confirmed: true, dirty: false, dialogOpen: false }
  check('步骤6：重入 close → allow（窗口正常关闭）', G.decideClose(snap) === 'allow')

  // 场景 B：保存失败必须留在窗口
  const snapB = { confirmed: false, dirty: true, dialogOpen: false }
  check('场景B：保存失败不放行', G.shouldCloseAfterSave(false) === false)
  check('场景B：确认标记未置位 → 再次关闭仍会询问',
    G.decideClose(snapB) === 'ask')

  // 场景 C：无改动直接关闭（不应被拦截）
  check('场景C：干净项目直接关闭', G.decideClose({ confirmed: false, dirty: false, dialogOpen: false }) === 'allow')
}

/* ==================================================================== */
/* ②  变体缺陷（输出上限封顶）                                           */
/* ==================================================================== */

group('② 输出上限 clampMaxTokens（原 12000 超限的修复点）')
{
  check('硬上限常量 = 8192', A.HARD_MAX_TOKENS === 8192)
  check('历史值 12000 被封顶到 8192', A.clampMaxTokens(12000) === 8192, String(A.clampMaxTokens(12000)))
  check('未传值时用默认上限', A.clampMaxTokens(undefined) === A.DEFAULT_MAX_TOKENS)
  check('小于上限时原样保留', A.clampMaxTokens(4096) === 4096)
  check('等于上限时保留', A.clampMaxTokens(8192) === 8192)
  check('0 / 负数回落到默认上限', A.clampMaxTokens(0) === A.DEFAULT_MAX_TOKENS && A.clampMaxTokens(-5) === A.DEFAULT_MAX_TOKENS)
  check('NaN 回落到默认上限', A.clampMaxTokens(NaN) === A.DEFAULT_MAX_TOKENS)
  check('小数向下取整', A.clampMaxTokens(1000.9) === 1000)
  check('自定义硬上限生效', A.clampMaxTokens(9999, 2048) === 2048)
  check('非法硬上限回落常量', A.clampMaxTokens(9999, 0) === 8192)
  check('回灌截断长度 4000', A.ECHO_LIMIT === 4000)
}

group('② 变体载荷结构校验 validateVariantPayload')
{
  const v = P.validateVariantPayload

  check('非对象被拒', v(null).ok === false && v('x').ok === false)
  check('缺 variants 被拒', v({}).ok === false)
  check('variants 非数组被拒', v({ variants: 'x' }).ok === false)
  check('variants 空数组被拒', v({ variants: [] }).ok === false)
  check('错误文案说明「未返回变体」',
    v({ variants: [] }).errors[0].includes('未返回任何变体'), v({ variants: [] }).errors[0])
  check('全部缺 root 被拒', v({ variants: [{ rationale: 'a' }] }).ok === false)
  check('错误文案说明「缺少 root」',
    v({ variants: [{ rationale: 'a' }] }).errors[0].includes('root'),
    v({ variants: [{ rationale: 'a' }] }).errors[0])
  check('至少一个带 root → 通过', v({ variants: [{ root: { id: 'r', type: 'frame' } }] }).ok === true)
  check('部分缺 root → 通过并告警',
    v({ variants: [{ root: { id: 'r', type: 'frame' } }, { rationale: 'bad' }] }).ok === true &&
    v({ variants: [{ root: { id: 'r', type: 'frame' } }, { rationale: 'bad' }] }).warnings.length === 1)
}

group('② 变体逐项容错 repairVariantsPayload（单坏不拖垮整批）')
{
  const goodRoot = { id: 'v_root', type: 'frame', children: [{ id: 'v_t', type: 'text', props: { content: '你好' } }] }
  const payload = {
    variants: [
      { aspects: ['layout'], rationale: '布局变体', root: goodRoot },
      { aspects: ['color'], rationale: '缺 root 的坏变体' },
      { aspects: ['typography'], rationale: '类型非法的变体', root: 'not-an-object' },
      { aspects: ['content'], rationale: '好变体 2', root: goodRoot },
    ],
  }

  const r = P.repairVariantsPayload(payload, 4)
  check('4 个变体全部产出（不整批失败）', r.items.length === 4, String(r.items.length))
  check('好变体保留 root', r.items[0].root !== null)
  check('坏变体降级为 null 并带错误', r.items[1].root === null && !!r.items[1].error)
  check('坏变体错误信息可读', r.items[1].error.includes('root'), r.items[1].error)
  check('坏变体 rationale 被替换为「生成失败」', r.items[1].rationale === '生成失败')
  check('第 4 个好变体不受前面坏变体影响', r.items[3].root !== null)

  const capped = P.repairVariantsPayload(payload, 2)
  check('数量上限生效', capped.items.length === 2)
  check('截断产生告警', capped.warnings.some((w) => w.includes('上限')), capped.warnings.join())

  const noAspects = P.repairVariantsPayload({ variants: [{ rationale: 'x', root: goodRoot }] }, 1)
  check('缺 aspects 降级为空数组', Array.isArray(noAspects.items[0].aspects) && noAspects.items[0].aspects.length === 0)

  const noList = P.repairVariantsPayload({}, 3)
  check('完全无 variants → 空结果不抛错', noList.items.length === 0)

  const badLimit = P.repairVariantsPayload(payload, 0)
  check('非法上限回落到全部', badLimit.items.length === 4)
}

group('② askJson 修复重试与统一报错')
{
  const OK = { variants: [{ root: { id: 'r', type: 'frame' } }] }
  check('校验器可复用', typeof A.askJson === 'function')

  // 首次输出截断（JSON 残缺）→ 第二次修复成功
  client.__queue([
    '{"variants":[{"root":{"id":"r","type":"fr', // 故意截断
    JSON.stringify(OK),
  ])
  const r1 = await A.askJson({
    configId: 'cfg', system: 's', user: 'u', temperature: 0.85,
    validate: (o) => { const x = P.validateVariantPayload(o); return { ok: x.ok, errors: x.errors } },
    maxTokens: 8192, stageName: '变体生成',
  })
  check('截断后可经修复重试拿回结果', !!r1 && Array.isArray(r1.variants))
  check('修复重试实际发了 2 次请求', client.__calls().length === 2, String(client.__calls().length))
  check('2 次请求都启用了 jsonMode', client.__calls().every((c) => c.opts?.jsonMode === true))
  check('maxTokens 被传为封顶值', client.__calls().every((c) => c.opts?.maxTokens === 8192))
  check('第二次请求携带修复提示（4 条消息）', client.__calls()[1].messages.length === 4,
    String(client.__calls()[1].messages.length))

  // 两次都失败 → 抛 AskJsonError 且带阶段名
  client.__queue(['不是 JSON', '仍不是 JSON'])
  let err = null
  try {
    await A.askJson({
      configId: 'cfg', system: 's', user: 'u', temperature: 0.85,
      validate: () => ({ ok: true, errors: [] }),
      stageName: '变体生成',
    })
  } catch (e) {
    err = e
  }
  check('两次失败抛出 AskJsonError', err?.name === 'AskJsonError', err?.name)
  check('错误文案含阶段名', String(err?.message).includes('[变体生成]'), String(err?.message))
  check('错误文案为中文且可读', String(err?.message).includes('模型输出无法解析'))
  check('错误对象暴露 reason', typeof err?.reason === 'string' && err.reason.length > 0)

  // 结构校验不通过 → 也走修复重试，最终成功
  client.__queue([JSON.stringify({ variants: [] }), JSON.stringify(OK)])
  const r2 = await A.askJson({
    configId: 'cfg', system: 's', user: 'u', temperature: 0.85,
    validate: (o) => { const x = P.validateVariantPayload(o); return { ok: x.ok, errors: x.errors } },
    stageName: '变体生成',
  })
  check('结构校验失败可被修复', !!r2.variants?.length)
  check('修复提示回灌了上一次的错误原因',
    client.__calls()[1].messages[3].content.includes('未返回任何变体'),
    client.__calls()[1].messages[3].content.slice(0, 40))

  // attempts=1 → 不重试
  client.__queue(['bad'])
  let err2 = null
  try {
    await A.askJson({ configId: 'c', system: 's', user: 'u', temperature: 0, validate: () => ({ ok: true, errors: [] }), attempts: 1 })
  } catch (e) { err2 = e }
  check('attempts=1 时只请求一次', client.__calls().length === 1, String(client.__calls().length))
  check('attempts=1 时同样抛出', err2?.name === 'AskJsonError')
}

bestEffortRemove(tmpGuard)
bestEffortRemove(tmpAsk)
bestEffortRemove(tmpVariants)

console.log(`\n${'─'.repeat(48)}`)
console.log(`通过 ${pass} · 失败 ${fail}`)
if (fail > 0) {
  console.log('\n失败项：')
  failures.forEach((f) => console.log(`  - ${f}`))
  process.exit(1)
}
console.log('全部通过 ✓')
