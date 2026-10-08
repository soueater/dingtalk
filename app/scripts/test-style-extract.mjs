// scripts/test-style-extract.mjs —— 自定义设计风格「提炼内核」测试
//
// 覆盖 style-extract.ts 的全部纯逻辑（不联网、不依赖 DOM）：
//   ① 色值工具        hex/rgb/hsl 互转、亮度、对比度、混合、可读前景
//   ② CSS 取色        hex6 优先于 hex3、rgb()/hsl()/具名色、频次排序
//   ③ 像素量化        RGBA → 调色板、透明像素跳过、4bit 分箱、采样步长
//   ④ 调色板 → Token  底色锚点、明暗判定、正文色对比度门槛、主色、语义色分档
//   ⑤ HTML 提炼       style 块与 style 属性、body 锚点、圆角/字体/字号/阴影
//   ⑥ 载荷归一化      模型给的部分值采纳、非法值拒绝、缺项兜底
//   ⑦ 结果说明        describeTokens
// 运行：node scripts/test-style-extract.mjs

import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'dist', 'test')
const tmpLib = path.join(outDir, 'style-extract-lib.cjs')

await build({
  entryPoints: [path.join(root, 'src', 'services', 'design', 'style-extract.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: tmpLib,
  logLevel: 'error',
  alias: { '@shared/design': path.join(root, 'shared', 'design.ts') },
})

const require = createRequire(import.meta.url)
const E = require(tmpLib)

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

const COLOR_KEYS = [
  'primary', 'primaryHover', 'primaryActive', 'primarySoft', 'onPrimary',
  'bg', 'surface', 'surfaceAlt', 'border', 'borderStrong',
  'text', 'textSecondary', 'textMuted', 'textInverse',
  'success', 'warning', 'danger', 'info',
]

/* ==================================================================== */
/*                            ① 色值工具                                */
/* ==================================================================== */

group('① 色值工具 · 互转 / 亮度 / 对比度')
{
  check('hexToRgb 六位', JSON.stringify(E.hexToRgb('#3B82F6')) === JSON.stringify({ r: 59, g: 130, b: 246 }))
  check('hexToRgb 三位缩写', JSON.stringify(E.hexToRgb('#fff')) === JSON.stringify({ r: 255, g: 255, b: 255 }))
  check('hexToRgb 不带 #', E.hexToRgb('000000')?.r === 0)
  check('hexToRgb 非法输入 → null', E.hexToRgb('#GGGGGG') === null)
  check('hexToRgb 长度不对 → null', E.hexToRgb('#12345') === null)

  check('rgbToHex 补零大写', E.rgbToHex({ r: 0, g: 0, b: 0 }) === '#000000')
  check('rgbToHex 越界钳制', E.rgbToHex({ r: 300, g: -5, b: 128 }) === '#FF0080')
  const rt = E.hexToRgb('#3B82F6')
  check('hex → rgb → hex 往返一致', E.rgbToHex(rt) === '#3B82F6')

  const red = E.rgbToHsl({ r: 255, g: 0, b: 0 })
  check('红 → h=0 s=1 l=0.5', red.h === 0 && Math.abs(red.s - 1) < 1e-6 && Math.abs(red.l - 0.5) < 1e-6)
  const gray = E.rgbToHsl({ r: 128, g: 128, b: 128 })
  check('灰 → 饱和度 0', gray.s === 0)
  const back = E.hslToRgb({ h: 0, s: 0, l: 0 })
  check('hslToRgb 黑', back.r === 0 && back.g === 0 && back.b === 0)

  check('白色相对亮度 = 1', Math.abs(E.luminance({ r: 255, g: 255, b: 255 }) - 1) < 1e-6)
  check('黑色相对亮度 = 0', E.luminance({ r: 0, g: 0, b: 0 }) === 0)
  check('黑白对比度 = 21', Math.abs(E.contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }) - 21) < 1e-6)
  check('同色对比度 = 1', Math.abs(E.contrastRatio({ r: 1, g: 2, b: 3 }, { r: 1, g: 2, b: 3 }) - 1) < 1e-6)

  const a = { r: 0, g: 0, b: 0 }
  const b = { r: 255, g: 255, b: 255 }
  check('mix t=0 → 取前者', E.rgbToHex(E.mix(a, b, 0)) === '#000000')
  check('mix t=1 → 取后者', E.rgbToHex(E.mix(a, b, 1)) === '#FFFFFF')
  check('mix t=0.5 → 中值', E.rgbToHex(E.mix(a, b, 0.5)) === '#808080')

  check('浅底上选深色前景', E.readableOn({ r: 255, g: 255, b: 255 }) === '#111827')
  check('深底上选浅色前景', E.readableOn({ r: 0, g: 0, b: 0 }) === '#FFFFFF')
  check('主蓝上选白字', E.readableOn({ r: 59, g: 130, b: 246 }) === '#FFFFFF')

  check('nearColor 近似判定', E.nearColor({ r: 10, g: 10, b: 10 }, { r: 15, g: 12, b: 8 }) === true)
  check('nearColor 差异判定', E.nearColor({ r: 10, g: 10, b: 10 }, { r: 200, g: 10, b: 10 }) === false)
}

