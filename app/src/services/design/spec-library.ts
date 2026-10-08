// src/services/design/spec-library.ts
// 用户级设计规范库（F-PM-06）的渲染层入口。
//
// 与「项目内规范」并存：项目内规范随 .dsproj 走，用户级库跨项目可用。
// 这一层只做 IPC 封装 + 错误吞并，保证 UI 里不必到处判 `window.dsa`。
import type { DesignSpec } from '@shared/design'
import { useUiStore } from '@/stores/ui.store'

const hasBridge = () => typeof window !== 'undefined' && !!window.dsa?.specLibrary

export async function listLibrarySpecs(): Promise<DesignSpec[]> {
  if (!hasBridge()) return []
  try {
    const r = await window.dsa.specLibrary.list()
    return r.ok ? r.data : []
  } catch {
    return []
  }
}

export async function saveSpecToLibrary(spec: DesignSpec): Promise<DesignSpec[]> {
  if (!hasBridge()) return []
  try {
    const r = await window.dsa.specLibrary.upsert(spec)
    if (r.ok) {
      useUiStore.getState().toast('success', `已保存到规范库：${spec.name}`)
      return r.data
    }
    useUiStore.getState().toast('error', r.message)
    return []
  } catch (e) {
    useUiStore.getState().toast('error', (e as Error)?.message ?? '保存规范失败')
    return []
  }
}

export async function removeLibrarySpec(id: string): Promise<DesignSpec[]> {
  if (!hasBridge()) return []
  try {
    const r = await window.dsa.specLibrary.remove(id)
    return r.ok ? r.data : []
  } catch {
    return []
  }
}

/** 主进程抓取 DESIGN.md 原文（渲染层受 CSP/CORS 限制，必须走主进程） */
export async function fetchDesignMd(url: string): Promise<string | null> {
  if (!hasBridge()) return null
  try {
    const r = await window.dsa.designMd.fetch(url)
    if (!r.ok) {
      useUiStore.getState().toast('error', r.message)
      return null
    }
    return r.data.text
  } catch (e) {
    useUiStore.getState().toast('error', (e as Error)?.message ?? '抓取失败')
    return null
  }
}
