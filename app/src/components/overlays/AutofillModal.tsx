// src/components/overlays/AutofillModal.tsx —— F-ST-02 页面自动补全
//
// 一个浮层承载两条子链路，用 Tab 切换：
//   2A 补页：断链检测 → 建议清单 → 勾选 → 复用阶段 C（buildPagePrompt）逐页生成
//   2B 交互：本地规则填充 Node.states + 自动推理 flows（零模型调用、零延迟）
//
// 关键设计：2B 全部在本地算完，打开浮层立刻有结果；用户勾选后经 commit
// 单事务入栈，一次 Ctrl+Z 就能整体回退。
import { useEffect, useMemo, useState } from 'react'
import { useUiStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { useConfigStore } from '@/stores/config.store'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { CheckRow } from '@/components/ui/Field'
import {
  IconCheck,
  IconRefresh,
  IconSparkles,
  IconWand,
  IconInfo,
  IconWarning,
  IconLink,
  IconPlus,
} from '@/components/ui/Icons'
import { tokenMapForPage } from '@/services/design/specs'
import { renderNode, renderNodeWithStates } from '@/services/render/node'
import {
  buildAutofillPlan,
  applyStates,
  applyFlows,
  countStatedNodes,
  resolveStateStyle,
  type AutofillPlan,
  type FlowSuggestion,
  type PageSuggestion,
  type StateSuggestion,
} from '@/services/ai/autofill'
import { generateMissingPages } from '@/services/ai/autofill-generate'

type Tab = 'interaction' | 'pages'

export function AutofillModal() {
  const overlay = useUiStore((s) => s.overlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const toast = useUiStore((s) => s.toast)
  const design = useProjectStore((s) => s.design)
  const activePageId = useProjectStore((s) => s.activePageId)
  const cfg = useConfigStore((s) => s.current())

  const open = overlay === 'autofill'

  const [tab, setTab] = useState<Tab>('interaction')
  const [plan, setPlan] = useState<AutofillPlan | null>(null)

  // 2B：勾选态
  const [pickedStates, setPickedStates] = useState<Set<string>>(new Set())
  const [pickedFlows, setPickedFlows] = useState<Set<string>>(new Set())
  // 2A：勾选态 + 生成态
  const [pickedPages, setPickedPages] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, name: '' })

  const activePage = design.pages.find((p) => p.id === activePageId) ?? design.pages[0]

  /** 打开浮层时重算整份计划（纯本地计算，无需模型） */
  useEffect(() => {
    if (!open) return
    const p = buildAutofillPlan(design, (page) => tokenMapForPage(design, page))
    setPlan(p)
    setPickedStates(new Set(p.states.map((s) => s.id)))
    setPickedFlows(new Set(p.flows.map((f) => f.id)))
    setPickedPages(new Set(p.pages.map((x) => x.id)))
    setProgress({ done: 0, total: 0, name: '' })
    // 仅在打开时重算一次；后续编辑不应覆盖用户勾选
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const map = useMemo(
    () => (activePage ? tokenMapForPage(design, activePage) : undefined),
    [design, activePage?.specId],
  )

  const coverage = useMemo(() => countStatedNodes(design), [design])

  /* ---------------- 2B 预览：把选中 states 应用后的效果 ---------------- */
  const previewHtml = useMemo(() => {
    if (!activePage || !plan || !map) return ''
    const picked = plan.states.filter((s) => pickedStates.has(s.id))
    if (!picked.length) return renderNode(activePage.root, map)
    const next = applyStates(design, picked)
    const page = next.pages.find((p) => p.id === activePage.id)
    return page ? renderNodeWithStates(page.root, map) : ''
  }, [design, activePage?.id, activePage?.root, plan, pickedStates, map])

  const baseHtml = useMemo(
    () => (activePage && map ? renderNodeWithStates(activePage.root, map) : ''),
    [activePage?.root, map],
  )

  if (!open) return null

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void) => (key: string) =>
    setter(
      (() => {
        const n = new Set(set)
        if (n.has(key)) n.delete(key)
        else n.add(key)
        return n
      })(),
    )

  const toggleState = toggle(pickedStates, setPickedStates)
  const toggleFlow = toggle(pickedFlows, setPickedFlows)
  const togglePage = toggle(pickedPages, setPickedPages)

  const toggleAllStates = () => {
    if (!plan) return
    setPickedStates(
      pickedStates.size === plan.states.length ? new Set() : new Set(plan.states.map((s) => s.id)),
    )
  }
  const toggleAllFlows = () => {
    if (!plan) return
    setPickedFlows(pickedFlows.size === plan.flows.length ? new Set() : new Set(plan.flows.map((f) => f.id)))
  }
  const toggleAllPages = () => {
    if (!plan) return
    setPickedPages(pickedPages.size === plan.pages.length ? new Set() : new Set(plan.pages.map((p) => p.id)))
  }

  /* ---------------- 2B 应用（本地，单事务） ---------------- */
  const onApplyInteraction = () => {
    if (!plan) return
    const st = plan.states.filter((s) => pickedStates.has(s.id))
    const fl = plan.flows.filter((f) => pickedFlows.has(f.id))
    if (!st.length && !fl.length) return
    useProjectStore.getState().commit(
      `补全交互：${st.length} 项状态 · ${fl.length} 条跳转`,
      (d) => {
        let next = applyStates(d, st)
        next = applyFlows(next, fl)
        return next
      },
      { coalesceKey: 'autofill-interaction' },
    )
    toast('success', `已补全 ${st.length} 项交互状态、${fl.length} 条页面跳转`)
    closeOverlay()
  }

  /* ---------------- 2A 生成并应用（走模型，逐页） ---------------- */
  const onGeneratePages = async () => {
    if (!plan) return
    const picked = plan.pages.filter((p) => pickedPages.has(p.id))
    if (!picked.length) return
    if (!cfg) {
      toast('warn', '补页需要调用模型，请先完成模型配置')
      useUiStore.getState().openOverlay('settings')
      return
    }
    setLoading(true)
    setProgress({ done: 0, total: picked.length, name: '' })
    try {
      const res = await generateMissingPages({
        configId: cfg.id,
        design,
        picked,
        onProgress: (name, done, total) => setProgress({ done, total, name }),
      })
      const ok = res.items.filter((i) => i.page).length
      const bad = res.items.filter((i) => i.error)
      for (const w of res.warnings) toast('warn', w)

      if (!ok) {
        toast('error', `补页失败：${bad[0]?.error ?? '模型未返回可用页面'}`)
        return
      }

      /* 单事务落盘：新页 + 新跳转一起入栈 */
      useProjectStore.getState().commit(`自动补页：新增 ${ok} 个页面`, (d) => {
        const next = JSON.parse(JSON.stringify(d)) as typeof d
        next.pages = [...next.pages, ...res.newPages]
        // 走与补页服务同一套校验，避免把悬空跳转写进项目
        const existing = new Set(next.flows.map((f) => `${f.from}->${f.to}`))
        for (const f of res.newFlows) {
          const key = `${f.from}->${f.to}`
          if (existing.has(key)) continue
          existing.add(key)
          next.flows.push(JSON.parse(JSON.stringify(f)))
        }
        return next
      })

      toast(
        'success',
        bad.length
          ? `已新增 ${ok} 个页面，${bad.length} 个失败（${bad.map((b) => b.suggestion.name).join('、')}）`
          : `已新增 ${ok} 个页面并接通跳转`,
      )
      closeOverlay()
    } catch (e) {
      toast('error', `补页失败：${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  const totalStates = plan?.states.length ?? 0
  const totalFlows = plan?.flows.length ?? 0
  const totalPages = plan?.pages.length ?? 0
  const nothingTodo = totalStates + totalFlows + totalPages === 0

  return (
    <Modal
      open={open}
      title="自动补全"
      subtitle="检出缺失页面、补齐交互状态与页面跳转；所有改动均为建议，勾选后一次性入栈可撤销"
      width={Math.min(1080, window.innerWidth - 120)}
      onClose={closeOverlay}
      footer={
        <>
          <span className="field-hint">
            {tab === 'interaction'
              ? `已选 ${pickedStates.size}/${totalStates} 项状态 · ${pickedFlows.size}/${totalFlows} 条跳转`
              : `已选 ${pickedPages.size}/${totalPages} 个待补页面`}
          </span>
          <div className="flex-1" />
          <Button onClick={closeOverlay}>取消</Button>
          {tab === 'interaction' ? (
            <Button
              variant="primary"
              onClick={onApplyInteraction}
              disabled={!pickedStates.size && !pickedFlows.size}
            >
              <IconCheck size={13} /> 应用选中补全
            </Button>
          ) : (
            <Button variant="primary" onClick={onGeneratePages} disabled={!pickedPages.size || loading}>
              {loading ? (
                <>
                  <span className="spinner" /> 生成中…
                </>
              ) : (
                <>
                  <IconWand size={13} /> 生成并新增页面
                </>
              )}
            </Button>
          )}
        </>
      }
    >
      <div className="modal-body">
        {/* ---------------- Tab 切换 ---------------- */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--sp-4)',
            alignItems: 'center',
            flexWrap: 'wrap',
            paddingBottom: 'var(--sp-4)',
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <div className="seg-row">
            <button className={tab === 'interaction' ? 'active' : ''} onClick={() => setTab('interaction')}>
              交互补全{totalStates + totalFlows > 0 ? ` ${totalStates + totalFlows}` : ''}
            </button>
            <button className={tab === 'pages' ? 'active' : ''} onClick={() => setTab('pages')}>
              缺失页面{totalPages > 0 ? ` ${totalPages}` : ''}
            </button>
          </div>

          <div className="field-hint" style={{ flex: '1 1 260px' }}>
            {tab === 'interaction'
              ? '本地规则生成，不调用模型，点击即得结果'
              : '复用生成流水线的逐页 Prompt，需要配置模型'}
          </div>

          <Button
            onClick={() => {
              const p = buildAutofillPlan(design, (page) => tokenMapForPage(design, page))
              setPlan(p)
              setPickedStates(new Set(p.states.map((s) => s.id)))
              setPickedFlows(new Set(p.flows.map((f) => f.id)))
              setPickedPages(new Set(p.pages.map((x) => x.id)))
              toast('info', '已重新检测')
            }}
            disabled={loading}
          >
            <IconRefresh size={13} /> 重新检测
          </Button>
        </div>

        {nothingTodo ? (
          <div className="empty" style={{ padding: 'var(--sp-8)' }}>
            <div className="empty-icon">
              <IconCheck size={18} />
            </div>
            <div className="empty-title">这份设计已经很完整了</div>
            <div className="empty-desc">
              未检出断链，也没有可补充的交互状态。后续若新增按钮或页面，可以再回到这里检测一次。
            </div>
          </div>
        ) : tab === 'interaction' ? (
          /* ================= 2B：交互补全 ================= */
          <div style={{ display: 'flex', gap: 'var(--sp-5)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 420px', minWidth: 300, maxHeight: 440, overflowY: 'auto' }}>
              {/* 状态建议 */}
              <Section
                title="交互状态"
                count={totalStates}
                allOn={totalStates > 0 && pickedStates.size === totalStates}
                onToggleAll={toggleAllStates}
                coverage={coverage}
              >
                {totalStates === 0 ? (
                  <Hint text="当前所有可交互元素都已带状态定义，无需补充。" />
                ) : (
                  plan?.states.map((s) => (
                    <Row key={s.id} checked={pickedStates.has(s.id)} onChange={() => toggleState(s.id)}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span className="badge">{stateLabel(s.state)}</span>
                        <span style={{ fontSize: 12.5 }}>
                          {s.pageName} · {s.nodeLabel}
                          <span style={{ color: 'var(--text-3)' }}>（{s.nodeType}）</span>
                        </span>
                      </span>
                      <div className="field-hint" style={{ marginTop: 3, paddingLeft: 22 }}>
                        {s.label}
                        <Swatch style={s.style} map={map} />
                      </div>
                    </Row>
                  ))
                )}
              </Section>

              {/* flows 建议 */}
              <Section
                title="页面跳转"
                count={totalFlows}
                allOn={totalFlows > 0 && pickedFlows.size === totalFlows}
                onToggleAll={toggleAllFlows}
                extra={
                  plan?.droppedFlows
                    ? `${plan.droppedFlows} 条因目标不存在被丢弃`
                    : undefined
                }
              >
                {totalFlows === 0 ? (
                  <Hint text="没有从文案中识别出明确的跳转意图，可手动连线或补充页面后再试。" />
                ) : (
                  plan?.flows.map((f) => (
                    <FlowRow key={f.id} flow={f} checked={pickedFlows.has(f.id)} onChange={() => toggleFlow(f.id)} />
                  ))
                )}
              </Section>
            </div>

            {/* 右侧预览 */}
            <div style={{ flex: '0 0 auto' }}>
              <div style={{ fontSize: 11, color: 'var(--brand)', marginBottom: 6, display: 'flex', gap: 5 }}>
                <IconSparkles size={11} />
                <span>补全效果预览（{activePage?.name}）</span>
              </div>
              <div
                style={{
                  width: 260,
                  height: Math.round((260 / design.meta.canvas.width) * design.meta.canvas.height),
                  borderRadius: 'var(--r-md)',
                  overflow: 'hidden',
                  background: 'var(--page-paper)',
                  border: '2px solid var(--brand)',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    width: design.meta.canvas.width,
                    height: design.meta.canvas.height,
                    transform: `scale(${260 / design.meta.canvas.width})`,
                    transformOrigin: '0 0',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                  }}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
              <div className="field-hint" style={{ marginTop: 6, width: 260 }}>
                将鼠标移到元素上可看到悬停效果；选中的状态会随预览实时更新。
              </div>
              <details style={{ marginTop: 'var(--sp-3)', width: 260 }}>
                <summary style={{ fontSize: 11.5, color: 'var(--text-2)', cursor: 'pointer' }}>对比补全前</summary>
                <div
                  style={{
                    marginTop: 6,
                    width: 260,
                    height: Math.round((260 / design.meta.canvas.width) * design.meta.canvas.height),
                    borderRadius: 'var(--r-md)',
                    overflow: 'hidden',
                    background: 'var(--page-paper)',
                    border: '1px solid var(--border-subtle)',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      width: design.meta.canvas.width,
                      height: design.meta.canvas.height,
                      transform: `scale(${260 / design.meta.canvas.width})`,
                      transformOrigin: '0 0',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                    }}
                    dangerouslySetInnerHTML={{ __html: baseHtml }}
                  />
                </div>
              </details>
            </div>
          </div>
        ) : (
          /* ================= 2A：缺失页面 ================= */
          <div style={{ display: 'flex', gap: 'var(--sp-5)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 480px', minWidth: 320, maxHeight: 460, overflowY: 'auto' }}>
              {/* 断链清单 */}
              {(plan?.brokenLinks.length ?? 0) > 0 && (
                <div style={{ marginBottom: 'var(--sp-4)' }}>
                  <div className="field-label" style={{ marginBottom: 6 }}>
                    断链诊断（{plan?.brokenLinks.length}）
                  </div>
                  {plan?.brokenLinks.map((b, i) => (
                    <div
                      key={i}
                      style={{ fontSize: 11.5, color: 'var(--text-2)', display: 'flex', gap: 6, marginBottom: 4 }}
                    >
                      {b.kind === 'dangling' ? <IconLink size={12} /> : <IconWarning size={12} />}
                      <span>{b.detail}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
                <div className="field-label" style={{ margin: 0 }}>
                  建议新增的页面{totalPages ? `（${totalPages}）` : ''}
                </div>
                {totalPages > 0 && (
                  <button
                    onClick={toggleAllPages}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand)', fontSize: 12, padding: 0 }}
                  >
                    {pickedPages.size === totalPages ? '全不选' : '全选'}
                  </button>
                )}
              </div>

              {totalPages === 0 ? (
                <div className="empty" style={{ padding: 'var(--sp-6) var(--sp-4)' }}>
                  <div className="empty-icon">
                    <IconCheck size={18} />
                  </div>
                  <div className="empty-title">未检出缺失页面</div>
                  <div className="empty-desc">
                    项目内没有指向不存在页面的跳转，按钮文案也没有暗示缺失的页面。
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                  {plan?.pages.map((p) => (
                    <PageCard key={p.id} item={p} checked={pickedPages.has(p.id)} onChange={() => togglePage(p.id)} />
                  ))}
                </div>
              )}
            </div>

            {/* 生成进度 / 说明 */}
            <div style={{ flex: '0 0 260px' }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 'var(--sp-5) 0' }}>
                  <div className="spinner" style={{ margin: '0 auto 10px' }} />
                  <div className="field-hint">
                    正在生成「{progress.name}」
                    {progress.total > 0 && ` (${progress.done}/${progress.total})`}
                  </div>
                  <div className="field-hint" style={{ marginTop: 6 }}>
                    每页单独请求，失败只跳过该页
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-1)' }}>补页是怎么做的？</div>
                  <div>1 · 扫描所有跳转与按钮文案，找出「指向不存在页面」和「语义上缺页」两类问题</div>
                  <div>2 · 把缺失页按名称聚合，给出用途与默认区块骨架</div>
                  <div>3 · 勾选后逐页调用生成流水线（同一套 Prompt 与 Token），产出与首次生成完全同构</div>
                  <div>4 · 新页自动排到画布右侧，连同跳转一起单事务入栈</div>
                  <div className="field-hint" style={{ marginTop: 8 }}>
                    2A 需要配置模型；若只想补齐交互与跳转，用左侧「交互补全」即可，无需模型。
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ============================ 内部小组件 ============================ */

function stateLabel(s: StateSuggestion['state']): string {
  return s === 'hover' ? '悬停' : s === 'active' ? '按下' : '聚焦'
}

function Section({
  title,
  count,
  allOn,
  onToggleAll,
  children,
  extra,
  coverage,
}: {
  title: string
  count: number
  allOn: boolean
  onToggleAll: () => void
  children: React.ReactNode
  extra?: string
  coverage?: { nodes: number; stated: number }
}) {
  return (
    <div style={{ marginBottom: 'var(--sp-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
        <div className="field-label" style={{ margin: 0 }}>
          {title}
          {count ? `（${count}）` : ''}
        </div>
        {count > 0 && (
          <button
            onClick={onToggleAll}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand)', fontSize: 12, padding: 0 }}
          >
            {allOn ? '全不选' : '全选'}
          </button>
        )}
        {coverage && (
          <span className="field-hint" style={{ marginLeft: 'auto' }}>
            覆盖率 {coverage.stated}/{coverage.nodes}
          </span>
        )}
        {extra && <span className="field-hint" style={{ marginLeft: 'auto' }}>{extra}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  )
}

function Hint({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', gap: 6 }}>
      <IconInfo size={12} style={{ flex: '0 0 auto', marginTop: 2 }} />
      <span>{text}</span>
    </div>
  )
}

function Row({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: () => void
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--r-md)',
        padding: '7px 9px',
        background: checked ? 'var(--bg-2)' : 'transparent',
      }}
    >
      <CheckRow checked={checked} onChange={onChange}>
        <span style={{ display: 'block' }}>{children}</span>
      </CheckRow>
    </div>
  )
}

/** 用真实色值画一个小色块，让用户不用读 Token 名就能看懂改了什么 */
function Swatch({ style, map }: { style: StateSuggestion['style']; map?: ReturnType<typeof tokenMapForPage> }) {
  if (!map) return null
  const resolved = resolveStateStyle(style, map)
  if (!resolved.background && !resolved.borderColor) return null
  return (
    <span
      style={{
        display: 'inline-block',
        width: 11,
        height: 11,
        marginLeft: 6,
        verticalAlign: 'middle',
        borderRadius: 3,
        background: resolved.background ?? 'transparent',
        border: resolved.borderColor ? `2px solid ${resolved.borderColor}` : '1px solid var(--border)',
      }}
      title={Object.entries(resolved)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ')}
    />
  )
}

function FlowRow({ flow, checked, onChange }: { flow: FlowSuggestion; checked: boolean; onChange: () => void }) {
  const kindLabel = flow.kind === 'back' ? '返回' : flow.kind === 'forward' ? '推进' : '跳转'
  const trans = flow.flow.transition ?? 'none'
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--r-md)',
        padding: '7px 9px',
        background: checked ? 'var(--bg-2)' : 'transparent',
      }}
    >
      <CheckRow checked={checked} onChange={onChange}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span className="badge">{kindLabel}</span>
          <span>{flow.label}</span>
          {trans !== 'none' && <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{trans}</span>}
        </span>
      </CheckRow>
    </div>
  )
}

function PageCard({
  item,
  checked,
  onChange,
}: {
  item: PageSuggestion
  checked: boolean
  onChange: () => void
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--r-md)',
        padding: '9px 11px',
        background: checked ? 'var(--bg-2)' : 'transparent',
      }}
    >
      <CheckRow checked={checked} onChange={onChange}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <IconPlus size={12} />
          <b style={{ fontSize: 13 }}>{item.name}</b>
          <span className="field-hint" style={{ margin: 0 }}>
            {item.suggestedId}
          </span>
        </span>
      </CheckRow>
      <div className="field-hint" style={{ marginTop: 4, paddingLeft: 22 }}>
        用途：{item.purpose}
      </div>
      <div className="field-hint" style={{ marginTop: 2, paddingLeft: 22 }}>
        建议区块：{item.keySections.join(' · ')}
      </div>
      {item.reasons.length > 0 && (
        <div style={{ marginTop: 4, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {item.reasons.slice(0, 4).map((r, i) => (
            <div key={i} style={{ fontSize: 11, color: 'var(--warning, #c98a00)' }}>
              · {r}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
