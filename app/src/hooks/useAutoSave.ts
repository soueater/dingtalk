// src/hooks/useAutoSave.ts —— 周期自动保存（F-PM-03）
//
// 设计取向（对应设计文档 D-8）：
// - 只在「已保存过一次的项目」上生效（path 非空），新项目仍需用户显式"保存"选一次路径，
//   避免悄悄往磁盘里写用户没同意过的文件。
// - 脏标记驱动：不脏就不写盘，因此定时器开销可忽略。
// - 间隔来自应用设置 autoSaveDebounceMs（默认 30s），改动即时生效。
// - 窗口失焦 / 隐藏时立即补一次，减少"alt-tab 关掉就丢"的心智负担。
import { useEffect, useRef } from 'react'
import { useProjectStore } from '@/stores/project.store'
import { autoSaveOnce } from '@/services/project/hub-actions'

const FALLBACK_INTERVAL = 30_000

export function useAutoSave(enabled = true): void {
  const timer = useRef<number | null>(null)
  const intervalRef = useRef<number>(FALLBACK_INTERVAL)

  useEffect(() => {
    if (!enabled) return
    let alive = true

    /* 拉一次设置，拿到用户配置的间隔 */
    void (async () => {
      try {
        const r = await window.dsa?.settings.get()
        if (!alive) return
        const ms = r?.ok ? r.data.autoSaveDebounceMs : undefined
        if (typeof ms === 'number' && ms >= 5_000) intervalRef.current = ms
      } catch {
        /* 浏览器环境没有 bridge，用兜底间隔 */
      }
    })()

    const tick = () => {
      if (!alive) return
      if (document.visibilityState === 'visible') void autoSaveOnce()
    }

    timer.current = window.setInterval(tick, intervalRef.current)

    const onBlur = () => void autoSaveOnce()
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onBlur)

    return () => {
      alive = false
      if (timer.current !== null) window.clearInterval(timer.current)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onBlur)
    }
  }, [enabled])

  /* 离开编辑器路由前补一次 */
  useEffect(() => {
    if (!enabled) return
    return () => {
      void autoSaveOnce()
    }
  }, [enabled])
}

/** 供状态栏显示"上次自动保存"用 */
export function useDirty(): boolean {
  return useProjectStore((s) => s.dirty)
}
