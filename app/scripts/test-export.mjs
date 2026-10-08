// scripts/test-export.mjs
// 导出产物测试：验证 HTML/SVG 自包含、结构正确、无外部依赖
// 运行：node scripts/test-export.mjs

import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { bestEffortRemove } from './_fsx.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'dist', 'test')
const tmp = path.join(outDir, 'export.cjs')

await build({
  entryPoints: [path.join(root, 'src', 'services', 'export', 'builder.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: tmp,
  logLevel: 'error',
  loader: { '.css': 'text' },
  alias: {
    '@/services/mock/projects': path.join(root, 'scripts', 'stub-projects.js'),
    '@/services/design/style-presets': path.join(root, 'scripts', 'stub-presets.js'),
    '@/services/render/tokens': path.join(root, 'src', 'services', 'render', 'tokens.ts'),
    '@/services/render/node': path.join(root, 'src', 'services', 'render', 'node.ts'),
    '@/services/export/canvas-css': path.join(root, 'scripts', 'stub-canvas-css.js'),
    '@shared/design': path.join(root, 'shared', 'design.ts'),
    // store 用最小替身（buildExportPayload 需要读取 design）
    '@/stores/project.store': path.join(root, 'scripts', 'stub-store.js'),
  },
})

const require = createRequire(import.meta.url)
const { buildExportPayload, pageHtmlForRender } = require(tmp)

/* Schema 版本取自唯一事实来源，断言里不写死字面量（升版不应误报回归） */
const designTmp = path.join(outDir, 'export-design.cjs')
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

/* ------------------------------ HTML 单文件 ------------------------------ */

group('HTML 单文件导出')
{
  const p = await buildExportPayload('html-single')
  const html = p.files?.[0]?.content ?? ''

  check('产出 1 个文件', p.files?.length === 1)
  check('含 DOCTYPE', html.startsWith('<!doctype html>'))
  check('含 charset', html.includes('charset="utf-8"'))
  check('含页面标题', html.includes('登录页'))
  check('无外部 script 引用', !/<script[^>]+src=/i.test(html))
  check('无外部 link 引用', !/<link[^>]+href="http/i.test(html))
  check('样式为内联', html.includes('<style>'))
  check('含页面切换标签', html.includes('class="tab"'))
  check('含两个页面区块', (html.match(/class="pg"/g) ?? []).length === 2)
  check('渲染出了节点', html.includes('data-id='))
  check('无未替换的 Token 引用', !/\$color\.[a-zA-Z]+/.test(html), (html.match(/\$color\.[a-zA-Z]+/g) ?? [])[0] ?? '')
  check('无 CSS 变量残留到颜色位置', !/background:\s*\$/.test(html))
}

/* ------------------------------ HTML 工程 ------------------------------ */

group('HTML 工程导出')
{
  const p = await buildExportPayload('html-multi')
  const files = p.files ?? []

  check('含 index.html', files.some((f) => f.name === 'index.html'))
  check('每页一个 html', files.filter((f) => f.name.startsWith('page-')).length === 2)
  check('附带 design.json 源文件', files.some((f) => f.name === 'design.json'))

  const idx = files.find((f) => f.name === 'index.html')?.content ?? ''
  check('index 含页面链接', idx.includes('page-') && idx.includes('登录页'))

  const designFile = files.find((f) => f.name === 'design.json')?.content ?? ''
  let parsed = null
  try {
    parsed = JSON.parse(designFile)
  } catch {
    /* 保持 null */
  }
  check('design.json 可解析', parsed !== null)
  check('design.json 含完整 design', !!parsed?.design?.pages?.length)

  const pageFile = files.find((f) => f.name.startsWith('page-'))?.content ?? ''
  check('页面文件含跳转脚本', pageFile.includes('addEventListener'))
}

/* -------------------------------- SVG -------------------------------- */

group('SVG 导出')
{
  const p = await buildExportPayload('svg')
  const svg = p.files?.[0]?.content ?? ''

  check('以 svg 标签开头', svg.trimStart().startsWith('<svg'))
  check('含 xmlns', svg.includes('xmlns="http://www.w3.org/2000/svg"'))
  check('含正确 viewBox', /viewBox="0 0 \d+ \d+"/.test(svg))
  check('用 foreignObject 包裹', svg.includes('<foreignObject'))
  check('含节点内容', svg.includes('data-id='))
}

/* -------------------------------- PNG -------------------------------- */

group('PNG 渲染载荷')
{
  const p = await buildExportPayload('png')
  check('为每页准备 HTML', p.pages?.length === 2)
  check('携带画布尺寸', p.pages?.[0]?.width === 390 && p.pages?.[0]?.height === 844)
  check('PNG 页面 HTML 自包含', (p.pages?.[0]?.html ?? '').includes('<style>'))
  check('PNG 页面 HTML 不含跳转脚本', !(p.pages?.[0]?.html ?? '').includes('location.href'))
  check('默认 2 倍图', p.scale === 2)
}

/* -------------------------------- JSON -------------------------------- */

group('JSON 导出')
{
  const p = await buildExportPayload('json')
  check('携带完整 design', !!p.design?.pages?.length)
  check('含 schemaVersion', p.design?.schemaVersion === SCHEMA_VERSION, p.design?.schemaVersion)
}

/* -------------------------- 单页 HTML 渲染源 -------------------------- */

group('单页 HTML 渲染源')
{
  const html = pageHtmlForRender(require(path.join(root, 'scripts', 'stub-store.js')).__testDesign, 'page_login')
  check('含根容器', html.includes('class="page-root"'))
  check('宽度固定为画布宽', html.includes('width:390px'))
}

/* ------------------------------ 产物落盘 ------------------------------ */

group('产物落盘检查')
{
  const p = await buildExportPayload('html-single')
  const outFile = path.join(outDir, 'sample-export.html')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outFile, p.files?.[0]?.content ?? '', 'utf8')
  const size = fs.statSync(outFile).size
  check('文件已写出', size > 1000, `${size} bytes`)
  console.log(`    → ${outFile} (${(size / 1024).toFixed(1)} KB)`)
}

bestEffortRemove(tmp)

console.log(`\n${'─'.repeat(48)}`)
console.log(`通过 ${pass} · 失败 ${fail}`)
if (fail > 0) {
  console.log('\n失败项：')
  failures.forEach((f) => console.log(`  - ${f}`))
  process.exit(1)
}
console.log('全部通过 ✓')