/* ==================================================================== */
/*                           ② CSS 取色                                 */
/* ==================================================================== */

group('② CSS 取色 · 语法覆盖与优先级')
{
  const p = E.collectCssColors('.a{color:#3B82F6} .b{background:#3B82F6} .c{border:1px solid #ABC}')
  const map = Object.fromEntries(p.map((e) => [e.hex, e.count]))
  check('六位 hex 计数为 2', map['#3B82F6'] === 2, JSON.stringify(map))
  check('三位 hex 展开成六位', map['#AABBCC'] === 1, JSON.stringify(map))

  const sixOnly = E.collectCssColors('#AABBCC')
  check('六位不会被拆成三位误判', sixOnly.length === 1 && sixOnly[0].hex === '#AABBCC', JSON.stringify(sixOnly))

  const rgbs = E.collectCssColors('color: rgb(255, 0, 0); border: 1px solid rgba(0,0,255,0.5)')
  const rgbMap = Object.fromEntries(rgbs.map((e) => [e.hex, e.count]))
  check('rgb() 解析为红', rgbMap['#FF0000'] === 1, JSON.stringify(rgbMap))
  check('rgba() 忽略 alpha 取色', rgbMap['#0000FF'] === 1, JSON.stringify(rgbMap))

  const hsl = E.collectCssColors('color: hsl(120, 100%, 50%)')
  check('hsl() 解析为绿', hsl[0]?.hex === '#00FF00', JSON.stringify(hsl))

  const named = E.collectCssColors('color: white; background: black')
  const namedMap = Object.fromEntries(named.map((e) => [e.hex, e.count]))
  check('具名色 white', namedMap['#FFFFFF'] === 1)
  check('具名色 black', namedMap['#000000'] === 1)

  const order = E.collectCssColors('#111111 #222222 #222222 #333333')
  check('按频次降序', order[0].hex === '#222222' && order[0].count === 2, JSON.stringify(order))

  const none = E.collectCssColors('no colors here at all')
  check('无颜色 → 空数组', Array.isArray(none) && none.length === 0)

  const merged = E.mergePalette([
    { hex: '#3B82F6', count: 1 },
    { hex: '#3B82F7', count: 2 },
    { hex: '#FF0000', count: 5 },
  ])
  check('近似色被合并', merged.length === 2, JSON.stringify(merged))
  check('合并后按计数降序', merged[0].hex === '#FF0000', JSON.stringify(merged))
  check('同色不同大小写视为同色', E.mergePalette([{ hex: '#abcdef', count: 1 }, { hex: '#ABCDEF', count: 1 }]).length === 1)
}

/* ==================================================================== */
/*                          ③ 像素量化                                  */
/* ==================================================================== */

group('③ 像素量化 · RGBA → 调色板')
{
  const white = E.quantizePixels(new Uint8Array([255, 255, 255, 255]), 1)
  check('单个白像素 → #F0F0F0（4bit 分箱）', white[0]?.hex === '#F0F0F0', JSON.stringify(white))

  const twoTone = E.quantizePixels(
    new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]),
    1,
  )
  check('两色计数正确', twoTone[0].count === 2 && twoTone[1].count === 1, JSON.stringify(twoTone))
  check('频次高者在前', twoTone[0].hex === '#F0F0F0', JSON.stringify(twoTone))

  const withAlpha = E.quantizePixels(new Uint8Array([255, 0, 0, 0, 0, 255, 0, 255]), 1)
  check('完全透明像素被跳过', withAlpha.length === 1 && withAlpha[0].hex === '#00F000', JSON.stringify(withAlpha))

  const stepped = E.quantizePixels(
    new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255]),
    3,
  )
  check('采样步长生效（4 像素取 2）', stepped.reduce((s, e) => s + e.count, 0) === 2, JSON.stringify(stepped))

  check('空输入 → 空调色板', E.quantizePixels(new Uint8Array([]), 1).length === 0)
}

/* ==================================================================== */
/*                      ④ 调色板 → Token                                */
/* ==================================================================== */

