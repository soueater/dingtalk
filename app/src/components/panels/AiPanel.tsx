// src/components/panels/AiPanel.tsx —— AI 生成面板（含提示词增强）
//
// 增强交互设计（本轮简化）：
//   点「增强提示词」→ **直接在输入框内覆盖原内容**，不再有「原文/增强版」二选一的状态机，
//   也不再需要「复制 / 填入输入框」这类中转按钮。
//   覆盖前把原文压入 history，随时可「撤回」逐步回退。
//   增强后的文案就在输入框里，可直接继续编辑，所见即所得。
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { IconSparkles, IconWand, IconRefresh, IconUndo, IconPlus, IconInfo } from '@/components/ui/Icons'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'
import { useConfigStore } from '@/stores/config.store'
import { MOCK_PROJECTS } from '@/services/mock/projects'
import { enhancePrompt, classifyPrompt, type PromptLevel } from '@/services/ai/enhancer'
import { generateProject, generateInterfaces } from '@/services/ai/generate'
import { listSpecs } from '@/services/design/specs'
import { canAddInterfaces, effectiveHardLimit, resolveQuota } from '@/services/project/quota'

const SAMPLE_PROMPTS = [
  '一个外卖点餐 App，包含首页推荐、菜品详情和购物车三个页面',
  '企业官网首页，含顶部导航、Banner、产品特性三栏和页脚',
  '一个记账 App 的月度报表页，有收支卡片和分类环形图',
  '健身房会员 App 的个人中心，含头像、会员卡、预约记录列表',
]

const LEVEL_LABEL: Record<PromptLevel, string> = {
  L0: 'L0 信息极简',
  L1: 'L1 口语描述',
  L2: 'L2 半结构化',
  L3: 'L3 已结构化',
}

function levelLabel(level: PromptLevel): string {
  return LEVEL_LABEL[level] ?? level
}

