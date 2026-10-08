// src/components/overlays/PreviewModal.tsx —— 交互预览：真实可点击的原型
import { useEffect, useMemo, useState } from 'react'
import { useUiStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { tokenMapForPage } from '@/services/design/specs'
import { renderNodeWithStates } from '@/services/render/node'
import { Button } from '@/components/ui/Button'
import { IconClose, IconPhone } from '@/components/ui/Icons'

export function PreviewModal() {
  const overlay = useUiStore((s) => s.overlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const design = useProjectStore((s) => s.design)
  const activePageId = useProjectStore((s) => s.activePageId)

  const open = overlay === 'preview'
  const [pageId, setPageId] = useState(activePageId)
  const [history, setHistory] = useState<string[]>([])

  useEffect(() => {
    if (open) {
      setPageId(activePageId)
      setHistory([])
    }
  }, [open, activePageId])

  const page = design.pages.find((p) => p.id === pageId) ?? design.pages[0]
  // F-ST-01：预览按「当前页生效的规范」渲染
  const map = useMemo(
    () => tokenMapForPage(design, page),
    [design, page?.specId],
  )
  const { canvas } = design.meta

  const goTo = (targetId: string) => {
    if (!design.pages.some((p) => p.id === targetId)) return
    setHistory((h) => [...h, pageId])
    setPageId(targetId)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeOverlay()
      if (e.key === 'Backspace' && history.length) {
        e.preventDefault()
        setPageId(history[history.length - 1])
        setHistory((h) => h.slice(0, -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeOverlay, history])

  if (!open || !page) return null

  // 当前页可点击的元素 → 目标页
  const goMap: Record<string, string> = {}
  design.flows.filter((f) => f.fromPage === page.id).forEach((f) => (goMap[f.from] = f.to))

  // F-ST-02：预览态同样注入 states 规则——原型演示时「悬停有反馈、按下有回弹」，
  // 这是本节 DoD 明确要求的「预览处生效」。规则用 [data-id] 锚定，且已加 !important，
  // 可压过节点内联样式。
  const html = renderNodeWithStates(page.root, map)

  // 缩放以适应可视区
  const maxH = typeof window !== 'undefined' ? window.innerHeight - 180 : 700
  const maxW = typeof window !== 'undefined' ? window.innerWidth - 260 : 800
  const scale = Math.min(1, maxH / canvas.height, maxW / canvas.width)

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
      <div className="modal" style={{ width: 'auto', maxWidth: '92vw' }}>
        <div className="modal-head">
          <IconPhone size={15} />
          <span className="title">原型预览</span>
          <span className="subtitle">
            {page.name} · {canvas.width}×{canvas.height} · {Math.round(scale * 100)}%
          </span>
          <div className="flex-1" />
          <select
            className="select"
            style={{ width: 140, height: 28, fontSize: 12 }}
            value={page.id}
            onChange={(e) => {
              setHistory((h) => [...h, pageId])
              setPageId(e.target.value)
            }}
          >
            {design.pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button variant="ghost" size="sm" iconOnly onClick={closeOverlay} title="关闭 (Esc)">
            <IconClose size={14} />
          </Button>
        </div>

        <div
          className="modal-body"
          style={{
            display: 'grid',
            placeItems: 'center',
            background: 'var(--canvas-bg)',
            padding: 'var(--sp-5)',
            minHeight: 420,
          }}
        >
          <div
            style={{
              width: canvas.width * scale,
              height: canvas.height * scale,
              borderRadius: 4,
              overflow: 'hidden',
              boxShadow: '0 20px 60px var(--shadow-color-4)',
              background: 'var(--page-paper)',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: canvas.width,
                height: canvas.height,
                transform: `scale(${scale})`,
                transformOrigin: '0 0',
                position: 'absolute',
                top: 0,
                left: 0,
              }}
            >
              <div
                className="preview-page"
                dangerouslySetInnerHTML={{ __html: html }}
                onClickCapture={(e) => {
                  const el = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null
                  if (!el) return
                  const id = el.getAttribute('data-id')!
                  const to = goMap[id]
                  if (to) {
                    e.preventDefault()
                    e.stopPropagation()
                    goTo(to)
                  }
                }}
                style={{ ['--preview-scale' as string]: scale }}
              />
            </div>

            {/* 可点击区域的视觉提示 */}
            <ClickHints pageId={page.id} goMap={goMap} scale={scale} />
          </div>
        </div>

        <div className="modal-foot">
          <span className="field-hint">
            点击可交互元素可跳转页面 · Backspace 返回上一页 · Esc 退出
          </span>
          <div className="flex-1" />
          {history.length > 0 && (
            <Button
              size="sm"
              onClick={() => {
                setPageId(history[history.length - 1])
                setHistory((h) => h.slice(0, -1))
              }}
            >
              返回上一页
            </Button>
          )}
          {Object.keys(goMap).length === 0 && (
            <span className="badge">当前页无跳转</span>
          )}
        </div>
      </div>
    </div>
  )
}

/** 在当前页上标出可点击元素的位置 */
function ClickHints({
  pageId,
  goMap,
  scale,
}: {
  pageId: string
  goMap: Record<string, string>
  scale: number
}) {
  const [boxes, setBoxes] = useState<Array<{ id: string; x: number; y: number; w: number; h: number }>>([])
  const containerRef = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      const host = document.querySelector('.preview-page')
      if (!host) return
      const base = host.getBoundingClientRect()
      const out: Array<{ id: string; x: number; y: number; w: number; h: number }> = []
      for (const id of Object.keys(goMap)) {
        const el = host.querySelector(`[data-id="${CSS.escape(id)}"]`)
        if (!el) continue
        const r = el.getBoundingClientRect()
        out.push({
          id,
          x: (r.left - base.left) / scale,
          y: (r.top - base.top) / scale,
          w: r.width / scale,
          h: r.height / scale,
        })
      }
      setBoxes(out)
    }, 120)
    return () => clearTimeout(t)
  }, [goMap, scale, pageId])

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}>
      {boxes.map((b) => (
        <div
          key={b.id}
          style={{
            position: 'absolute',
            left: b.x * scale,
            top: b.y * scale,
            width: b.w * scale,
            height: b.h * scale,
            border: '1.5px dashed var(--brand)',
            borderRadius: 3,
          }}
        />
      ))}
    </div>
  )
}
