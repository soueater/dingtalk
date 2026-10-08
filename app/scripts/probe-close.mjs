// scripts/probe-close.mjs
// 关闭流程实测：在真实 Electron 中验证「点关闭 → 窗口确实关闭」。
//
// 与 smoke.mjs 同样的三个环境坑（ELECTRON_RUN_AS_NODE / 无 GPU / ConPTY 管道），
// 结论一律以主进程输出的 `[close-probe] RESULT:*` 标记为准，不依赖退出码，
// 以期即便 Electron 无法干净退出也能给出确定结论。
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, rmSync } from 'node:fs'

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)))
const binName = process.platform === 'win32' ? 'electron.exe' : 'electron'
const bin = path.join(root, 'node_modules', 'electron', 'dist', binName)

if (!existsSync(bin)) {
  console.error(`[probe-close] 未找到 Electron 二进制：${bin}`)
  process.exit(2)
}

/** 场景：模式 → 期望结论 */
const SCENARIOS = [
  { mode: 'clean', answers: '1', expect: 'CLOSE_OK', desc: '干净项目直接关闭' },
  { mode: 'dirty-discard', answers: '1', expect: 'CLOSE_OK', desc: '有改动 + 选「不保存」→ 关闭' },
  {
    mode: 'dirty-save',
    answers: '0',
    expect: 'CLOSE_OK',
    desc: '有改动 + 选「保存并关闭」（默认按钮）→ 落盘成功且窗口关闭',
  },
  {
    mode: 'dirty-cancel-then-discard',
    answers: '2,1',
    expect: 'CLOSE_OK',
    desc: '先「取消」应保留窗口，再「不保存」应能关闭（验证不会永久卡死）',
  },
]

function runOne(sc) {
  return new Promise((resolve) => {
    const userDataDir = path.join(root, `.probe-profile-${sc.mode}`)
    rmSync(userDataDir, { recursive: true, force: true })

    const env = { ...process.env, CLOSE_PROBE: sc.mode, CLOSE_PROBE_ANSWERS: sc.answers }
    delete env.ELECTRON_RUN_AS_NODE

    const child = spawn(
      bin,
      [
        '.',
        '--disable-gpu',
        '--disable-gpu-compositing',
        '--disable-software-rasterizer',
        '--no-sandbox',
        `--user-data-dir=${userDataDir}`,
      ],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    )

    let out = ''
    child.stdout?.on('data', (b) => (out += b.toString()))
    child.stderr?.on('data', (b) => (out += b.toString()))

    let settled = false
    const killTree = () => {
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

    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(guard)
      killTree()
      rmSync(userDataDir, { recursive: true, force: true })
      const lines = out
        .split('\n')
        .filter((l) => l.includes('[close-probe]'))
        .map((l) => '    ' + l.trim())
      console.log(lines.join('\n'))
      const m = out.match(/\[close-probe\] RESULT:(\S+)/)
      const got = m ? m[1] : '(无结论)'
      const ok = got === sc.expect
      console.log(`  ${ok ? '✓' : '✗'} ${sc.desc} —— 期望 ${sc.expect}，实际 ${got}`)
      resolve(ok)
    }

    child.on('exit', finish)
    child.on('error', (e) => {
      out += `\n[spawn-error] ${e.message}`
      finish()
    })
    const guard = setTimeout(finish, 40000)
  })
}

console.log('[probe-close] 在真实 Electron 中验证关闭流程…\n')
let passed = 0
for (const sc of SCENARIOS) {
  console.log(`▶ 场景：${sc.mode}（${sc.desc}）`)
  if (await runOne(sc)) passed += 1
  console.log('')
}

console.log(`[probe-close] 通过 ${passed} · 失败 ${SCENARIOS.length - passed}`)
if (passed !== SCENARIOS.length) process.exit(1)
console.log('[probe-close] 关闭流程实测全部通过 ✓')