group('④ 调色板 → Token · 语义映射与完整性')
{
  const light = E.tokensFromPalette([
    { hex: '#FFFFFF', count: 500 },
    { hex: '#1F2937', count: 80 },
    { hex: '#7C3AED', count: 40 },
    { hex: '#10B981', count: 10 },
    { hex: '#EF4444', count: 8 },
  ])
  check('18 个色彩键齐全', COLOR_KEYS.every((k) => typeof light.color[k] === 'string'), JSON.stringify(Object.keys(light.color)))
  check('底色取最高频', light.color.bg === '#FFFFFF', light.color.bg)
  check('正文取中性深色而非高饱和主色', light.color.text === '#1F2937', light.color.text)
  check('主色取高饱和色', light.color.primary === '#7C3AED', light.color.primary)
  check('绿色归入 success', light.color.success === '#10B981', light.color.success)
  check('红色归入 danger', light.color.danger === '#EF4444', light.color.danger)

  // 层次不变式：浅色主题下 底 > 面 > 描边 > 正文
  const L = (hex) => E.luminance(E.hexToRgb(hex))
  check(
    '浅色主题层次单调（bg > surface > surfaceAlt > border > borderStrong > text）',
    L(light.color.bg) > L(light.color.surface) &&
      L(light.color.surface) > L(light.color.surfaceAlt) &&
      L(light.color.surfaceAlt) > L(light.color.border) &&
      L(light.color.border) > L(light.color.borderStrong) &&
      L(light.color.borderStrong) > L(light.color.text),
    [light.color.bg, light.color.surface, light.color.surfaceAlt, light.color.border, light.color.borderStrong, light.color.text].join(' '),
  )
  check('正文与底色对比度达标（AA 4.5）', E.contrastRatio(E.hexToRgb(light.color.text), E.hexToRgb(light.color.bg)) >= 4.5)
  check('onPrimary 在主色上可读', E.contrastRatio(E.hexToRgb(light.color.onPrimary), E.hexToRgb(light.color.primary)) >= 4.5)
  check('textSecondary 比 text 淡', L(light.color.textSecondary) > L(light.color.text))
  check('textMuted 比 textSecondary 更淡', L(light.color.textMuted) > L(light.color.textSecondary))

  const dark = E.tokensFromPalette([
    { hex: '#0F1115', count: 500 },
    { hex: '#E6E9EF', count: 60 },
    { hex: '#4C8DFF', count: 30 },
  ])
  check('深色主题：底色识别为深', E.luminance(E.hexToRgb(dark.color.bg)) < 0.4)
  check('深色主题：正文取浅色', E.luminance(E.hexToRgb(dark.color.text)) > 0.4, dark.color.text)
  check('深色主题：正文对比度达标', E.contrastRatio(E.hexToRgb(dark.color.text), E.hexToRgb(dark.color.bg)) >= 4.5)
  check(
    '深色主题层次单调（bg < surface < surfaceAlt < borderStrong < text）',
    L(dark.color.bg) < L(dark.color.surface) &&
      L(dark.color.surface) < L(dark.color.surfaceAlt) &&
      L(dark.color.borderStrong) < L(dark.color.text),
    [dark.color.bg, dark.color.surface, dark.color.surfaceAlt, dark.color.text].join(' '),
  )

  const hinted = E.tokensFromPalette(
    [
      { hex: '#000000', count: 90 },
      { hex: '#FFFFFF', count: 10 },
      { hex: '#2563EB', count: 5 },
    ],
    { bg: '#FFFFFF', text: '#111827' },
  )
  check('底色锚点优先于频次', hinted.color.bg === '#FFFFFF', hinted.color.bg)
  check('正文锚点被采纳', hinted.color.text === '#111827', hinted.color.text)

  const empty = E.tokensFromPalette([])
  check('空调色板不抛错且给出完整兜底', COLOR_KEYS.every((k) => typeof empty.color[k] === 'string'))
  check('空调色板兜底为浅色主题', empty.color.bg === '#FFFFFF', empty.color.bg)

  const mono = E.tokensFromPalette([{ hex: '#FFFFFF', count: 100 }, { hex: '#111111', count: 10 }])
  check('无高饱和色时主色退化为主题默认', mono.color.primary === '#3B82F6', mono.color.primary)

  const keep = E.tokensFromPalette([{ hex: '#FFFFFF', count: 1 }], {
    keep: { space: { md: 99 }, radius: { sm: 3 } },
  })
  check('keep 透传 space', keep.space.md === 99)
  check('keep 透传 radius', keep.radius.sm === 3)
  check('默认 space 完整', E.tokensFromPalette([]).space.md === 16)
  check('默认阴影四档', Object.keys(E.tokensFromPalette([]).shadow).length === 4)
}

