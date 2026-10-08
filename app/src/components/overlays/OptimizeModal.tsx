// src/components/overlays/OptimizeModal.tsx —— F-ST-04 页面 AI 优化
//
// 两条入口，收敛为同一份 ops 补丁、同一个应用器：
//   · 自动优化：本地规则诊断（无需模型）→ 勾选采纳；也可「交给 AI 深化」；
//   · 指令优化：用户写清诉求 → optimizePage() 走 buildEditPrompt + askJson。
// 右侧实时并排预览「优化后」，应用时经 commit 单事务入栈（可撤销）。
import { useEffect, useMemo, useState } from 'react'
import { useUiStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { useConfigStore } from '@/stores/config.store'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { CheckRow } from '@/components/ui/Field'
import {
  IconSparkles,
  IconCheck,
  IconRefresh,
  IconWand,
  IconInfo,
  IconWarning,
} from '@/components/ui/Icons'
import { tokenMapForPage } from '@/services/design/specs'
import { renderNode } from '@/services/render/node'
import { computeThumbGeometry } from '@/lib/thumb-geometry'
import {
  DIMENSION_META,
  applyOpsToDesign,
  checkOpSafety,
  describeOp,
  diagnosePage,
  opKindCounts,
  opKindLabel,
  optimizePage,
  previewOps,
  type DiagnosticDimension,
  type EditOp,
  type Suggestion,
} from '@/services/ai/optimize'

/** 一条可勾选采纳的改动 */
interface Candidate {
  key: string
  op: EditOp
  label: string
  hint?: string
  dimension?: DiagnosticDimension
  source: 'rule' | 'ai'
}

type Mode = 'auto' | 'prompt'

export function OptimizeModal() {
  const overlay = useUiStore((s) => s.overlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const toast = useUiStore((s) => s.toast)
  const design = useProjectStore((s) => s.design)
  const activePageId = useProjectStore((s) => s.activePageId)
  const selectedIds = useProjectStore((s) => s.selectedIds)
  const cfg = useConfigStore((s) => s.current())

  const open = overlay === 'optimize'
  const page = design.pages.find((p) => p.id === activePageId)
  const map = useMemo(() => tokenMapForPage(design, page), [design, page?.specId])
  const { canvas } = design.meta

  const [mode, setMode] = useState<Mode>('auto')
  const [instruction, setInstruction] = useState('')
  const [loading, setLoading] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [explanation, setExplanation] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [viewportW, setViewportW] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))

  /* ---------------- 打开即做一次本地诊断（不依赖模型） ---------------- */
  useEffect(() => {
    if (!open || !page) return
    const found = diagnosePage(design, page)
    setSuggestions(found)
    const fromRules: Candidate[] = found
      .filter((s) => s.op)
      .map((s) => ({
        key: s.id,
        op: s.op as EditOp,
        label: s.advice,
        hint: s.title,
        dimension: s.dimension,
        source: 'rule',
      }))
    setCandidates(fromRules)
    setPicked(new Set(fromRules.map((c) => c.key)))
    setExplanation('基于规则诊断的优化方案')
    setWarnings([])
    // 仅在打开或换页时重置；详情依赖故意收窄，避免每次编辑重跑诊断覆盖用户勾选
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, page?.id])

  useEffect(() => {
    if (!open) return
    const onResize = () => setViewportW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open])

  /* ---------------- 选中 → 生效 ops → 预览 ---------------- */
  const activeOps = useMemo(
    () => candidates.filter((c) => picked.has(c.key)).map((c) => c.op),
    [candidates, picked],
  )

  const previewRoot = useMemo(() => {
    if (!page) return undefined
    return activeOps.length ? previewOps(page, activeOps) : page.root
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.root, activeOps])

  const baseHtml = useMemo(() => (page ? renderNode(page.root, map) : ''), [page?.root, map])
  const afterHtml = useMemo(() => (previewRoot ? renderNode(previewRoot, map) : ''), [previewRoot, map])

  const safety = useMemo(
    () => (page && previewRoot ? checkOpSafety(page.root, previewRoot) : null),
    [page?.root, previewRoot],
  )

  const kindCounts = useMemo(() => opKindCounts(activeOps), [activeOps])
  const pendingSuggestions = useMemo(
    () => suggestions.filter((s) => !s.op),
    [suggestions],
  )

  if (!open || !page) return null

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const allOn = candidates.length > 0 && picked.size === candidates.length
  const toggleAll = () => setPicked(allOn ? new Set() : new Set(candidates.map((c) => c.key)))

  /* ---------------- 本地诊断重跑 ---------------- */
  const onDiagnose = () => {
    const found = diagnosePage(design, page)
    setSuggestions(found)
    const fromRules: Candidate[] = found
      .filter((s) => s.op)
      .map((s) => ({
        key: s.id,
        op: s.op as EditOp,
        label: s.advice,
        hint: s.title,
        dimension: s.dimension,
        source: 'rule',
      }))
    setCandidates(fromRules)
    setPicked(new Set(fromRules.map((c) => c.key)))
    setExplanation('基于规则诊断的优化方案')
    setWarnings([])
    toast('info', fromRules.length ? `诊断完成，发现 ${fromRules.length} 项可自动修复` : '诊断完成，未发现可自动修复的问题')
  }

  /* ---------------- 交给 AI ---------------- */
  const onAiOptimize = async () => {
    if (!cfg) {
      toast('warn', '尚未配置模型，请先完成模型配置')
      useUiStore.getState().openOverlay('settings')
      return
    }
    if (mode === 'prompt' && !instruction.trim()) {
      toast('warn', '请先输入优化指令')
      return
    }
    setLoading(true)
    try {
      const plan = await optimizePage({
        configId: cfg.id,
        design,
        pageId: page.id,
        instruction: mode === 'prompt' ? instruction.trim() : undefined,
        selectedIds,
        auto: mode === 'auto',
      })
      const aiCandidates: Candidate[] = plan.ops.map((op, i) => {
        const d = describeOp(op, page.root)
        return { key: `ai_${i}`, op, label: d.label, hint: `AI · ${opKindLabel(d.kind)}`, source: 'ai' }
      })
      setCandidates(aiCandidates)
      setPicked(new Set(aiCandidates.map((c) => c.key)))
      if (plan.diagnosis) setSuggestions(plan.diagnosis)
      setExplanation(plan.explanation || 'AI 优化')
      setWarnings(plan.warnings)
      toast('success', `AI 返回 ${plan.ops.length} 项优化建议，请确认后应用`)
    } catch (e) {
      toast('error', `优化失败：${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  /* ---------------- 应用（单事务入栈） ---------------- */
  const onApply = () => {
    if (!activeOps.length) return
    if (safety?.needsConfirm) {
      const lines: string[] = []
      if (safety.removedInfoPoints.length)
        lines.push(`· 将移除 ${safety.removedInfoPoints.length} 处文案信息点：${safety.removedInfoPoints.slice(0, 3).join('、')}${safety.removedInfoPoints.length > 3 ? '…' : ''}`)
      if (safety.typeChanges.length) lines.push(`· 将改变 ${safety.typeChanges.length} 个节点的语义类型`)
      if (safety.changeRatio > 0.5)
        lines.push(`· 改动幅度较大（${Math.round(safety.changeRatio * 100)}% 的节点会被修改）`)
      const ok = window.confirm(`本次优化存在以下风险：\n${lines.join('\n')}\n\n确定继续应用吗？（应用后仍可用 Ctrl+Z 撤销）`)
      if (!ok) return
    }
    const label = explanation ? `AI 优化：${explanation}` : 'AI 优化'
    useProjectStore
      .getState()
      .commit(label, (d) => applyOpsToDesign(d, page.id, activeOps).design, { coalesceKey: 'ai-optimize' })
    toast('success', `已应用 ${activeOps.length} 项优化`)
    closeOverlay()
  }

  const geo = computeThumbGeometry(2, viewportW, canvas.width, canvas.height)
  const { width: thumbW, height: thumbH, scale: thumbScale } = geo

  return (
    <Modal
      open={open}
      title="页面 AI 优化"
      subtitle={`优化「${page.name}」，逐条确认后应用；改动以单次事务入栈，可撤销`}
      width={Math.min(1220, window.innerWidth - 120)}
      onClose={closeOverlay}
      footer={
        <>
          <span className="field-hint">
            {candidates.length
              ? `已选 ${picked.size}/${candidates.length} 项`
              : mode === 'auto'
                ? '点击「重新诊断」识别可优化项，或交给 AI 深化'
                : '输入优化诉求后点击「AI 优化」'}
          </span>
          <div className="flex-1" />
          <Button onClick={closeOverlay}>取消</Button>
          <Button variant="primary" onClick={onApply} disabled={!activeOps.length || loading}>
            <IconCheck size={13} /> 应用选中优化
          </Button>
        </>
      }
    >
      <div className="modal-body">
        {/* ---------------- 模式与动作 ---------------- */}
        <div style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'flex-start', flexWrap: 'wrap', paddingBottom: 'var(--sp-4)', borderBottom: '1px solid var(--border-subtle)', marginBottom: 'var(--sp-4)' }}>
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>优化方式</div>
            <div className="seg-row">
              <button className={mode === 'auto' ? 'active' : ''} onClick={() => setMode('auto')}>自动优化</button>
              <button className={mode === 'prompt' ? 'active' : ''} onClick={() => setMode('prompt')}>指令优化</button>
            </div>
          </div>

          {mode === 'prompt' && (
            <div style={{ flex: '1 1 340px', minWidth: 260 }}>
              <div className="field-label" style={{ marginBottom: 6 }}>优化指令</div>
              <textarea
                className="ai-textarea"
                style={{ minHeight: 62 }}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="例如：把主标题层级拉开、统一按钮圆角、压缩留白，不要删掉任何信息"
              />
            </div>
          )}

          <div style={{ paddingTop: 22, display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            {mode === 'auto' && (
              <Button onClick={onDiagnose} disabled={loading}>
                <IconRefresh size={13} /> 重新诊断
              </Button>
            )}
            <Button variant="primary" onClick={onAiOptimize} disabled={loading}>
              {loading ? (
                <><span className="spinner" /> 优化中…</>
              ) : (
                <><IconWand size={13} /> {mode === 'auto' ? '交给 AI 深化' : 'AI 优化'}</>
              )}
            </Button>
          </div>
        </div>

        {/* ---------------- 主体：左改动清单 / 右并排预览 ---------------- */}
        <div style={{ display: 'flex', gap: 'var(--sp-5)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* 左：可勾选改动 */}
          <div style={{ flex: '1 1 420px', minWidth: 320, maxHeight: 460, overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
              <div className="field-label" style={{ margin: 0 }}>
                优化项{candidates.length ? `（${candidates.length}）` : ''}
              </div>
              {candidates.length > 0 && (
                <button
                  className="link-btn"
                  onClick={toggleAll}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand)', fontSize: 12, padding: 0 }}
                >
                  {allOn ? '全不选' : '全选'}
                </button>
              )}
            </div>

            {candidates.length === 0 ? (
              <div className="empty" style={{ padding: 'var(--sp-6) var(--sp-4)' }}>
                <div className="empty-icon"><IconSparkles size={18} /></div>
                <div className="empty-title">暂无待应用的优化</div>
                <div className="empty-desc">
                  {mode === 'auto'
                    ? '本地规则未发现可自动修复的问题，可点「交给 AI 深化」做更进一步的层次与美感提升。'
                    : '输入优化诉求后点击「AI 优化」，模型会返回一份可逐条勾选的改动补丁。'}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                {candidates.map((c) => (
                  <div
                    key={c.key}
                    style={{
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--r-md)',
                      padding: '8px 10px',
                      background: picked.has(c.key) ? 'var(--bg-2)' : 'transparent',
                    }}
                  >
                    <CheckRow checked={picked.has(c.key)} onChange={() => toggle(c.key)}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span className="badge">{c.source === 'ai' ? 'AI' : dimLabel(c.dimension)}</span>
                        <span style={{ fontSize: 12.5 }}>{c.label}</span>
                      </span>
                    </CheckRow>
                    {c.hint && (
                      <div className="field-hint" style={{ marginTop: 3, paddingLeft: 22 }}>{c.hint}</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 只读建议 */}
            {pendingSuggestions.length > 0 && (
              <div style={{ marginTop: 'var(--sp-5)' }}>
                <div className="field-label" style={{ marginBottom: 6 }}>
                  参考建议（需人工处理，不可自动应用）
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {pendingSuggestions.map((s) => (
                    <div key={s.id} style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', gap: 6 }}>
                      <IconInfo size={12} style={{ flex: '0 0 auto', marginTop: 2 }} />
                      <span><b>{s.title}</b> —— {s.advice}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {warnings.length > 0 && (
              <div style={{ marginTop: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 11.5, color: 'var(--warning, #c98a00)', display: 'flex', gap: 6 }}>
                    <IconWarning size={12} style={{ flex: '0 0 auto', marginTop: 2 }} />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 右：并排预览 + 摘要 */}
          <div style={{ flex: '0 0 auto' }}>
            <div style={{ display: 'flex', gap: 'var(--sp-5)' }}>
              <Thumb title="当前方案" subtitle="优化前" width={thumbW} height={thumbH} scale={thumbScale} html={baseHtml} canvas={canvas} isBase />
              <Thumb title="优化后" subtitle={activeOps.length ? `${activeOps.length} 项改动` : '暂无改动'} width={thumbW} height={thumbH} scale={thumbScale} html={afterHtml} canvas={canvas} highlight={activeOps.length > 0} />
            </div>

            {/* 改动摘要 */}
            {safety && activeOps.length > 0 && (
              <div style={{ marginTop: 'var(--sp-4)', fontSize: 12, color: 'var(--text-2)' }}>
                <div style={{ marginBottom: 4 }}>
                  <b>改动摘要</b>：{opKindSummary(kindCounts)}
                </div>
                <div style={{ marginBottom: 4 }}>
                  节点数 {safety.totalBefore} → {safety.totalAfter}，变更 {safety.changedNodes} 个（{Math.round(safety.changeRatio * 100)}%）
                </div>
                {safety.needsConfirm && (
                  <div style={{ color: 'var(--warning, #c98a00)', display: 'flex', gap: 6 }}>
                    <IconWarning size={12} style={{ flex: '0 0 auto', marginTop: 2 }} />
                    <span>
                      {safety.removedInfoPoints.length
                        ? `含信息点移除，应用前会二次确认`
                        : `改动幅度较大，应用前会二次确认`}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

/* ============================ 内部小组件 ============================ */

function dimLabel(d?: DiagnosticDimension): string {
  if (!d) return '规则'
  return DIMENSION_META.find((m) => m.id === d)?.label ?? d
}

function opKindSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${opKindLabel(k as EditOp['op'])} ${n}`)
  return parts.length ? parts.join(' · ') : '无'
}

function Thumb({
  title,
  subtitle,
  width,
  height,
  scale,
  html,
  canvas,
  isBase,
  highlight,
}: {
  title: string
  subtitle?: string
  width: number
  height: number
  scale: number
  html: string
  canvas: { width: number; height: number }
  isBase?: boolean
  highlight?: boolean
}) {
  return (
    <div style={{ flex: '0 0 auto', width }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6, fontSize: 11, color: highlight ? 'var(--brand)' : 'var(--text-2)' }}>
        {highlight && <IconCheck size={11} />}
        <span className="truncate" style={{ flex: 1 }}>{title}</span>
        {isBase && <span className="badge">基线</span>}
      </div>
      <div
        style={{
          width,
          height,
          borderRadius: 'var(--r-md)',
          overflow: 'hidden',
          background: 'var(--page-paper)',
          border: `2px solid ${highlight ? 'var(--brand)' : 'var(--border-subtle)'}`,
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
            pointerEvents: 'none',
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      {subtitle && (
        <div className="truncate" style={{ marginTop: 5, fontSize: 10, color: 'var(--text-3)' }}>{subtitle}</div>
      )}
    </div>
  )
}
