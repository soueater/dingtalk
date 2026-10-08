// src/components/overlays/VariantModal.tsx —— 变体选择：并排预览多个方案，挑选后采纳
import { useEffect, useMemo, useState } from 'react'
import { useUiStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { useConfigStore } from '@/stores/config.store'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { CheckRow } from '@/components/ui/Field'
import { IconSparkles, IconCheck, IconRefresh } from '@/components/ui/Icons'
import { tokenMapForPage } from '@/services/design/specs'
import { renderNode } from '@/services/render/node'
import { computeThumbGeometry } from '@/lib/thumb-geometry'
import {
  ASPECT_META,
  MAX_VARIANTS,
  type Variant,
  type VariantAspect,
  applyVariant,
  generateVariants,
} from '@/services/ai/variants'

export function VariantModal() {
  const overlay = useUiStore((s) => s.overlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const toast = useUiStore((s) => s.toast)
  const design = useProjectStore((s) => s.design)
  const activePageId = useProjectStore((s) => s.activePageId)
  const cfg = useConfigStore((s) => s.current())

  const open = overlay === 'variants'
  const page = design.pages.find((p) => p.id === activePageId)
  // F-ST-01：变体基线与候选缩略图统一按「当前页生效的规范」渲染
  const map = useMemo(() => tokenMapForPage(design, page), [design, page?.specId])
  const { canvas } = design.meta

  const [aspects, setAspects] = useState<VariantAspect[]>(['layout', 'color'])
  const [count, setCount] = useState(3)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [variants, setVariants] = useState<Variant[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [baseHtml, setBaseHtml] = useState('')
  /** 视口宽度：驱动缩略图尺寸计算，窗口缩放时同步 */
  const [viewportW, setViewportW] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))

  // 打开时清空上次结果（基线内容由下面那个 effect 负责刷新）
  useEffect(() => {
    if (!open) return
    setVariants([])
    setPicked(null)
    setProgress({ done: 0, total: 0 })
  }, [open, page?.id])

  /**
   * 基线缩略图内容。
   * 依赖里显式带上 page?.root 与 map —— 只有 [open, page?.id] 时，
   * 切换主题/Token 或编辑页面后基线不会刷新，用户看到的是过期对照图。
   * 已生成变体后不再刷新，避免对手头的候选方案造成视觉跳变。
   */
  useEffect(() => {
    if (!open || !page) return
    if (variants.length > 0) return
    setBaseHtml(renderNode(page.root, map))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, page?.id, page?.root, map])

  // 视口变化重算缩略图宽度
  useEffect(() => {
    if (!open) return
    const onResize = () => setViewportW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open])

  if (!open || !page) return null

  const toggleAspect = (id: VariantAspect) => {
    setAspects((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const onGenerate = async () => {
    if (!cfg) {
      toast('warn', '尚未配置模型，请先完成模型配置')
      useUiStore.getState().openOverlay('settings')
      return
    }
    if (!aspects.length) {
      toast('warn', '请至少选择一个差异化维度')
      return
    }
    setLoading(true)
    setVariants([])
    setPicked(null)
    setProgress({ done: 0, total: count })
    try {
      const list = await generateVariants({
        configId: cfg.id,
        pageId: page.id,
        aspects,
        count,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      setVariants(list)
      // 自动选中第一个**可采纳**的方案（失败占位项不可选）
      const firstOk = list.find((v) => !v.error)
      setPicked(firstOk?.id ?? null)
      const failed = list.filter((v) => v.error).length
      if (failed) toast('warn', `已生成 ${list.length} 个变体，其中 ${failed} 个失败`)
      else toast('success', `已生成 ${list.length} 个变体`)
    } catch (e) {
      toast('error', `变体生成失败：${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  const onApply = () => {
    const v = variants.find((x) => x.id === picked)
    if (!v || v.error) return
    applyVariant(page.id, v)
    toast('success', `已采纳变体：${v.rationale}`)
    closeOverlay()
  }

  // 缩放：让每个缩略图适应可用宽度（含最小值保护，见 lib/thumb-geometry.ts）
  const geo = computeThumbGeometry(variants.length + 1, viewportW, canvas.width, canvas.height)
  const { width: thumbW, height: thumbH, scale: thumbScale } = geo

  return (
    <Modal
      open={open}
      title="生成设计变体"
      subtitle={`基于「${page.name}」生成多个差异化方案，挑选最满意的一个`}
      width={Math.min(1180, window.innerWidth - 120)}
      onClose={closeOverlay}
      footer={
        <>
          <span className="field-hint">
            {variants.length > 0 ? '点击缩略图选择要采纳的方案' : '选择差异化维度后点击生成'}
          </span>
          <div className="flex-1" />
          <Button onClick={closeOverlay}>取消</Button>
          <Button variant="primary" onClick={onApply} disabled={!picked || !!variants.find((v) => v.id === picked)?.error}>
            <IconCheck size={13} /> 采纳选中方案
          </Button>
        </>
      }
    >
      <div className="modal-body">
        {/* ---------- 配置行 ---------- */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--sp-4)',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            paddingBottom: 'var(--sp-4)',
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <div style={{ flex: '1 1 320px' }}>
            <div className="field-label" style={{ marginBottom: 6 }}>
              差异化维度
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
              {ASPECT_META.map((a) => (
                <CheckRow key={a.id} checked={aspects.includes(a.id)} onChange={() => toggleAspect(a.id)}>
                  <span title={a.desc}>{a.label}</span>
                </CheckRow>
              ))}
            </div>
          </div>

          <div style={{ flex: '0 0 140px' }}>
            <div className="field-label" style={{ marginBottom: 6 }}>
              方案数量
            </div>
            <div className="seg-row">
              {[2, 3, 4, MAX_VARIANTS].map((n) => (
                <button key={n} className={count === n ? 'active' : ''} onClick={() => setCount(n)}>
                  {n} 个
                </button>
              ))}
            </div>
          </div>

          <div style={{ paddingTop: 22 }}>
            <Button variant="primary" onClick={onGenerate} disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner" /> 生成中…
                </>
              ) : variants.length ? (
                <>
                  <IconRefresh size={13} /> 重新生成
                </>
              ) : (
                <>
                  <IconSparkles size={13} /> 生成变体
                </>
              )}
            </Button>
          </div>
        </div>

        {/* ---------- 预览区 ---------- */}
        {loading && (
          <div style={{ padding: 'var(--sp-6) 0', textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            <div className="field-hint">
              正在生成差异化方案…
              {progress.total > 0 && ` (${progress.done}/${progress.total})`}
            </div>
            <div className="field-hint" style={{ marginTop: 6 }}>
              变体需要模型输出多次完整设计，耗时通常比单页生成更长
            </div>
          </div>
        )}

        {!loading && variants.length === 0 && (
          <div className="empty" style={{ padding: 'var(--sp-8)' }}>
            <div className="empty-icon">
              <IconSparkles size={18} />
            </div>
            <div className="empty-title">还没有变体</div>
            <div className="empty-desc">
              选择差异化维度后点击「生成变体」。左侧是最新的当前方案，可与变体直接对比。
            </div>
          </div>
        )}

        {(variants.length > 0 || (!loading && baseHtml)) && (
          <div style={{ display: 'flex', gap: 'var(--sp-5)', overflowX: 'auto', paddingBottom: 'var(--sp-3)' }}>
            {/* 当前方案 */}
            <Thumb
              title="当前方案"
              subtitle="基线"
              width={thumbW}
              height={thumbH}
              scale={thumbScale}
              html={baseHtml}
              canvas={canvas}
              isBase
              selected={false}
              onClick={() => setPicked(null)}
            />

            {variants.map((v) => (
              <Thumb
                key={v.id}
                title={v.rationale}
                subtitle={v.aspects.map((a) => ASPECT_META.find((m) => m.id === a)?.label ?? a).join(' · ')}
                width={thumbW}
                height={thumbH}
                scale={thumbScale}
                html={v.error ? '' : renderNode(v.page.root, map)}
                canvas={canvas}
                selected={picked === v.id}
                disabled={!!v.error}
                errorText={v.error}
                onClick={() => !v.error && setPicked(v.id)}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

function Thumb({
  title,
  subtitle,
  width,
  height,
  scale,
  html,
  canvas,
  selected,
  isBase,
  disabled,
  errorText,
  onClick,
}: {
  title: string
  subtitle?: string
  width: number
  height: number
  scale: number
  html: string
  canvas: { width: number; height: number }
  selected?: boolean
  isBase?: boolean
  disabled?: boolean
  errorText?: string
  onClick?: () => void
}) {
  return (
    <div style={{ flex: '0 0 auto', width }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          marginBottom: 6,
          fontSize: 11,
          color: selected ? 'var(--brand)' : 'var(--text-2)',
        }}
      >
        {selected && <IconCheck size={11} />}
        <span className="truncate" style={{ flex: 1 }} title={title}>
          {title}
        </span>
        {isBase && <span className="badge">基线</span>}
      </div>

      <div
        onClick={onClick}
        style={{
          width,
          height,
          borderRadius: 'var(--r-md)',
          overflow: 'hidden',
          background: 'var(--page-paper)',
          border: `2px solid ${selected ? 'var(--brand)' : 'var(--border-subtle)'}`,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          position: 'relative',
          transition: 'border-color var(--dur-fast)',
        }}
      >
        {html ? (
          <div
            style={{
              width: canvas.width,
              height: canvas.height,
              transform: `scale(${scale})`,
              transformOrigin: '0 0',
              position: 'absolute',
              top: 0,
              left: 0,
              pointerEvents: 'none',
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: 'var(--danger)',
              fontSize: 11,
              padding: 10,
              textAlign: 'center',
            }}
          >
            {errorText ?? '无法预览'}
          </div>
        )}
      </div>

      {subtitle && (
        <div className="truncate" style={{ marginTop: 5, fontSize: 10, color: 'var(--text-3)' }} title={subtitle}>
          {subtitle}
        </div>
      )}
    </div>
  )
}