/* ==================================================================== */
/*                          ⑤ HTML 提炼                                 */
/* ==================================================================== */

group('⑤ HTML 提炼 · 结构与样式解析')
{
  const HTML = `<!doctype html><html><head><style>
    html, body { margin: 0; }
    body { background: #FFFFFF; color: #1F2937; font-family: 'Inter', sans-serif; font-size: 15px; }
    .btn { background: #7C3AED; border-radius: 12px; font-size: 14px; box-shadow: 0 4px 16px #000000; }
    .card { border-radius: 20px; }
    .tag { border-radius: 999px; background: #F5F3FF; }
    h1 { font-size: 32px; }
  </style></head>
  <body>
    <h1 style="color: #1F2937">标题</h1>
    <div style="color: #EF4444; font-size: 13px">错误提示</div>
  </body></html>`

  const t = E.extractTokensFromHtml(HTML)
  check('从 body 锚点取到底色', t.color.bg === '#FFFFFF', t.color.bg)
  check('从 body 锚点取到正文色', t.color.text === '#1F2937', t.color.text)
  check('主色提炼为紫色', t.color.primary === '#7C3AED', t.color.primary)
  check('style 属性里的红色归入 danger', t.color.danger === '#EF4444', t.color.danger)
  check('语义色齐全', ['success', 'warning', 'danger', 'info'].every((k) => typeof t.color[k] === 'string'))

  check(
    '圆角阶梯按探测值排序（999px 药丸值归入 full，不参与阶梯）',
    t.radius.sm === 12 && t.radius.md === 20 && t.radius.lg > t.radius.md,
    JSON.stringify(t.radius),
  )
  check('圆角满值固定 999', t.radius.full === 999)
  check('字体族取首选且跳过通用名', t.font.body.family === 'Inter', t.font.body.family)
  check('正文字号取出现最多（15px）', t.font.body.size === 15, String(t.font.body.size))
  check('display 字号取最大值', t.font.display.size >= 32, String(t.font.display.size))
  check('标题字号递减', t.font.h1.size > t.font.h2.size && t.font.h2.size > t.font.h3.size)
  check('caption 字号取最小值', t.font.caption.size === 13, String(t.font.caption.size))
  check('字号阶梯 ≥ 正文字号', t.font.body.size >= t.font.caption.size)
  check('阴影取到 y=4 blur=16', t.shadow.sm.y === 4 && t.shadow.sm.blur === 16, JSON.stringify(t.shadow.sm))
  check('阴影色为 rgba', /^rgba\(/.test(t.shadow.sm.color), t.shadow.sm.color)

  const noStyle = E.extractTokensFromHtml('<html><body><p>纯文本，没有样式</p></body></html>')
  check('无样式 HTML 不抛错', typeof noStyle.color.primary === 'string')
  check('无样式 HTML 用默认底色', noStyle.color.bg === '#FFFFFF', noStyle.color.bg)
  check('无样式 HTML 圆角退化为默认', noStyle.radius.md === 10, JSON.stringify(noStyle.radius))

  const genericOnly = E.extractTokensFromHtml('<style>body{font-family: sans-serif; font-size: 16px}</style>')
  check('仅通用字体族时回退 Inter', genericOnly.font.body.family === 'Inter', genericOnly.font.body.family)

  const anchors = E.pageAnchors('body { background: #0F1115; } html { color: #E6E9EF; }')
  check('pageAnchors 取到 body 背景', anchors.bg === '#0F1115', JSON.stringify(anchors))
  check('pageAnchors 取到 html 文字色', anchors.text === '#E6E9EF', JSON.stringify(anchors))
  const bgOnly = E.pageAnchors('body { background-color: #333333; color: #EEEEEE; }')
  check('background-color 不被误当正文色', bgOnly.text === '#EEEEEE', JSON.stringify(bgOnly))
  check('background-color 被识别为背景', bgOnly.bg === '#333333', JSON.stringify(bgOnly))

  check('sampleStyleText 只取样式', E.sampleStyleText('<style>.a{color:#111111}</style><p>#FFFFFF</p>').includes('#111111'))
  check('sampleStyleText 忽略正文里的颜色', !E.sampleStyleText('<style>.a{color:#111111}</style><p>#FFFFFF</p>').includes('#FFFFFF'))
  check('collectPxValues 多位写法', JSON.stringify(E.collectPxValues('a{border-radius:8px 12px}', 'border-radius')) === '[8,12]')
  check('dominantFontFamily 取最高频', E.dominantFontFamily("body{font-family:A} p{font-family:A} i{font-family:B}") === 'A')
}

/* ==================================================================== */
/*                       ⑥ 载荷归一化                                   */
/* ==================================================================== */

group('⑥ normalizeSpecTokens · 采纳有效值 / 拒绝非法值 / 缺项兜底')
{
  const partial = E.normalizeSpecTokens({
    color: { primary: '#FF00AA', bg: '#101010', nonsense: 'not-a-color' },
    font: { body: { family: 'Roboto', size: 16, weight: 500, lineHeight: 24 } },
    radius: { md: 14 },
  })
  check('采纳模型给的主色', partial.color.primary === '#FF00AA', partial.color.primary)
  check('采纳模型给的底色', partial.color.bg === '#101010', partial.color.bg)
  check('非颜色值被丢弃', partial.color.nonsense === undefined)
  check('缺失的颜色键被补齐', COLOR_KEYS.every((k) => typeof partial.color[k] === 'string'))
  check('采纳模型给的字体', partial.font.body.family === 'Roboto' && partial.font.body.size === 16)
  check('采纳模型给的圆角', partial.radius.md === 14)
  check('缺失的圆角键被补齐', partial.radius.sm > 0 && partial.radius.full === 999)
  check('字体阶梯八档齐全', Object.keys(partial.font).length === 8, JSON.stringify(Object.keys(partial.font)))
  check('阴影四档齐全', Object.keys(partial.shadow).length === 4)

  const bad = E.normalizeSpecTokens({
    color: { primary: 'javascript:alert(1)', bg: 'rgb(1,2,3)' },
    font: { body: { size: 9999, family: '' } },
    radius: { md: -5 },
  })
  check('非颜色字符串被拒', bad.color.primary !== 'javascript:alert(1)', bad.color.primary)
  check('rgb() 形式被接受', bad.color.bg === 'rgb(1,2,3)', bad.color.bg)
  check('越界字号被拒并回退', bad.font.body.size === 15, String(bad.font.body.size))
  check('空字体名被拒并回退', bad.font.body.family === 'Inter', bad.font.body.family)
  check('负数圆角被拒', bad.radius.md !== -5, String(bad.radius.md))

  const junk = E.normalizeSpecTokens('完全不是对象')
  check('垃圾输入不抛错', typeof junk.color.primary === 'string')
  check('垃圾输入给出完整 Token', COLOR_KEYS.every((k) => typeof junk.color[k] === 'string'))

  const sizes = E.deriveFontTokens([15, 15, 15, 32, 13], 'Inter')
  check('deriveFontTokens 正文取众数', sizes.body.size === 15, String(sizes.body.size))
  check('deriveFontTokens display 不小于最大探测值', sizes.display.size >= 32, String(sizes.display.size))
  check('deriveFontTokens 全部使用给定字体', Object.values(sizes).every((f) => f.family === 'Inter'))
  const noSizes = E.deriveFontTokens([], 'Inter')
  check('无字号时给出可用阶梯', noSizes.body.size === 15 && noSizes.display.size > noSizes.body.size)

  const radii = E.deriveRadiusTokens([])
  check('无圆角时给出默认阶梯', radii.sm === 6 && radii.full === 999)
  const oneRadius = E.deriveRadiusTokens([8])
  check('单个圆角时外推其余档位', oneRadius.sm === 8 && oneRadius.md > 8 && oneRadius.lg > oneRadius.md)
  const clamped = E.deriveRadiusTokens([-3, 0, 8, 800])
  check('越界圆角被过滤', clamped.sm === 0, JSON.stringify(clamped))
}

/* ==================================================================== */
/*                       ⑦ 结果说明                                     */
/* ==================================================================== */

group('⑦ describeTokens · 提炼结果可读化')
{
  const t = E.extractTokensFromHtml('<style>body{background:#FFFFFF;color:#111827} .b{background:#7C3AED}</style>')
  const desc = E.describeTokens(t)
  check('输出非空', desc.length > 0, JSON.stringify(desc))
  check('包含主色', desc.some((d) => d.startsWith('主色')), JSON.stringify(desc))
  check('包含底色', desc.some((d) => d.startsWith('底色')), JSON.stringify(desc))
  check('包含字体', desc.some((d) => d.startsWith('字体')), JSON.stringify(desc))
  check('每项都是字符串', desc.every((d) => typeof d === 'string' && d.length > 0))
}

/* ==================================================================== */

console.log(`\n通过 ${pass} · 失败 ${fail}`)
if (fail > 0) {
  console.log('\n失败明细：')
  failures.forEach((f) => console.log(`  · ${f}`))
  process.exit(1)
}
console.log('全部通过 ✓')
