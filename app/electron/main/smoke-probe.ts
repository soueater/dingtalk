// electron/main/smoke-probe.ts
// 无人值守启动自检：设置 SMOKE_TEST=1 时，等渲染层加载完成、收集控制台错误，
// 随后自行退出并给出退出码。生产环境（未设置该变量）完全无副作用。
import { app, type BrowserWindow } from 'electron'

export function attachSmokeProbe(win: BrowserWindow) {
  if (!process.env.SMOKE_TEST) return
  const consoleErrors: string[] = []
  let done = false

  const finish = (code: number) => {
    if (done) return
    done = true
    // 先用一行可被父进程识别的标记输出结论（父进程按此判定，不依赖退出码）
    if (code === 0) {
      console.log('[smoke] OK renderer loaded, no fatal errors')
      console.log('[smoke] RESULT:PASS')
    } else {
      console.error(`[smoke] FAILED\n${consoleErrors.join('\n')}`)
      console.error('[smoke] RESULT:FAIL')
    }
    // 关键顺序：必须先注册强退兜底，再调用 app.exit。
    // app.exit() 是同步调用，在部分环境（无 GPU / 管道 stdio）下可能卡住不返回，
    // 一旦把它写在前面，后面的定时器就永远注册不上，进程会挂死。
    setTimeout(() => {
      try {
        process.exit(code)
      } catch {
        /* ignore */
      }
    }, 400)
    app.exit(code)
  }

  win.webContents.on('console-message', (_e, level, message) => {
    // level: 3 = error
    if (level >= 3) consoleErrors.push(`[console] ${message}`)
  })

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    consoleErrors.push(`[did-fail-load] ${code} ${desc}`)
    finish(1)
  })

  win.webContents.on('render-process-gone', (_e, details) => {
    consoleErrors.push(`[render-process-gone] ${details.reason}`)
    finish(1)
  })

  win.webContents.once('did-finish-load', () => {
    // 留一段时间让 React 首帧与副作用跑完
    setTimeout(() => finish(consoleErrors.length ? 1 : 0), 1500)
  })

  // 兜底：15s 内没结果则判定启动失败
  setTimeout(() => {
    consoleErrors.push('[timeout] renderer did not finish loading in 15s')
    finish(1)
  }, 15000)
}