export function AiPanel() {
  const design = useProjectStore((s) => s.design)
  const loadProject = useProjectStore((s) => s.loadProject)
  const toast = useUiStore((s) => s.toast)
  const { generating, generatingStage, generatingProgress, setGenerating, setGeneratingProgress } = useUiStore()
  const currentConfig = useConfigStore((s) => s.current)

  const [input, setInput] = useState('')
  const [enhancing, setEnhancing] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  const [usedLLM, setUsedLLM] = useState(false)
  const [level, setLevel] = useState<PromptLevel>('L1')
  /** 增强前的原文栈：每次增强压入一条，撤回时逐条弹出 */
  const [history, setHistory] = useState<string[]>([])
  /** 最近一次增强的产出；同时用于判断「用户是否又改过输入框」 */
  const [lastEnhanced, setLastEnhanced] = useState<string | null>(null)
  /** F-ST-01：本次生成套用的设计规范 id（空串 = 不指定） */
  const [genSpecId, setGenSpecId] = useState('')
  /** F-PM-05：本次生成的目标界面数 N（初始对齐项目的 planned） */
  const [genCount, setGenCount] = useState(1)
  /** F-PM-05：生成结果的落点 —— 覆盖整个项目 / 追加到当前项目 */
  const [genMode, setGenMode] = useState<'replace' | 'append'>('replace')
  const abortRef = useRef(false)

  const specs = useMemo(() => listSpecs(design), [design.specs])

  /* 配额视图：N 的可用范围与「还能再加几个」直接来自项目级配额 */
  const quota = resolveQuota(design.meta)
  const hard = effectiveHardLimit(quota)
  const remaining = Math.max(0, hard - design.pages.length)
  const plannedHard = Math.max(1, hard)
  const decision = useMemo(
    () => canAddInterfaces(genMode === 'append' ? design.pages.length : 0, genCount, quota),
    [genMode, design.pages.length, genCount, quota],
  )

  /* 项目切换时把 N 拉回项目的 planned */
  useEffect(() => {
    setGenCount(Math.max(1, quota.planned))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.meta.id])

  // 未配置模型时的提示
  const cfg = currentConfig()

  /** 输入分级：L0/L1 时给出增强建议 */
  const cls = useMemo(() => (input.trim() ? classifyPrompt(input) : null), [input])

  /** 刚增强过、且用户还没手动改动（决定是否显示撤回条 / 是否劫持 Ctrl+Z） */
  const justEnhanced = lastEnhanced !== null
  const editedSinceEnhance = justEnhanced && input !== lastEnhanced
  const canUndo = history.length > 0

  const onEnhance = async () => {
    const raw = input.trim()
    if (!raw) {
      toast('warn', '请先输入需求描述')
      return
    }
    setEnhancing(true)
    try {
      const res = await enhancePrompt(raw, cfg)
      // 覆盖前先存档，保证可撤回
      setHistory((h) => [...h, input])
      setInput(res.enhanced)
      setLastEnhanced(res.enhanced)
      setNotes(res.notes)
      setUsedLLM(res.usedLLM)
      setLevel(res.level)
    } catch (e) {
      toast('error', `增强失败：${(e as Error).message}`)
    } finally {
      setEnhancing(false)
    }
  }

  const onUndo = () => {
    if (!history.length) return
    const prev = history[history.length - 1]
    setHistory(history.slice(0, -1))
    setInput(prev)
    setLastEnhanced(null)
    setNotes([])
  }

  const onGenerate = async () => {
    const raw = input.trim()
    if (!raw) {
      toast('warn', '请先输入需求描述')
      return
    }
    if (!cfg) {
      toast('warn', '尚未配置模型，请先完成「模型配置」')
      useUiStore.getState().openOverlay('settings')
      return
    }

    abortRef.current = false
    setGenerating(true, '正在规划信息架构…')
    setGeneratingProgress(0, 0)
    try {
      await generateProject(raw, {
        configId: cfg.id,
        specId: genSpecId || undefined,
        specSource: design,
        onStage: (stage, done, total) => {
          setGenerating(true, stage)
          setGeneratingProgress(done, total)
        },
        shouldAbort: () => abortRef.current,
      })
      toast('success', '生成完成')
    } catch (e) {
      if ((e as Error).message === 'ABORTED') toast('info', '已取消生成')
      else toast('error', `生成失败：${(e as Error).message}`)
    } finally {
      setGenerating(false)
    }
  }

  /** F-PM-05：按 N 生成界面，可追加也可覆盖 */
  const onGenerateInterfaces = async () => {
    const raw = input.trim()
    if (!raw) {
      toast('warn', '请先输入需求描述')
      return
    }
    if (!cfg) {
      toast('warn', '尚未配置模型，请先完成「模型配置」')
      useUiStore.getState().openOverlay('settings')
      return
    }
    if (!decision.allowed) {
      toast('error', decision.message ?? '当前项目界面数已达上限')
      return
    }
    else if (decision.level === 'warn' && decision.message) toast('warn', decision.message)

    abortRef.current = false
    setGenerating(true, `正在规划 ${genCount} 个界面…`)
    setGeneratingProgress(0, genCount)
    try {
      const r = await generateInterfaces({
        configId: cfg.id,
        prompt: raw,
        count: genCount,
        append: genMode === 'append',
        onStage: (stage, done, total) => {
          setGenerating(true, stage)
          setGeneratingProgress(done, total)
        },
        shouldAbort: () => abortRef.current,
      })
      const tail = r.failed.length ? `（${r.failed.length} 个失败：${r.failed.join('、')}）` : ''
      toast(r.added ? 'success' : 'warn', `已生成 ${r.added}/${r.planned} 个界面${tail}`)
    } catch (e) {
      if ((e as Error).message === 'ABORTED') toast('info', '已取消生成')
      else toast('error', `生成失败：${(e as Error).message}`)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="ai-panel">
      <div className="ai-scroll">
        {/* 未配置模型提示 */}
        {!cfg && (
          <div className="alert alert-warn" style={{ marginBottom: 'var(--sp-3)' }}>
            <IconSparkles size={14} />
            <span className="flex-1">
              尚未配置模型，无法调用 AI 生成。可先加载下方示例体验编辑器。
            </span>
            <Button size="sm" onClick={() => useUiStore.getState().openOverlay('settings')}>
              去配置
            </Button>
          </div>
        )}

        {/* 生成中 */}
        {generating ? (
          <div className="gen-progress">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="spinner" />
              <span style={{ fontSize: 12, color: 'var(--text-1)', flex: 1 }}>{generatingStage}</span>
            </div>
            {generatingProgress.total > 0 && (
              <>
                <div className="progress">
                  <i style={{ width: `${(generatingProgress.done / generatingProgress.total) * 100}%` }} />
                </div>
                <div className="field-hint">
                  {generatingProgress.done} / {generatingProgress.total} 个页面
                </div>
              </>
            )}
            <Button
              size="sm"
              variant="danger"
              block
              onClick={() => {
                abortRef.current = true
              }}
            >
              取消生成
            </Button>
          </div>
        ) : (
          <>
            {/* 示例项目 */}
            {design.meta.source !== 'mock' && (
              <div style={{ marginBottom: 'var(--sp-4)' }}>
                <div className="block-title">没有模型？先试试示例</div>
                {MOCK_PROJECTS.map((m) => (
                  <div
                    key={m.id}
                    className="sample-card"
                    style={{ marginBottom: 'var(--sp-2)' }}
                    onClick={() => {
                      loadProject('', { fileVersion: '1.0', design: m.design })
                      useProjectStore.setState({ dirty: true })
                      toast('success', `已加载示例「${m.title}」`)
                    }}
                  >
                    <span className="sample-thumb">
                      <IconSparkles size={18} />
                    </span>
                    <div className="flex-1">
                      <div className="t">{m.title}</div>
                      <div className="d">{m.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 快速示例提示词 */}
            {!input && (
              <div style={{ marginBottom: 'var(--sp-3)' }}>
                <div className="block-title">试试这些描述</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {SAMPLE_PROMPTS.map((p) => (
                    <button key={p} className="sample-prompt" onClick={() => setInput(p)}>
                      <IconPlus size={11} />
                      <span>{p}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 输入区 */}
      <div className="ai-compose">
        <textarea
          className="ai-textarea"
          placeholder="描述你想要的产品，例如：&#10;一个咖啡点单小程序，包含菜单、商品详情、订单确认三个页面"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={generating}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              void onGenerate()
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
              e.preventDefault()
              void onEnhance()
            }
            // 仅当输入框内容仍是增强产出（用户未改）时才接管 Ctrl+Z，
            // 否则会抢走文本框自身的撤销。
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
              if (canUndo && !editedSinceEnhance) {
                e.preventDefault()
                onUndo()
              }
            }
          }}
        />

        {/* 增强结果条：文案已在输入框内，这里只做状态说明与撤回 */}
        {justEnhanced && !generating && (
          <div className="ai-hint" style={{ marginTop: 'var(--sp-2)' }}>
            <IconWand size={11} />
            <span className="flex-1">
              已增强 · {levelLabel(level)}
              {notes.length > 0 && ` · 补全了：${notes[0]}${notes.length > 1 ? ` 等 ${notes.length} 项` : ''}`}
              {usedLLM && ' · 由模型生成'}
            </span>
            <button className="token-chip" onClick={onUndo} disabled={!canUndo} title="撤回上一次增强 (Ctrl+Z)">
              <IconUndo size={10} /> 撤回
            </button>
            <button className="token-chip" onClick={() => void onEnhance()} disabled={enhancing}>
              <IconRefresh size={10} /> 再次增强
            </button>
          </div>
        )}

        {/* 分级建议：仅在建议增强且尚未增强时显示 */}
        {cls?.suggest && !justEnhanced && !generating && (
          <div className="ai-hint">
            <IconInfo size={11} />
            <span className="flex-1">
              当前描述为 {LEVEL_LABEL[cls.level]}
              {cls.reasons.length > 0 && `（${cls.reasons[0]}）`}，建议先增强
            </span>
          </div>
        )}

        {/* F-ST-01：生成时套用的设计规范 */}
        {!generating && (
          <div className="block" style={{ marginTop: 'var(--sp-3)' }}>
            <div className="field-label">
              <span>设计规范</span>
              <span className="flex-1" />
              <span className="badge">F-ST-01</span>
            </div>
            <select
              className="input"
              style={{ height: 28, fontSize: 11, marginTop: 4 }}
              value={genSpecId}
              onChange={(e) => setGenSpecId(e.target.value)}
            >
              <option value="">不指定（由模型自由定稿）</option>
              {specs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.source === 'builtin' ? ' · 内置' : ''}
                </option>
              ))}
            </select>
            <div className="field-hint">
              {genSpecId
                ? '生成时直接套用该规范的颜色与规则，保证跨页一致'
                : '不指定时由模型自行定稿 Token'}
            </div>
          </div>
        )}

        {/* F-PM-05：生成的目标界面数 N 与落点 */}
        {!generating && (
          <div className="block" style={{ marginTop: 'var(--sp-3)' }}>
            <div className="field-label">
              <span>界面数量 N</span>
              <span className="flex-1" />
              <span className="badge">F-PM-05</span>
            </div>
            <div className="gen-n">
              <button
                className="gen-n-btn"
                onClick={() => setGenCount((n) => Math.max(1, n - 1))}
                disabled={genCount <= 1}
                title="减少"
              >
                −
              </button>
              <input
                className="input gen-n-input"
                type="number"
                min={1}
                max={plannedHard}
                value={genCount}
                onChange={(e) => {
                  const n = Math.trunc(Number(e.target.value))
                  setGenCount(Number.isFinite(n) && n > 0 ? n : 1)
                }}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button
                className="gen-n-btn"
                onClick={() => setGenCount((n) => Math.min(plannedHard, n + 1))}
                disabled={genCount >= plannedHard}
                title="增加"
              >
                +
              </button>
              <div className="gen-n-presets">
                {[1, 3, 5, 8].map((n) => (
                  <button
                    key={n}
                    className={`ifc-btn ${genCount === n ? 'on' : ''}`}
                    disabled={n > plannedHard}
                    onClick={() => setGenCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="gen-mode">
              <label className={`gen-mode-item ${genMode === 'replace' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="gen-mode"
                  checked={genMode === 'replace'}
                  onChange={() => setGenMode('replace')}
                />
                覆盖当前项目
              </label>
              <label className={`gen-mode-item ${genMode === 'append' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="gen-mode"
                  checked={genMode === 'append'}
                  onChange={() => setGenMode('append')}
                />
                追加到当前项目（还可加 {remaining} 个）
              </label>
            </div>

            <div className="field-hint">
              {genMode === 'replace'
                ? `将以 ${genCount} 个界面替换当前项目的全部内容（可 Ctrl+Z 撤销）`
                : `将在现有 ${design.pages.length} 个界面之后追加 ${genCount} 个，并自动按模块分组`}
              {!decision.allowed && (
                <>
                  <br />
                  <span style={{ color: 'var(--warning-text)' }}>{decision.message}</span>
                </>
              )}
            </div>
            <div className="row" style={{ marginTop: 6, gap: 6 }}>
              <button
                className="ifc-btn"
                onClick={() =>
                  useProjectStore.getState().setQuota({ planned: genCount })
                }
                title="把这个数量记为项目的计划界面数"
              >
                记为计划数
              </button>
              <button
                className="ifc-btn"
                onClick={() => setGenCount(Math.max(1, design.pages.length))}
                title="对齐当前实际界面数"
              >
                对齐当前
              </button>
            </div>
          </div>
        )}

        <div className="ai-actions">
          <Button
            size="sm"
            variant="ghost"
            onClick={onEnhance}
            disabled={generating || enhancing || !input.trim()}
            title="就地润色并补全提示词，直接覆盖输入框内容 (Ctrl+K)"
          >
            {enhancing ? <span className="spinner" /> : <IconWand size={12} />}
            增强提示词
          </Button>
          <div className="flex-1" />
          <Button
            variant="default"
            size="sm"
            onClick={() => void onGenerateInterfaces()}
            disabled={generating || !input.trim() || !decision.allowed}
            title={`按 N=${genCount} ${genMode === 'append' ? '追加' : '覆盖'}生成`}
          >
            <IconSparkles size={12} />
            按 N 生成
          </Button>
          <Button variant="primary" size="sm" onClick={onGenerate} disabled={generating || !input.trim()}>
            <IconSparkles size={12} />
            生成 (Ctrl+Enter)
          </Button>
        </div>
      </div>
    </div>
  )
}
