// scripts/build-electron.mjs
// 用 esbuild 把 electron/main 与 electron/preload 分别打包为 CJS。
// 主进程用 CJS（Electron 默认加载方式最稳），preload 亦用 CJS。
import { build } from 'esbuild'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { bestEffortRemove } from './_fsx.mjs'

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)))
const outdir = path.join(root, 'dist', 'electron')

// 先清空再重建，避免源文件被删后留下陈旧产物。
// 本机 CLI 的 safe-delete 守卫会限流批量删除 —— 清不掉**不能**让构建直接失败
// （那是在「构建还没开始」时就崩，比留着陈旧文件更糟）；改为告警 + 构建后校验产物已就位。
bestEffortRemove(outdir, 'dist/electron（重建前清理）')

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
  // electron 由运行时提供，不打包
  external: ['electron'],
}

const outputs = [
  [path.join(root, 'electron', 'main', 'index.ts'), path.join(outdir, 'main', 'index.js')],
  [path.join(root, 'electron', 'preload', 'index.ts'), path.join(outdir, 'preload', 'index.js')],
]

for (const [entry, outfile] of outputs) {
  await build({ ...common, entryPoints: [entry], outfile })
}

// 校验：两个入口都必须真实落盘且非空 —— 否则「清理被跳过」可能掩盖了构建失败
let bad = 0
for (const [, outfile] of outputs) {
  const rel = path.relative(root, outfile)
  const ok = existsSync(outfile) && statSync(outfile).size > 0
  console.log(`[build:electron] ${ok ? '✓' : '✗'} ${rel}`)
  if (!ok) bad += 1
}
if (bad > 0) {
  console.error(`[build:electron] 有 ${bad} 个产物缺失或为空`)
  process.exit(1)
}

console.log('[build:electron] done')

