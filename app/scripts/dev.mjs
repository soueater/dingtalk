// scripts/dev.mjs
// 开发模式：并行启动 Vite dev server 与 Electron（主进程源码变更自动重启）。
import { spawn } from 'node:child_process'
import { createServer } from 'vite'
import { build, context } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)))
const outdir = path.join(root, 'dist', 'electron')
const DEV_URL = 'http://localhost:5273'

rmSync(outdir, { recursive: true, force: true })

// 1) 启动 Vite dev server
const vite = await createServer({ configFile: path.join(root, 'vite.config.ts') })
await vite.listen()
console.log(`[dev] vite ready at ${DEV_URL}`)

// 2) esbuild watch 打包主进程/preload
const base = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: 'inline',
  external: ['electron'],
  logLevel: 'warning',
}

let electronProc = null
let restartTimer = null

function startElectron() {
  if (electronProc) {
    electronProc.removeAllListeners('exit')
    electronProc.kill()
    electronProc = null
  }
  // 清除可能干扰 Electron 启动的环境变量（如被外部 shell 注入的 ELECTRON_RUN_AS_NODE）
  const env = { ...process.env, NODE_ENV: 'development', DEV_SERVER_URL: DEV_URL }
  delete env.ELECTRON_RUN_AS_NODE

  electronProc = spawn(
    path.join(root, 'node_modules', 'electron', 'cli.js'),
    ['.'],
    {
      cwd: root,
      stdio: 'inherit',
      env,
    },
  )
  electronProc.on('exit', (code) => {
    // 用户主动关闭窗口时结束整个开发进程
    if (code === 0 || code === null) process.exit(0)
  })
}

function scheduleRestart() {
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    console.log('[dev] electron source changed, restarting…')
    startElectron()
  }, 150)
}

const mainCtx = await context({
  ...base,
  entryPoints: [path.join(root, 'electron', 'main', 'index.ts')],
  outfile: path.join(outdir, 'main', 'index.js'),
  plugins: [
    {
      name: 'restart-electron',
      setup(b) {
        b.onEnd((r) => {
          if (r.errors.length === 0) scheduleRestart()
        })
      },
    },
  ],
})

const preloadCtx = await context({
  ...base,
  entryPoints: [path.join(root, 'electron', 'preload', 'index.ts')],
  outfile: path.join(outdir, 'preload', 'index.js'),
  plugins: [
    {
      name: 'reload-renderer',
      setup(b) {
        b.onEnd(() => {
          // preload 变更：提示用户刷新，或由 electron 重启覆盖
        })
      },
    },
  ],
})

await mainCtx.watch()
await preloadCtx.watch()

// 3) 首次构建完成后启动 Electron
startElectron()

process.on('SIGINT', () => {
  if (electronProc) electronProc.kill()
  process.exit(0)
})
