// scripts/smoke.mjs
// 启动自检：以 SMOKE_TEST=1 拉起 Electron，等渲染层加载完成后自行退出。
// 结论判定不依赖子进程退出码，而是抓取主进程输出的 `[smoke] RESULT:PASS|FAIL` 标记，
// 因此即便 Electron 因环境原因无法干净退出，本脚本也能给出确定结论。
//
// 三个必须处理的坑：
//   1. 某些终端环境预设了 ELECTRON_RUN_AS_NODE=1，会让 electron.exe 退化成纯 Node，
//      从而报 `app.isPackaged` 为 undefined。必须显式删除该变量。
//   2. 无显示/无 GPU 的环境（CI、远程会话）下 GPU 进程会反复崩溃并触发 FATAL 退出，
//      因此追加软件渲染与独立 user-data-dir 参数。
//   3. Windows + ConPTY 下用 stdio:'inherit' 会让子进程挂在继承的管道上不退出，
//      故改为 stdio:'pipe'，超时后整棵进程树强杀。
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, rmSync } from 'node:fs'

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)))
const binName = process.platform === 'win32' ? 'electron.exe' : 'electron'
const bin = path.join(root, 'node_modules', 'electron', 'dist', binName)

if (!existsSync(bin)) {
  console.error(`[smoke] 未找到 Electron 二进制：${bin}`)
  console.error('[smoke] 请先执行 `node node_modules/electron/install.js` 补齐。')
  process.exit(2)
}

const userDataDir = path.join(root, '.smoke-profile')
rmSync(userDataDir, { recursive: true, force: true })

const env = { ...process.env, SMOKE_TEST: '1' }
delete env.ELECTRON_RUN_AS_NODE // 关键：否则 electron 会以 Node 模式运行

const args = [
  '.',
  '--disable-gpu',
  '--disable-gpu-compositing',
  '--disable-software-rasterizer',
  '--no-sandbox',
  `--user-data-dir=${userDataDir}`,
]

console.log('[smoke] launching Electron…')
const child = spawn(bin, args, {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

let stdout = ''
let stderr = ''
child.stdout?.on('data', (b) => {
  stdout += b.toString()
})
child.stderr?.on('data', (b) => {
  stderr += b.toString()
})

const TIMEOUT_MS = 30000
let settled = false

/** 强杀整棵进程树：Electron 会派生 GPU/Renderer 等子进程，单杀主进程可能残留 */
function killTree() {
  if (child.pid == null) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      /* ignore */
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }
  }
}

function settle() {
  if (settled) return
  settled = true
  clearTimeout(guard)
  const pass = /\[smoke\] RESULT:PASS/.test(stdout)
  const fail = /\[smoke\] RESULT:FAIL/.test(stdout)
  console.log(stdout.trimEnd())
  if (stderr.trim()) console.error(stderr.trimEnd())
  killTree()
  rmSync(userDataDir, { recursive: true, force: true })

  if (pass && !fail) {
    console.log('[smoke] result = PASS')
    process.exit(0)
  }
  if (fail) {
    console.error('[smoke] result = FAIL (renderer reported fatal errors)')
    process.exit(1)
  }
  console.error('[smoke] result = FAIL (no result marker produced)')
  process.exit(1)
}

// 子进程退出则立即结算（可能标记已输出，也可能未输出）
child.on('exit', () => settle())
child.on('error', (e) => {
  stderr += `\n[spawn-error] ${e.message}`
  settle()
})

// 兜底：即便子进程不退出，30s 后按已抓到的输出结算
const guard = setTimeout(() => {
  if (!settled) console.error('[smoke] 超时，按已捕获输出结算')
  settle()
}, TIMEOUT_MS)
