// src/components/hub/CreateProjectModal.tsx —— 新建项目向导（F-PM-01 / F-PM-05）
//
// 三条路径收口在一个向导里（空白 / 模板 / AI 生成），加一个「导入 DESIGN.md」旁路。
// 关键点：**界面数量 N 在这里就被确定**，而不是留给生成时自由发挥。
import { useEffect, useMemo, useState } from 'react'
import type { DesignSpec, Device, InterfaceQuota } from '@shared/design'
import { DEFAULT_QUOTA, GLOBAL_MAX_PAGES } from '@shared/design'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, CheckRow } from '@/components/ui/Field'
import { IconSparkles, IconTag, IconPlus, IconPalette } from '@/components/ui/Icons'
import { useUiStore } from '@/stores/ui.store'
import { INTERFACE_TEMPLATES } from '@/services/design/interface-templates'
import { BUILTIN_SPECS, summarizeSpec } from '@/services/design/specs'
import { createProject, type CreateSource } from '@/services/project/hub-actions'
import { effectiveHardLimit } from '@/services/project/quota'
import {
  fetchDesignMd,
  listLibrarySpecs,
  saveSpecToLibrary,
} from '@/services/design/spec-library'
import { parseDesignMd, specFromParsed } from '@shared/design-md'

const DEVICES: Array<{ id: Device; label: string; hint: string }> = [
  { id: 'MOBILE', label: '移动端', hint: '390 × 844' },
  { id: 'TABLET', label: '平板', hint: '834 × 1112' },
  { id: 'DESKTOP', label: '桌面端', hint: '1440 × 900' },
  { id: 'RESPONSIVE', label: '响应式', hint: '1280 × 800' },
]

type Source = Extract<CreateSource, 'blank' | 'template' | 'ai'>

