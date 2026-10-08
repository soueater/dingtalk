// scripts/clean-renderer.mjs
// 渲染层重建前的清理（`prebuild:renderer` 钩子）。
//
// 为什么不让 vite 自己 `emptyOutDir`：
//   本机 CLI 的 safe-delete 守卫会限流批量删除，vite 的 `prepare-out-dir` 在
//   删 `dist/renderer/assets` 时会直接被拦并**让整个构建失败** ——
//   而此时 123 个模块其实已经转译成功，纯属被清理步骤带崩。
//   因此把清理挪到 vite 之前自己「尽力而为」：正常环境等价于 emptyOutDir，
//   受守卫限制时只告警不阻断（代价是可能残留上一次的 hash 资产，不影响正确性）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bestEffortRemove } from './_fsx.mjs'

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)))
const outDir = path.join(root, 'dist', 'renderer')

const ok = bestEffortRemove(outDir, 'dist/renderer（重建前清理）')
if (ok) console.log('[clean:renderer] 已清空 dist/renderer')
