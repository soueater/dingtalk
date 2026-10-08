// scripts/shot.mjs —— 开发用界面截图（不参与打包、不改变生产代码）
//
// 通过 Electron 的 --remote-debugging-port 建立 CDP 连接，逐个主题截图到 .shots/。
// 仅为「界面优化」时肉眼比对服务：
//     node scripts/shot.mjs            # 截全部主题
//     node scripts/shot.mjs dawn       # 只截指定主题
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)))
const binName = process.platform === 'win32' ? 'electron.exe' : 'electron'
/** SHOT_BIN 可指向已打包的可执行文件，用来验证发布产物（如 SHOT_BIN=package/win-unpacked/望舒.exe） */
const override = process.env.SHOT_BIN
const bin = override
  ? path.resolve(root, override)
  : path.join(root, 'node_modules', 'electron', 'dist', binName)
if (!existsSync(bin)) {
  console.error(`[shot] 未找到可执行文件：${bin}`)
  process.exit(2)
}

const ALL = ['night', 'dawn', 'ocean', 'ink']
const argv = process.argv.slice(2)
const themes = argv.filter((a) => ALL.includes(a))
const list = themes.length ? themes : ALL

/** --clip x,y,w,h[,scale] 只截取局部（排查细节用） */
let clip = null
const ci = argv.findIndex((a) => a === '--clip')
if (ci >= 0 && argv[ci + 1]) {
  const [x, y, w, h, s] = argv[ci + 1].split(',').map(Number)
  clip = { x, y, width: w, height: h, scale: Number.isFinite(s) && s > 0 ? s : 2 }
}

const PORT = 9333
const outDir = path.join(root, '.shots')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

/** --click <selector> 截图前先点一下（用于展开菜单 / 浮层） */
let clickSel = null
const ki = argv.findIndex((a) => a === '--click')
if (ki >= 0 && argv[ki + 1]) clickSel = argv[ki + 1]

/** --eval <js> 截图前执行一段脚本（用于滚动面板、填入表单等） */
let evalJs = null
const ei = argv.findIndex((a) => a === '--eval')
if (ei >= 0 && argv[ei + 1]) evalJs = argv[ei + 1]

const userDataDir = path.join(root, '.shot-profile')
rmSync(userDataDir, { recursive: true, force: true })

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE // 否则 electron 退化成纯 Node

const child = spawn(
  bin,
  [
    '.',
    `--remote-debugging-port=${PORT}`,
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--no-sandbox',
    `--user-data-dir=${userDataDir}`,
  ],
  { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
)
child.stdout?.on('data', (b) => process.stdout.write(`[app] ${b}`))
child.stderr?.on('data', (b) => process.stderr.write(`[app] ${b}`))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 清理临时 profile：文件可能仍被 Electron 占用，失败不影响结论 */
function cleanup() {
  try {
    rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const j = await r.json()
      const page = j.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* 还没起来 */
    }
    await sleep(300)
  }
  return null
}

/** 极简 CDP 客户端：只用到 Runtime.evaluate / Page.captureScreenshot */
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let seq = 0
    const pending = new Map()
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      const p = pending.get(msg.id)
      if (p) {
        pending.delete(msg.id)
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
      }
    }
    ws.onerror = (e) => reject(new Error(String(e?.message ?? 'ws error')))
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          const id = ++seq
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej })
            ws.send(JSON.stringify({ id, method, params }))
          })
        },
        close: () => ws.close(),
      })
  })
}

function killTree() {
  if (child.pid == null) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(-child.pid, 'SIGKILL')
    }
  } catch {
    /* ignore */
  }
}

try {
  const page = await targets()
  if (!page) throw new Error('30s 内未拿到调试目标，应用可能启动失败')
  const cdp = await connect(page.webSocketDebuggerUrl)

  // 等首屏渲染完成
  await cdp.send('Page.enable')
  await sleep(2500)

  for (const theme of list) {
    // 写入 localStorage 后整页重载，走真实启动路径（与用户下次打开一致）
    await cdp.send('Runtime.evaluate', {
      expression: `localStorage.setItem('wangshu.theme', ${JSON.stringify(theme)});location.reload();`,
    })
    await sleep(2200)
    if (clickSel) {
      await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(clickSel)})?.click()`,
      })
      await sleep(600)
    }
    if (evalJs) {
      await cdp.send('Runtime.evaluate', { expression: evalJs })
      await sleep(600)
    }
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      ...(clip ? { clip } : {}),
    })
    const file = path.join(outDir, `${theme}${clip ? '-clip' : ''}${evalJs && !clip ? '-eval' : ''}.png`)
    writeFileSync(file, Buffer.from(shot.data, 'base64'))
    console.log(`[shot] 已保存 ${path.relative(root, file)}`)
  }

  cdp.close()
  killTree()
  cleanup()
  process.exit(0)
} catch (e) {
  console.error(`[shot] 失败：${e.message}`)
  killTree()
  cleanup()
  process.exit(1)
}