export function CreateProjectModal() {
  const overlay = useUiStore((s) => s.overlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const open = overlay === 'create-project'
  const toast = useUiStore((s) => s.toast)

  const [source, setSource] = useState<Source>('blank')
  const [name, setName] = useState('')
  const [device, setDevice] = useState<Device>('MOBILE')
  const [planned, setPlanned] = useState(1)
  const [softLimit, setSoftLimit] = useState(DEFAULT_QUOTA.softLimit)
  const [hardLimit, setHardLimit] = useState(DEFAULT_QUOTA.hardLimit)
  const [strategy, setStrategy] = useState<InterfaceQuota['strategy']>('single')
  const [templateId, setTemplateId] = useState(INTERFACE_TEMPLATES[0].id)
  const [prompt, setPrompt] = useState('')

  /** 规范来源：内置 id / 库内规范 id / 项目专用（临时导入，仅本次） */
  const [specChoice, setSpecChoice] = useState<string>('')
  const [library, setLibrary] = useState<DesignSpec[]>([])
  const [tempSpec, setTempSpec] = useState<DesignSpec | null>(null)
  const [mdText, setMdText] = useState('')
  const [mdUrl, setMdUrl] = useState('')
  const [busy, setBusy] = useState(false)

  /* 打开时重置，并载入规范库 */
  useEffect(() => {
    if (!open) return
    setSource('blank')
    setName('')
    setDevice('MOBILE')
    setPlanned(1)
    setSoftLimit(DEFAULT_QUOTA.softLimit)
    setHardLimit(DEFAULT_QUOTA.hardLimit)
    setStrategy('single')
    setPrompt('')
    setSpecChoice('')
    setTempSpec(null)
    setMdText('')
    setMdUrl('')
    void listLibrarySpecs().then(setLibrary)
  }, [open])

  const allSpecs: DesignSpec[] = useMemo(() => [...BUILTIN_SPECS, ...library], [library])

  const selectedSpec: DesignSpec | null = useMemo(() => {
    if (specChoice === '__temp__') return tempSpec
    return allSpecs.find((s) => s.id === specChoice) ?? null
  }, [specChoice, allSpecs, tempSpec])

  const hard = Math.min(hardLimit === 0 ? GLOBAL_MAX_PAGES : hardLimit, GLOBAL_MAX_PAGES)
  const plannedExceedsHard = planned > hard

  const canCreate =
    name.trim().length > 0 &&
    !plannedExceedsHard &&
    (source !== 'template' || !!templateId) &&
    (!selectedSpec || true)

  const onParseMd = (text: string) => {
    const parsed = parseDesignMd(text)
    if (!parsed.tokens.color && !parsed.tokens.font && !parsed.tokens.radius) {
      toast('warn', '未能识别到任何 Token，请检查文档内容')
      return
    }
    const spec = specFromParsed(parsed, {
      name: parsed.name || `${name || '导入'}规范`,
      base: allSpecs[0]?.tokens,
    })
    setTempSpec(spec)
    setSpecChoice('__temp__')
    toast('success', `已解析规范「${spec.name}」（${Object.keys(spec.tokens.color ?? {}).length} 个颜色）`)
  }

  const onFetchUrl = async () => {
    if (!mdUrl.trim()) return
    const text = await fetchDesignMd(mdUrl.trim())
    if (!text) return
    setMdText(text)
    onParseMd(text)
  }

  const onSaveTempToLibrary = async () => {
    if (!tempSpec) return
    const list = await saveSpecToLibrary(tempSpec)
    setLibrary(list)
    setSpecChoice(tempSpec.id)
    setTempSpec(null)
  }

  const submit = async () => {
    if (!canCreate || busy) return
    setBusy(true)
    try {
      const tpl = INTERFACE_TEMPLATES.find((t) => t.id === templateId)
      const pagesFromTemplate = source === 'template' ? (tpl?.pages.length ?? 1) : planned
      await createProject({
        name: name.trim(),
        device,
        source,
        planned: source === 'ai' ? planned : pagesFromTemplate,
        softLimit,
        hardLimit,
        strategy,
        spec: selectedSpec,
        templateId: source === 'template' ? templateId : undefined,
        prompt: source === 'ai' ? prompt.trim() : undefined,
      })
      closeOverlay()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="新建项目"
      subtitle="一个项目可以容纳 N 个功能界面；这里先决定它打算做几屏"
      width={780}
      onClose={closeOverlay}
      footer={
        <>
          <span className="dim">
            {source === 'ai'
              ? '创建后进入编辑器，点「生成界面」即可产出'
              : `将创建 ${source === 'template' ? INTERFACE_TEMPLATES.find((t) => t.id === templateId)?.pages.length ?? 1 : planned} 个界面`}
          </span>
          <div className="flex-1" />
          <Button variant="ghost" onClick={closeOverlay}>
            取消
          </Button>
          <Button variant="primary" disabled={!canCreate || busy} onClick={() => void submit()}>
            {busy ? '正在创建…' : '创建项目'}
          </Button>
        </>
      }
    >
      <div className="modal-body hub-wizard">
        {/* ---------- 步骤 1：来源 ---------- */}
        <div className="wiz-step">
          <div className="wiz-step-no">1</div>
          <div className="wiz-step-body">
            <div className="wiz-step-title">从哪里开始</div>
            <div className="wiz-sources">
              <SourceCard
                active={source === 'blank'}
                icon={<IconPlus size={16} />}
                title="空白项目"
                desc="创建 N 个空界面，自己画"
                onClick={() => setSource('blank')}
              />
              <SourceCard
                active={source === 'template'}
                icon={<IconTag size={16} />}
                title="从模板"
                desc="登录流 / 列表详情 / 数据看板"
                onClick={() => setSource('template')}
              />
              <SourceCard
                active={source === 'ai'}
                icon={<IconSparkles size={16} />}
                title="AI 生成"
                desc="描述需求，自动产出 N 个界面"
                onClick={() => setSource('ai')}
              />
            </div>

            {source === 'template' && (
              <div className="wiz-template-list">
                {INTERFACE_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    className={`wiz-template ${templateId === t.id ? 'active' : ''}`}
                    onClick={() => setTemplateId(t.id)}
                  >
                    <div className="n">{t.name}</div>
                    <div className="d">{t.desc}</div>
                    <div className="m">
                      {t.pages.length} 个界面
                      {t.device ? ` · ${DEVICES.find((d) => d.id === t.device)?.label}` : ''}
                      {t.groupName ? ` · ${t.groupName}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {source === 'ai' && (
              <Field label="需求描述" hint="描述越具体，规划出的界面越贴合预期">
                <textarea
                  className="input"
                  rows={4}
                  placeholder="例如：一个面向年轻人的记账 App，需要首页概览、账单列表、预算设置、统计图表…"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </Field>
            )}
          </div>
        </div>

        {/* ---------- 步骤 2：基本参数 ---------- */}
        <div className="wiz-step">
          <div className="wiz-step-no">2</div>
          <div className="wiz-step-body">
            <div className="wiz-step-title">基本参数</div>
            <Field label="项目名称" required>
              <input
                className="input"
                placeholder="例如：记账 App"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field label="目标设备">
              <div className="wiz-devices">
                {DEVICES.map((d) => (
                  <button
                    key={d.id}
                    className={`wiz-device ${device === d.id ? 'active' : ''}`}
                    onClick={() => setDevice(d.id)}
                  >
                    <div className="n">{d.label}</div>
                    <div className="d">{d.hint}</div>
                  </button>
                ))}
              </div>
            </Field>

            <Field
              label="设计规范"
              hint="选定后，所有界面的 Token 都锁定到该规范，避免多屏风格漂移"
              extra={
                tempSpec ? (
                  <Button variant="ghost" size="sm" onClick={() => void onSaveTempToLibrary()}>
                    存入规范库
                  </Button>
                ) : undefined
              }
            >
              <select
                className="input"
                value={specChoice}
                onChange={(e) => setSpecChoice(e.target.value)}
              >
                <option value="">不绑定（由模型自由定稿）</option>
                {tempSpec && <option value="__temp__">本次导入：{tempSpec.name}</option>}
                <optgroup label="内置规范">
                  {BUILTIN_SPECS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.desc ?? ''}
                    </option>
                  ))}
                </optgroup>
                {library.length > 0 && (
                  <optgroup label="我的规范库">
                    {library.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Field>

            {selectedSpec && (
              <div className="wiz-spec-preview">
                <SpecSwatches spec={selectedSpec} />
              </div>
            )}

            {/* DESIGN.md 导入旁路 */}
            <details className="wiz-md">
              <summary>从 DESIGN.md 导入设计系统（可选）</summary>
              <div className="wiz-md-body">
                <p className="dim">
                  DESIGN.md 是跨 AI 设计工具通用的设计事实源（Stitch / Claude Code 等都能读）。
                  可粘贴内容，或给出一个网址由望舒抓取。
                </p>
                <div className="row">
                  <input
                    className="input"
                    placeholder="https://example.com/DESIGN.md"
                    value={mdUrl}
                    onChange={(e) => setMdUrl(e.target.value)}
                  />
                  <Button variant="default" onClick={() => void onFetchUrl()}>
                    抓取并解析
                  </Button>
                </div>
                <textarea
                  className="input"
                  rows={5}
                  placeholder={'# 我的设计系统\n\n| Token | 值 |\n| --- | --- |\n| color.primary | #4C8DFF |\n\n- ❌ 不要使用纯黑背景'}
                  value={mdText}
                  onChange={(e) => setMdText(e.target.value)}
                />
                <Button variant="ghost" onClick={() => onParseMd(mdText)}>
                  解析上面的内容
                </Button>
              </div>
            </details>
          </div>
        </div>

        {/* ---------- 步骤 3：界面数量 N ---------- */}
        <div className="wiz-step">
          <div className="wiz-step-no">3</div>
          <div className="wiz-step-body">
            <div className="wiz-step-title">
              界面数量 N
              <span className="dim">（计划 / 软上限 / 硬上限，三档各司其职）</span>
            </div>

            <Field
              label={`计划界面数：${planned}`}
              hint="生成时以此为目标数。之后仍可随时手动增删，不受此值限制。"
            >
              <input
                type="range"
                min={1}
                max={Math.max(1, Math.min(30, hard))}
                value={planned}
                onChange={(e) => setPlanned(Number(e.target.value))}
                className="wiz-range"
              />
              <div className="wiz-chips">
                {[1, 3, 5, 8, 12].map((n) => (
                  <button
                    key={n}
                    className={`wiz-chip ${planned === n ? 'active' : ''}`}
                    disabled={n > hard}
                    onClick={() => setPlanned(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Field>

            <div className="row">
              <Field label="软上限" hint="超过会提示但允许">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={999}
                  value={softLimit}
                  onChange={(e) => setSoftLimit(Number(e.target.value))}
                />
              </Field>
              <Field label="硬上限" hint="超过禁止；填 0 表示不限">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={999}
                  value={hardLimit}
                  onChange={(e) => setHardLimit(Number(e.target.value))}
                />
              </Field>
            </div>

            <Field label="组织方式">
              <select
                className="input"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as InterfaceQuota['strategy'])}
              >
                <option value="single">单屏为主</option>
                <option value="flow">以流程为主（自动连线跳转）</option>
                <option value="batch">批量铺开（多个模块并行）</option>
              </select>
            </Field>

            <CheckRow checked onChange={() => undefined}>
              <span className="dim">
                界面数量 N 只是「计划值」，不是限制 —— 你可以随时在界面列表里追加、复制或让 AI 续生成。
              </span>
            </CheckRow>

            {plannedExceedsHard && (
              <div className="wiz-warn">计划界面数（{planned}）超过了硬上限（{hard}），请调小计划数或提高硬上限。</div>
            )}
            {hardLimit > GLOBAL_MAX_PAGES && (
              <div className="wiz-warn">
                硬上限超过全局兜底 {GLOBAL_MAX_PAGES}，实际生效值以 {GLOBAL_MAX_PAGES} 为准。
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function SourceCard({
  active,
  icon,
  title,
  desc,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button className={`wiz-source ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="ic">{icon}</span>
      <span className="n">{title}</span>
      <span className="d">{desc}</span>
    </button>
  )
}

/** 规范色卡预览：让用户在选择前就看到"这套规范长什么样" */
export function SpecSwatches({ spec }: { spec: DesignSpec }) {
  const summary = summarizeSpec(spec)
  const colors = Object.entries(spec.tokens.color ?? {}).slice(0, 10)
  const radiusMd = spec.tokens.radius?.md
  return (
    <div className="spec-swatches">
      <div className="row-wrap">
        {colors.map(([k, v]) => (
          <span key={k} className="spec-swatch" title={`${k}: ${v}`}>
            <i style={{ background: v }} />
          </span>
        ))}
      </div>
      <div className="dim spec-swatches-meta">
        <IconPalette size={11} /> {spec.name}
        {summary.colorCount ? ` · ${summary.colorCount} 色` : ''}
        {typeof radiusMd === 'number' ? ` · 圆角 ${radiusMd}` : ''}
        {summary.donts.length ? ` · ${summary.donts.length} 条禁止规则` : ''}
      </div>
    </div>
  )
}
