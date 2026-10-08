// src/services/project/thumbnail.ts
// 项目缩略图（F-PM-02）：把项目首个界面渲染成 PNG 并交给主进程缓存。
//
// 为什么不放进 .dsproj：base64 图会让项目文件体积膨胀数倍、破坏可读性与可 diff 性。
// 缩略图属于**可重建的展示缓存**，因此单独存放在 userData/thumbnails/。
import type { DesignJSON } from '@shared/design'
import { pageHtmlForRender } from '@/services/export/builder'
import { useUiStore } from '@/stores/ui.store'
import { useWorkspaceStore } from '@/stores/workspace.store'

const hasBridge = () => typeof window !== 'undefined' && !!window.dsa?.project?.thumb

/** 同一时刻只跑一个缩略图渲染任务 —— 每次渲染都要开一个隐藏窗口，并发会拖垮界面 */
let running: Promise<void> = Promise.resolve()

/**
 * 为项目渲染并缓存缩略图。
 * 取「第一个界面」作代表：项目中心的卡片只需要一眼分辨项目，不需要全貌。
 */
export function renderProjectThumbnail(projectId: string, design: DesignJSON): Promise<void> {
  if (!hasBridge()) return Promise.resolve()
  running = running
    .catch(() => undefined)
    .then(async () => {
      const page = [...design.pages].sort((a, b) => a.order - b.order)[0]
      if (!page) return
      try {
        const html = pageHtmlForRender(design, page.id)
        const r = await window.dsa.project.thumb.render(projectId, {
          id: page.id,
          name: page.name,
          width: design.meta.canvas.width,
          height: design.meta.canvas.height,
          html,
        })
        if (r.ok && r.data) {
          // 让项目中心立刻用上新图，无需重新扫描目录
          useWorkspaceStore.setState((s) => ({
            projects: s.projects.map((p) =>
              p.id === projectId ? { ...p, thumbnail: `${projectId}.png` } : p,
            ),
          }))
        }
      } catch {
        /* 缩略图失败不影响任何主流程，静默忽略 */
      }
    })
  return running
}

/** 读取缩略图 dataUrl 用于展示 */
export async function loadThumbnail(projectId: string): Promise<string | null> {
  if (!hasBridge()) return null
  try {
    const r = await window.dsa.project.thumb.get(projectId)
    return r.ok ? r.data : null
  } catch {
    return null
  }
}

/**
 * 保存项目后刷新缩略图（节流：同一项目 5 秒内只刷一次）。
 * 用「保存」而不是「每次 commit」触发 —— 渲染成本高，且未保存的内容无需入卡片。
 */
const lastRun = new Map<string, number>()
const THROTTLE_MS = 5000

export function refreshThumbnailAfterSave(projectId: string, design: DesignJSON): void {
  const now = Date.now()
  const prev = lastRun.get(projectId) ?? 0
  if (now - prev < THROTTLE_MS) return
  lastRun.set(projectId, now)
  void renderProjectThumbnail(projectId, design)
}

/** 供 UI 在缩略图缺失时补一次（并给出非常轻的提示，避免用户以为界面坏了） */
export async function ensureThumbnail(projectId: string, design: DesignJSON): Promise<void> {
  const has = await loadThumbnail(projectId)
  if (has) return
  useUiStore.getState().toast('info', '正在生成项目缩略图…')
  await renderProjectThumbnail(projectId, design)
}
