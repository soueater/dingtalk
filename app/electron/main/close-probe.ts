// electron/main/close-probe.ts
// 关闭流程实测探针（仅测试用，未设置 CLOSE_PROBE 时零副作用）。
//
// 为什么需要它：关闭链路横跨「渲染层 dirty 同步 → 主进程 close 决策 → 原生对话框 →
// 渲染层保存 → 主进程放行」五个环节，纯函数单测只能覆盖决策表，无法证明
// 「真实窗口在真实 Electron 里点关闭后确实会关掉」。
// 本探针在真实 Electron 里跑完整流程，用 RESULT 标记给出确定结论。
//
// 用法（由 scripts/probe-close.mjs 驱动，见 package.json 的 test:close）：
//   CLOSE_PROBE=clean                     干净项目 → 应直接关闭
//   CLOSE_PROBE=dirty-discard             有改动 + 选「不保存」→ 应关闭
//   CLOSE_PROBE=dirty-cancel-then-discard 先取消（应保留窗口）再选「不保存」（应关闭）
import { app, dialog, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isCloseGuardDirty, setCloseGuardDirty, _closeGuardState } from './close-guard'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 关键手法：替换 dialog.showMessageBox，让原生断言框按脚本自动作答。
 * 必须替换**同一个 electron 模块对象上的属性**——close-guard 在调用时才查表，
 * 因此这里的改写会被它看到（两者 import 的是同一个对象）。
 */
function scriptDialogs(answers: number[], log: (m: string) => void) {
  let i = 0
  ;(dialog as unknown as { showMessageBox: unknown }).showMessageBox = async () => {
    const a = answers[Math.min(i, answers.length - 1)]
    i += 1
    log(`dialog#${i} 自动作答 = ${a}（0 保存 / 1 不保存 / 2 取消）`)
    return { response: a, checkboxChecked: false }
  }
}

/** 「保存并关闭」场景需要真实落盘：把原生保存对话框改为固定返回一个临时文件 */
function stubSaveDialog(log: (m: string) => void): string {
  const target = path.join(os.tmpdir(), `wshu-close-probe-${Date.now()}.wpx`)
  ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () => {
    log(`showSaveDialog 自动作答 → ${target}`)
    return { canceled: false, filePath: target }
  }
  return target
}

export function attachCloseProbe(win: BrowserWindow) {
  const mode = process.env.CLOSE_PROBE
  if (!mode) return

  const log = (m: string) => console.log(`[close-probe] ${m}`)
  const answers = (process.env.CLOSE_PROBE_ANSWERS || '1').split(',').map((n) => Number(n))
  scriptDialogs(answers, log)

  let done = false
  /** 窗口 closed 事件是否已触发（比 isDestroyed 更早、更可靠） */
  let closedFired = false
  win.on('closed', () => {
    closedFired = true
    log('窗口已触发 closed 事件')
  })

  const finish = (code: number, verdict: string) => {
    if (done) return
    done = true
    log(`state=${JSON.stringify(_closeGuardState())}`)
    log(`RESULT:${verdict}`)
    // 与 smoke 相同的顺序：先注册强退兜底，再 app.exit（后者可能卡住不返回）
    setTimeout(() => {
      try {
        process.exit(code)
      } catch {
        /* ignore */
      }
    }, 400)
    app.exit(code)
  }

  win.webContents.once('did-finish-load', () => {
    void (async () => {
      await sleep(1200) // 等渲染层 React 副作用跑完（含 installCloseGuard）

      if (mode === 'clean') {
        log(`mode=clean dirty=${isCloseGuardDirty()} → win.close()`)
        if (isCloseGuardDirty()) {
          finish(1, 'CLOSE_FAIL_DIRTY_WHEN_CLEAN')
          return
        }
        win.close()
        await sleep(1500)
        finish(closedFired ? 0 : 1, closedFired ? 'CLOSE_OK' : 'CLOSE_STUCK')
        return
      }

      if (mode === 'dirty-discard') {
        setCloseGuardDirty(true)
        log(`mode=dirty-discard dirty=${isCloseGuardDirty()} → win.close()`)
        win.close()
        await sleep(1500)
        finish(closedFired ? 0 : 1, closedFired ? 'CLOSE_OK' : 'CLOSE_STUCK')
        return
      }

      if (mode === 'dirty-cancel-then-discard') {
        setCloseGuardDirty(true)
        log('步骤1：有改动 → close()，对话框作答「取消」')
        win.close()
        await sleep(1500)
        if (closedFired) {
          // 取消却把窗口关了 —— 丢改动的严重错误
          finish(1, 'CLOSE_FAIL_CANCEL_DISCARDED_CHANGES')
          return
        }
        log('STEP1_OK 取消后窗口保留（符合预期）')

        log('步骤2：再次 close()，对话框作答「不保存」→ 应能正常关闭')
        win.close()
        await sleep(1500)
        finish(closedFired ? 0 : 1, closedFired ? 'CLOSE_OK' : 'CLOSE_STUCK_AFTER_CANCEL')
        return
      }

      if (mode === 'dirty-save') {
        // 覆盖用户最容易触发的路径：对话框默认按钮就是「保存并关闭」（回车即走），
        // 它依赖渲染层异步保存 + 原生保存对话框，是最容易「关不掉」的一条。
        const target = stubSaveDialog(log)
        setCloseGuardDirty(true)
        log(`mode=dirty-save dirty=${isCloseGuardDirty()} → win.close()（对话框作答「保存」）`)
        win.close()
        await sleep(3000)
        if (!closedFired) {
          finish(1, 'CLOSE_STUCK_AFTER_SAVE')
          return
        }
        const written = fs.existsSync(target)
        log(`保存产物存在 = ${written}（${target}）`)
        try {
          if (written) fs.rmSync(target, { force: true })
        } catch {
          /* ignore */
        }
        finish(written ? 0 : 1, written ? 'CLOSE_OK' : 'CLOSE_OK_BUT_NOT_SAVED')
        return
      }

      finish(1, `UNKNOWN_MODE_${mode}`)
    })()
  })

  // 兜底：9s 内没结论 → 判定卡死（这正是「关不掉」的典型表现）
  setTimeout(() => {
    if (!done) finish(1, 'CLOSE_STUCK_TIMEOUT')
  }, 9000)
}
