// src/hooks/useKeyboard.ts —— 全局快捷键
import { useEffect } from 'react'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'
import { newProject, openProject, saveProject, saveProjectAs } from '@/services/project/actions'
import { patchNode } from '@/components/canvas/Canvas'

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  if (!t) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
}

export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const ui = useUiStore.getState()
      const ps = useProjectStore.getState()

      // 弹窗内的 Esc 由弹窗自己处理
      if (e.key === 'Escape' && !ui.overlay) {
        if (isTyping(e.target)) (e.target as HTMLElement).blur()
        else ps.clearSelection()
        return
      }
      if (ui.overlay) return

      // 删除选中元素
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping(e.target) && ps.selectedIds.length) {
        e.preventDefault()
        const ids = new Set(ps.selectedIds)
        const page = ps.currentPage()
        if (!page) return
        // 不允许删除根节点
        ps.commit('删除元素', (d) => ({
          ...d,
          pages: d.pages.map((p) => {
            if (p.id !== page.id) return p
            const removeIn = (n: import('@shared/design').Node): import('@shared/design').Node => {
              if (!n.children?.length) return n
              return { ...n, children: n.children.filter((c) => !ids.has(c.id)).map(removeIn) }
            }
            return { ...p, root: removeIn(p.root) }
          }),
        }))
        ps.clearSelection()
        return
      }

      // 复制选中元素
      if (mod && e.key.toLowerCase() === 'd' && ps.selectedIds.length) {
        e.preventDefault()
        duplicateSelected()
        return
      }

      if (!mod) return

      switch (e.key.toLowerCase()) {
        case 'n':
          e.preventDefault()
          void newProject()
          break
        case 'o':
          e.preventDefault()
          void openProject()
          break
        case 's':
          e.preventDefault()
          if (e.shiftKey) void saveProjectAs()
          else void saveProject()
          break
        case 'e':
          e.preventDefault()
          ui.openOverlay('export')
          break
        case 'p':
          e.preventDefault()
          ui.openOverlay('preview')
          break
        case 'z':
          e.preventDefault()
          if (e.shiftKey) ps.redo()
          else ps.undo()
          break
        case 'y':
          e.preventDefault()
          ps.redo()
          break
        case 'a':
          if (!isTyping(e.target)) {
            e.preventDefault()
            const page = ps.currentPage()
            if (page) ps.select([page.root.id])
          }
          break
        case '1':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('app:zoom-fit'))
          break
        case '0':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('app:zoom-100'))
          break
      }

      if (e.key === ',') {
        e.preventDefault()
        ui.openOverlay('settings')
      }
      if (e.key === '/') {
        e.preventDefault()
        ui.openOverlay('help')
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** 复制选中元素到同级位置 */
function duplicateSelected() {
  const ps = useProjectStore.getState()
  const page = ps.currentPage()
  if (!page || !ps.selectedIds.length) return

  const targets = new Set(ps.selectedIds)
  const clones: Array<{ parentId: string; node: import('@shared/design').Node }> = []

  const walk = (n: import('@shared/design').Node) => {
    n.children?.forEach((c) => {
      if (targets.has(c.id)) {
        const copy: import('@shared/design').Node = JSON.parse(JSON.stringify(c))
        reassignIds(copy)
        copy.layout = { ...(copy.layout ?? {}), x: (copy.layout?.x ?? 0) + 16, y: (copy.layout?.y ?? 0) + 16 }
        copy.name = `${copy.name ?? copy.type} 副本`
        clones.push({ parentId: n.id, node: copy })
      }
      walk(c)
    })
  }
  walk(page.root)

  if (!clones.length) return

  ps.commit('复制元素', (d) => ({
    ...d,
    pages: d.pages.map((p) => {
      if (p.id !== page.id) return p
      let root = p.root
      for (const { parentId, node } of clones) {
        root = patchNode(root, parentId, (n) => ({ ...n, children: [...(n.children ?? []), node] }))
      }
      return { ...p, root }
    }),
  }))
  ps.select(clones.map((c) => c.node.id))
}

function reassignIds(node: import('@shared/design').Node) {
  node.id = `${node.id}_c${Math.random().toString(36).slice(2, 6)}`
  node.children?.forEach(reassignIds)
}
