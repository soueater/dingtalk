// src/services/project/actions.ts
// 项目级动作：新建 / 打开 / 保存 / 另存为 / 导出 / 关闭（含未保存确认）
import type { ExportFormat } from '@shared/design'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'
import { ApiError } from '@/services/config'
import { buildExportPayload } from '@/services/export/builder'

const hasBridge = () => typeof window !== 'undefined' && !!window.dsa

function unwrap<T>(r: { ok: true; data: T } | { ok: false; code: string; message: string; detail?: string }): T {
  if (r.ok) return r.data
  throw new ApiError(r.code, r.message, r.detail)
}

/** 有未保存改动时向用户确认；返回 true 表示可以继续 */
async function confirmDiscard(): Promise<boolean> {
  const { dirty } = useProjectStore.getState()
  if (!dirty) return true
  return window.confirm('当前项目有未保存的改动，确定要放弃吗？')
}

export async function newProject(): Promise<void> {
  if (!(await confirmDiscard())) return
  const { newProject: create } = useProjectStore.getState()
  create('MOBILE')
  useUiStore.getState().toast('info', '已新建空白项目')
}

export async function openProject(filePath?: string): Promise<void> {
  if (!(await confirmDiscard())) return
  if (!hasBridge()) {
    useUiStore.getState().toast('error', '文件系统仅在桌面客户端中可用')
    return
  }
  try {
    const res = filePath
      ? unwrap(await window.dsa.project.open(filePath))
      : unwrap(await window.dsa.project.openByDialog())
    if (!res) return
    useProjectStore.getState().loadProject(res.path, res.project)
    useUiStore.getState().toast('success', `已打开「${res.project.design.meta.name}」`)
  } catch (e) {
    useUiStore.getState().toast('error', e instanceof ApiError ? e.message : '打开失败')
  }
}

export async function saveProject(): Promise<boolean> {
  const { path, design, markSaved } = useProjectStore.getState()
  if (!hasBridge()) {
    useUiStore.getState().toast('error', '文件系统仅在桌面客户端中可用')
    return false
  }
  try {
    if (!path) return await saveProjectAs()
    unwrap(await window.dsa.project.save(path, { fileVersion: '1.0', design }))
    markSaved(path)
    useUiStore.getState().toast('success', '已保存')
    return true
  } catch (e) {
    useUiStore.getState().toast('error', e instanceof ApiError ? e.message : '保存失败')
    return false
  }
}

export async function saveProjectAs(): Promise<boolean> {
  const { design, markSaved } = useProjectStore.getState()
  if (!hasBridge()) return false
  try {
    const res = unwrap(
      await window.dsa.project.saveAs({ fileVersion: '1.0', design }, design.meta.name),
    )
    if (!res) return false
    markSaved(res.path)
    useUiStore.getState().toast('success', '已保存到新位置')
    return true
  } catch (e) {
    useUiStore.getState().toast('error', e instanceof ApiError ? e.message : '保存失败')
    return false
  }
}

export async function exportProject(format?: ExportFormat): Promise<void> {
  if (!hasBridge()) {
    useUiStore.getState().toast('error', '导出仅在桌面客户端中可用')
    return
  }
  const fmt: ExportFormat = format ?? 'html-single'

  // JSON 走独立分支（不需要渲染层参与）
  const { design } = useProjectStore.getState()
  try {
    const isDir = fmt === 'png' || fmt === 'html-multi'
    const target = unwrap(await window.dsa.exporter.pickTarget(fmt, design.meta.name, isDir))
    if (!target) return

    useUiStore.getState().toast('info', '正在导出…')
    const payload = await buildExportPayload(fmt)
    const res = unwrap(await window.dsa.exporter.write({ ...payload, targetPath: target }))

    if (res.ok) {
      useUiStore.getState().toast('success', res.message)
      void window.dsa.project.revealInFolder(res.path ?? target)
    } else {
      useUiStore.getState().toast('error', res.message)
    }
  } catch (e) {
    useUiStore.getState().toast('error', e instanceof ApiError ? e.message : '导出失败')
  }
}

export async function revealProjectFolder(): Promise<void> {
  const { path } = useProjectStore.getState()
  if (path && hasBridge()) await window.dsa.project.revealInFolder(path)
}
