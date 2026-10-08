// scripts/_fsx.mjs
// 删除的「尽力而为」封装。
//
// 为什么需要它：
//   本机 CLI 有一层 safe-delete 守卫，会对「同一回合内累计删除量」做限流
//   （阈值 50，超了直接抛 SAFE_DELETE_BULK_CONFIRM_REQUIRED）。
//   而 `fs.rmSync` 的失败会沿着调用栈把整个进程带崩 —— 于是出现最坏的一种失败：
//   **测试全部跑完并打印了结果，却因为收尾清理被拦而让退出码变成 1**，
//   看起来像「测试挂了」。
//
// 原则：清理属于**副作用**，不能决定结论。删不掉就留个警告，由上层决定是否在意。
// 但**需要前置保证**的删除（如 dist/electron 必须先清干净再重建）不能只用这个 ——
// 那种场景要在删失败后**主动校验产物已就位**。

import fs from 'node:fs'

const warned = new Set()

/**
 * 尽力删除；失败只告警一次，不抛错。
 * @param {string} target 待删除的文件或目录
 * @param {string} [label] 告警里的可读名称，默认用 target
 * @returns {boolean} 是否删成功
 */
export function bestEffortRemove(target, label) {
  try {
    fs.rmSync(target, { recursive: true, force: true })
    return true
  } catch (err) {
    const key = label ?? target
    if (!warned.has(key)) {
      warned.add(key)
      const msg = err && err.message ? err.message.split('\n')[0] : String(err)
      console.warn(`  ⚠ 临时文件清理被跳过（不影响结论）：${key} — ${msg}`)
    }
    return false
  }
}

/** 批量版：全部尽力删除，返回成功计数 */
export function bestEffortRemoveAll(targets) {
  let ok = 0
  for (const t of targets) if (bestEffortRemove(t)) ok += 1
  return ok
}
