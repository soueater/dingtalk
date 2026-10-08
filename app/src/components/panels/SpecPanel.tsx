// src/components/panels/SpecPanel.tsx
// F-ST-01 设计规范面板：绑定 / 切换 / 派生 / 导入 / 导出 / 漂移校验 + 一键修正
// 扩展：自定义设计风格 —— 由文字描述生成 / 从 HTML 提炼 / 从图片提炼，保存后可复用
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DesignSpec, Tokens } from '@shared/design'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'
import { useConfigStore } from '@/stores/config.store'
import { Button } from '@/components/ui/Button'
import {
  IconCheck,
  IconEdit,
  IconExport,
  IconLock,
  IconPalette,
  IconPlus,
  IconSparkles,
  IconTrash,
  IconWarning,
} from '@/components/ui/Icons'
import {
  type DriftKind,
  DEFAULT_DONTS,
  createSpec,
  detectDrift,
  exportSpecJson,
  exportSpecMarkdown,
  fixDrift,
  forkBuiltinSpec,
  importSpec,
  listSpecs,
  previewSwitch,
  resolveSpecForPage,
  summarizeSpec,
  tokensForPage,
} from '@/services/design/specs'
import {
  describeTokens,
  extractTokensFromHtml,
  quantizePixels,
  tokensFromPalette,
} from '@/services/design/style-extract'
import { specFromText } from '@/services/ai/spec-from-text'
import { parseDesignMd, serializeDesignMd, specFromParsed } from '@shared/design-md'
import {
  fetchDesignMd,
  listLibrarySpecs,
  removeLibrarySpec,
  saveSpecToLibrary,
} from '@/services/design/spec-library'

const DRIFT_LABEL: Record<DriftKind, string> = {
  'literal-color': '字面色值',
  'missing-token': '失效引用',
  'rule-violation': '违反规范',
  'off-palette': '规范外颜色',
}

/** 读取图片文件 → 采样像素 → 提炼 Token（浏览器侧，依赖 canvas 与 object URL 的 blob 白名单） */
async function tokensFromImageFile(file: File): Promise<Tokens> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('图片解码失败，请换一张 PNG / JPG 图片'))
      el.src = url
    })
    // 缩到最长边 320px 再采样：足够代表主色调，且避免大图卡顿
    const w = Math.max(1, Math.min(img.naturalWidth || 320, 320))
    const h = Math.max(1, Math.round(((img.naturalHeight || 320) / (img.naturalWidth || 320)) * w))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前环境无法创建画布上下文')
    ctx.drawImage(img, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    return tokensFromPalette(quantizePixels(data, 3))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function SpecPanel() {
  const design = useProjectStore((s) => s.design)
  const activePageId = useProjectStore((s) => s.activePageId)
  const bindSpec = useProjectStore((s) => s.bindSpec)
  const bindPageSpec = useProjectStore((s) => s.bindPageSpec)
  const upsertSpec = useProjectStore((s) => s.upsertSpec)
  const removeSpec = useProjectStore((s) => s.removeSpec)
  const commit = useProjectStore((s) => s.commit)
  const toast = useUiStore((s) => s.toast)

  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /* F-PM-06：DESIGN.md 互操作 + 用户级规范库 */
  const [mdOpen, setMdOpen] = useState(false)
  const [mdText, setMdText] = useState('')
  const [mdUrl, setMdUrl] = useState('')
  const [lib, setLib] = useState<DesignSpec[]>([])

  useEffect(() => {
    void listLibrarySpecs().then(setLib)
  }, [])

  const page = design.pages.find((p) => p.id === activePageId)
  const specs = useMemo(() => listSpecs(design), [design.specs])
  const projectSpec = useMemo(() => resolveSpecForPage(design, null), [design.meta.specId, design.specs])
  const pageSpec = useMemo(() => resolveSpecForPage(design, page), [design, page?.specId])
  const report = useMemo(() => detectDrift(design), [design])

  /** 绑定（含「切换前影响面提示」） */
  const applySpec = (spec: DesignSpec | null, scope: 'project' | 'page') => {
    if (scope === 'project' && spec) {
      const preview = previewSwitch(design, spec)
      if (preview.brokenRefs > 0 || preview.overriddenLiterals > 0) {
        const lines = [
          `切换为「${spec.name}」后将产生以下影响：`,
          preview.overriddenLiterals > 0 ? `· ${preview.overriddenLiterals} 处字面色值不再匹配规范` : '',
          preview.brokenRefs > 0 ? `· ${preview.brokenRefs} 处 Token 引用在规范中不存在` : '',
          preview.missingGroups.length ? `· 规范缺少 ${preview.missingGroups.join(' / ')} 分组` : '',
          '',
          '继续切换？',
        ].filter(Boolean)
        if (!window.confirm(lines.join('\n'))) return
      }
    }
    if (scope === 'project') bindSpec(spec)
    else if (page) bindPageSpec(page.id, spec)
  }

  /** 一键修正：把可自动处理的漂移改掉 */
  const fixAll = (kinds?: DriftKind[]) => {
    const res = fixDrift(design, report.issues, { kinds })
    if (!res.changed) {
      toast('info', res.skipped ? '这些项无法自动修正，需手动调整' : '没有可修正的项')
      return
    }
    commit(`修正设计规范偏差`, () => res.design, { coalesceKey: 'fix-drift' })
    toast('success', `已修正 ${res.changed} 处${res.skipped ? `，${res.skipped} 处需手动处理` : ''}`)
  }

  /* ---------------- 自定义设计风格 ---------------- */

  /** 提炼出的风格草稿：确认命名后才落库，避免误存 */
  const [draft, setDraft] = useState<{ tokens: Tokens; name: string; desc: string; via: string } | null>(null)
  const [styleDesc, setStyleDesc] = useState('')
  const [extracting, setExtracting] = useState(false)
  const htmlRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLInputElement>(null)

  /** 由文字描述生成风格（需要模型） */
  const onStyleFromText = async () => {
    const desc = styleDesc.trim()
    if (!desc) {
      toast('warn', '请先描述你想要的风格')
      return
    }
    // 运行时取当前配置，避免闭包读到旧值；若尚未加载则先加载一次
    let cfg = useConfigStore.getState().current()
    if (!cfg) {
      await useConfigStore.getState().load()
      cfg = useConfigStore.getState().current()
    }
    if (!cfg) {
      toast('warn', '由描述生成风格需要先配置模型')
      return
    }
    setExtracting(true)
    try {
      const spec = await specFromText({
        configId: cfg.id,
        description: desc,
        base: tokensForPage(design, page),
      })
      setDraft({ tokens: spec.tokens, name: spec.name, desc, via: '文字描述' })
      toast('success', '风格已生成，确认后保存')
    } catch (e) {
      toast('error', `生成失败：${(e as Error).message}`)
    } finally {
      setExtracting(false)
    }
  }

  /** 从 HTML 源码提炼（离线） */
  const onStyleFromHtml = async (file: File) => {
    setExtracting(true)
    try {
      const text = await file.text()
      if (!text.trim()) {
        toast('error', '文件内容为空')
        return
      }
      const tokens = extractTokensFromHtml(text)
      setDraft({
        tokens,
        name: file.name.replace(/\.(html?|htm)$/i, '').slice(0, 24) || 'HTML 提炼风格',
        desc: `从 ${file.name} 提炼`,
        via: 'HTML',
      })
      toast('success', '已提炼，确认后保存')
    } catch (e) {
      toast('error', `提炼失败：${(e as Error).message}`)
    } finally {
      setExtracting(false)
      if (htmlRef.current) htmlRef.current.value = ''
    }
  }

  /** 从图片提炼配色（离线，画布采样） */
  const onStyleFromImage = async (file: File) => {
    setExtracting(true)
    try {
      const tokens = await tokensFromImageFile(file)
      setDraft({
        tokens,
        name: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 24) || '图片提炼风格',
        desc: `从 ${file.name} 提炼`,
        via: '图片',
      })
      toast('success', '已提炼，确认后保存')
    } catch (e) {
      toast('error', `提炼失败：${(e as Error).message}`)
    } finally {
      setExtracting(false)
      if (imgRef.current) imgRef.current.value = ''
    }
  }

  const saveDraft = () => {
    if (!draft) return
    const spec = createSpec({
      name: draft.name,
      desc: draft.desc,
      tokens: draft.tokens,
      source: 'imported',
      rules: { donts: [...DEFAULT_DONTS] },
    })
    upsertSpec(spec)
    setDraft(null)
    setStyleDesc('')
    toast('success', `已保存风格「${spec.name}」，可在上方绑定使用`)
  }

  const doExport = async (spec: DesignSpec, format: 'json' | 'md') => {
    const text = format === 'json' ? exportSpecJson(spec) : exportSpecMarkdown(spec)
    const safe = spec.name.replace(/[\\/:*?"<>|]/g, '_')
    const ext = format === 'json' ? 'json' : 'md'
    const filters = [
      format === 'json'
        ? { name: 'JSON', extensions: ['json'] }
        : { name: 'Markdown', extensions: ['md'] },
    ]
    try {
      const res = await window.dsa?.exporter?.saveText?.(`${safe}.${ext}`, text, filters)
      if (res?.ok && res.data?.ok) {
        toast('success', `已导出 ${safe}.${ext}`)
      } else if (res?.ok && res.data?.canceled) {
        // 用户主动取消，不提示
      } else if (res && !res.ok) {
        toast('warn', res.message ?? '导出失败')
      }
    } catch {
      // 纯浏览器调试环境（无 preload）降级：复制到剪贴板
      try {
        await navigator.clipboard.writeText(text)
        toast('info', '当前环境无法直接存盘，已复制规范内容到剪贴板')
      } catch {
        toast('error', '导出失败')
      }
    }
  }

  const doImport = async (file: File) => {
    setBusy(true)
    try {
      const text = await file.text()
      const res = importSpec(text)
      res.warnings.forEach((w) => toast('warn', w))
      if (!res.spec) {
        toast('error', '导入失败：文件不是可识别的设计规范')
        return
      }
      upsertSpec(res.spec)
      toast('success', `已导入规范「${res.spec.name}」`)
    } catch (e) {
      toast('error', `导入失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /* ---------------- F-PM-06：DESIGN.md 互操作 ---------------- */

  /** 当前生效的规范（项目级优先，否则按当前项目 Token 现造一份） */
  const effectiveSpec = (): DesignSpec =>
    projectSpec ?? {
      id: 'current',
      name: design.meta.name,
      desc: '由望舒从当前项目导出',
      source: 'derived',
      tokens: design.tokens,
      createdAt: new Date().toISOString(),
    }

  /** 导出标准 DESIGN.md（跨工具通用：Stitch / Claude Code 等都能读） */
  const onExportDesignMd = async () => {
    const spec = effectiveSpec()
    const md = serializeDesignMd(spec)
    const safe = spec.name.replace(/[\\/:*?"<>|]/g, '_')
    try {
      const res = await window.dsa?.exporter?.saveText?.(`${safe}-DESIGN.md`, md, [
        { name: 'Markdown', extensions: ['md'] },
      ])
      if (res?.ok && res.data?.ok) toast('success', `已导出 ${safe}-DESIGN.md`)
      else if (res?.ok && res.data?.canceled) {
        /* 用户取消 */
      } else {
        await navigator.clipboard.writeText(md)
        toast('info', '当前环境无法直接存盘，已复制 DESIGN.md 内容到剪贴板')
      }
    } catch {
      toast('error', '导出失败')
    }
  }

  /** 解析 DESIGN.md → 规范（先预览，再由用户决定存进哪里） */
  const onParseMd = (text: string) => {
    const parsed = parseDesignMd(text)
    const has = parsed.tokens.color || parsed.tokens.font || parsed.tokens.radius
    if (!has) {
      toast('warn', '未能从文档中识别到任何设计 Token，请检查格式')
      return
    }
    const spec = specFromParsed(parsed, {
      name: parsed.name || '导入的 DESIGN.md',
      base: specs[0]?.tokens,
    })
    setDraft({
      tokens: spec.tokens,
      name: spec.name,
      desc: spec.desc ?? '由 DESIGN.md 导入',
      via: 'DESIGN.md',
    })
    const c = Object.keys(spec.tokens.color ?? {}).length
    toast('success', `已解析「${spec.name}」（${c} 个颜色 Token），确认后保存`)
  }

  const onFetchMdUrl = async () => {
    if (!mdUrl.trim()) {
      toast('warn', '请输入 DESIGN.md 的网址')
      return
    }
    const text = await fetchDesignMd(mdUrl.trim())
    if (!text) return
    setMdText(text)
    onParseMd(text)
  }

  /** 把当前规范存进用户级规范库（跨项目复用） */
  const onSaveToLib = async () => {
    const list = await saveSpecToLibrary(effectiveSpec())
    if (list.length) setLib(list)
  }

  const onLoadFromLib = (s: DesignSpec) => {
    /* 库里的规范先复制进项目，再绑定，避免跨项目共享同一 id 造成混淆 */
    const copy: DesignSpec = { ...s, id: `spec_${Date.now().toString(36)}`, source: 'imported' }
    upsertSpec(copy)
    bindSpec(copy)
    toast('success', `已应用规范库中的「${s.name}」`)
  }

  const onRemoveFromLib = async (s: DesignSpec) => {
    if (!window.confirm(`从规范库删除「${s.name}」？`)) return
    setLib(await removeLibrarySpec(s.id))
  }

  return (
    <div>
      {/* ------------------ F-PM-06：DESIGN.md 互操作 ------------------ */}
      <div className="block">
        <div className="block-title">
          DESIGN.md 互操作
          <span className="badge" style={{ marginLeft: 6 }}>
            F-PM-06
          </span>
        </div>
        <div className="field-hint" style={{ marginBottom: 6 }}>
          DESIGN.md 是跨 AI 设计工具通用的设计事实源。导出后可直接喂给其他工具；
          也能把别处产出的 DESIGN.md 引进来，变成望舒里的规范。
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" variant="ghost" onClick={() => void onExportDesignMd()}>
            <IconExport size={11} /> 导出 DESIGN.md
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void onSaveToLib()}>
            <IconPalette size={11} /> 存入规范库
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMdOpen((v) => !v)}>
            {mdOpen ? '收起导入' : '从 DESIGN.md 导入'}
          </Button>
        </div>

        {mdOpen && (
          <div className="md-import">
            <div className="row" style={{ gap: 6 }}>
              <input
                className="input"
                style={{ height: 28, fontSize: 11, flex: 1 }}
                placeholder="https://example.com/DESIGN.md"
                value={mdUrl}
                onChange={(e) => setMdUrl(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <Button size="sm" onClick={() => void onFetchMdUrl()}>
                抓取
              </Button>
            </div>
            <textarea
              className="input"
              style={{ minHeight: 90, fontSize: 11, marginTop: 6, resize: 'vertical' }}
              placeholder={'粘贴 DESIGN.md 内容，例如：\n\n| Token | 值 |\n| --- | --- |\n| color.primary | #4C8DFF |\n\n- ❌ 不要使用纯黑背景'}
              value={mdText}
              onChange={(e) => setMdText(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <Button size="sm" onClick={() => onParseMd(mdText)} disabled={!mdText.trim()}>
                解析为规范
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setMdText('')
                  setMdUrl('')
                }}
              >
                清空
              </Button>
            </div>
          </div>
        )}

        {/* 用户级规范库 */}
        <div className="block-title" style={{ marginTop: 12 }}>
          规范库（跨项目）
          <span className="dim" style={{ marginLeft: 6, fontWeight: 400 }}>
            {lib.length} 份
          </span>
        </div>
        {lib.length === 0 ? (
          <div className="field-hint">还没有保存过规范。上方「存入规范库」可把当前规范固化下来。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {lib.map((s) => (
              <div key={s.id} className="list-item">
                <div className="flex-1">
                  <div className="title">{s.name}</div>
                  <div className="sub">
                    {summarizeSpec(s).colorCount} 色 · {summarizeSpec(s).radiusCount} 圆角
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => onLoadFromLib(s)} title="应用到当前项目">
                  应用
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  title="从规范库删除"
                  onClick={() => void onRemoveFromLib(s)}
                >
                  <IconTrash size={11} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ------------------ 当前绑定 ------------------ */}
      <div className="block">
        <div className="block-title">当前设计规范</div>
        <div className="field">
          <div className="field-label">
            <span>项目级（默认）</span>
            <span className="flex-1" />
            {projectSpec && <span className="badge">{sourceLabel(projectSpec)}</span>}
          </div>
          <select
            className="input"
            style={{ height: 28, fontSize: 11 }}
            value={design.meta.specId ?? ''}
            onChange={(e) => applySpec(specs.find((s) => s.id === e.target.value) ?? null, 'project')}
          >
            <option value="">未绑定（使用项目自带 Token）</option>
            {specs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {sourceLabel(s) === '内置' ? ' · 内置' : ''}
              </option>
            ))}
          </select>
        </div>

        {page && (
          <div className="field" style={{ marginTop: 8 }}>
            <div className="field-label">
              <span>页面级覆盖 · {page.name}</span>
            </div>
            <select
              className="input"
              style={{ height: 28, fontSize: 11 }}
              value={page.specId ?? ''}
              onChange={(e) => applySpec(specs.find((s) => s.id === e.target.value) ?? null, 'page')}
            >
              <option value="">跟随项目级</option>
              {specs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <div className="field-hint">页面级设置会覆盖项目级，仅影响当前页面</div>
          </div>
        )}

        {projectSpec && <SpecCard spec={projectSpec} />}
      </div>

      {/* ------------------ 漂移校验 ------------------ */}
      <div className="block">
        <div className="block-title">规范校验</div>
        {!report.spec ? (
          <div className="field-hint">未绑定规范，无法校验。请先在上方选择一套规范。</div>
        ) : report.issues.length === 0 ? (
          <div className="alert alert-success" style={{ fontSize: 11 }}>
            <IconCheck size={13} />
            <span>已扫描 {report.scannedPages} 页，未发现规范偏差</span>
          </div>
        ) : (
          <>
            <div className="field-hint" style={{ marginBottom: 6 }}>
              已扫描 {report.scannedPages} 页，发现 {report.issues.length} 处偏差：
            </div>
            <div className="seg-row" style={{ flexWrap: 'wrap', gap: 4 }}>
              {(Object.keys(DRIFT_LABEL) as DriftKind[]).map((k) =>
                report.counts[k] > 0 ? (
                  <span key={k} className="badge badge-warn">
                    {DRIFT_LABEL[k]} {report.counts[k]}
                  </span>
                ) : null,
              )}
            </div>

            <div style={{ marginTop: 8, maxHeight: 190, overflow: 'auto' }}>
              {report.issues.slice(0, 60).map((i, idx) => (
                <div key={`${i.pageId}:${i.nodeId}:${i.path}:${idx}`} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <div className="flex-1">
                    <div className="title">{i.nodeName ?? i.nodeId}</div>
                    <div className="sub">
                      {i.pageName} · {i.message}
                    </div>
                  </div>
                </div>
              ))}
              {report.issues.length > 60 && (
                <div className="field-hint" style={{ padding: '4px 0' }}>
                  仅显示前 60 条，共 {report.issues.length} 条
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <Button size="sm" onClick={() => fixAll(['literal-color'])}>
                <IconEdit size={11} /> 字面色转引用
              </Button>
              <Button size="sm" variant="ghost" onClick={() => fixAll(['rule-violation'])}>
                修正规则违规
              </Button>
              <Button size="sm" variant="ghost" onClick={() => fixAll()}>
                全部修正
              </Button>
            </div>
            {report.counts['off-palette'] > 0 && (
              <div className="field-hint" style={{ marginTop: 6 }}>
                <IconWarning size={11} /> {report.counts['off-palette']} 处规范外颜色无法自动映射，需手动处理
              </div>
            )}
          </>
        )}
      </div>

      {/* ------------------ 规范库 ------------------ */}
      <div className="block">
        <div className="block-title">规范库（{specs.length}）</div>
        {specs.map((s) => {
          const active = s.id === design.meta.specId || s.id === page?.specId
          return (
            <div key={s.id} className={`list-item ${active ? 'selected' : ''}`}>
              <div className="flex-1">
                <div className="title">
                  {s.name}
                  {s.source === 'builtin' && (
                    <span className="badge" style={{ marginLeft: 6 }}>
                      <IconLock size={9} /> 内置
                    </span>
                  )}
                </div>
                <div className="sub">
                  {summarizeSpec(s).colorCount} 色 · {summarizeSpec(s).radiusCount} 圆角
                  {s.desc ? ` · ${s.desc}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  title="导出 JSON"
                  onClick={() => doExport(s, 'json')}
                >
                  <IconExport size={11} />
                </Button>
                {s.source !== 'builtin' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    title="删除规范"
                    onClick={() => removeSpec(s.id)}
                  >
                    <IconTrash size={11} />
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ------------------ 自定义设计风格 ------------------ */}
      <div className="block">
        <div className="block-title">自定义设计风格</div>

        {!draft ? (
          <div className="field">
            <div className="field-label">
              <span>用一句话描述风格</span>
            </div>
            <textarea
              className="input"
              style={{ minHeight: 56, fontSize: 11, resize: 'vertical' }}
              placeholder="例如：深色科技感，霓虹蓝主色，大圆角，紧凑的标题层级"
              value={styleDesc}
              onChange={(e) => setStyleDesc(e.target.value)}
              disabled={extracting}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <Button size="sm" onClick={() => void onStyleFromText()} disabled={extracting || !styleDesc.trim()}>
                {extracting ? <span className="spinner" /> : <IconSparkles size={11} />} 由描述生成
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={extracting}
                onClick={() => htmlRef.current?.click()}
                title="读入 HTML 源码，解析其中 CSS 的配色 / 圆角 / 字体"
              >
                <IconPalette size={11} /> 从 HTML 提炼
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={extracting}
                onClick={() => imgRef.current?.click()}
                title="读入图片，采样像素归纳主色调"
              >
                <IconPalette size={11} /> 从图片提炼
              </Button>
            </div>
            <div className="field-hint" style={{ marginTop: 6 }}>
              HTML 与图片在本地解析，无需模型；由描述生成需要已配置模型。
            </div>
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
            <div className="field-label" style={{ marginBottom: 6 }}>
              <span>提炼结果预览 · 来自{draft.via}</span>
              <span className="flex-1" />
              <button className="token-chip" onClick={() => setDraft(null)}>
                取消
              </button>
            </div>
            <div className="token-chips" style={{ marginBottom: 8 }}>
              {Object.entries(draft.tokens.color ?? {})
                .slice(0, 18)
                .map(([k, v]) => (
                  <span key={k} className="token-chip" title={`${k} = ${v}`}>
                    <i style={{ background: v }} />
                    {k}
                  </span>
                ))}
            </div>
            <div className="field-hint" style={{ marginBottom: 8 }}>
              提炼到：{describeTokens(draft.tokens).join(' · ')}
            </div>
            <div className="field">
              <div className="field-label">
                <span>风格名称</span>
              </div>
              <input
                className="input"
                style={{ height: 28, fontSize: 11 }}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="给这套风格起个名字"
              />
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <Button size="sm" onClick={saveDraft} disabled={!draft.name.trim()}>
                <IconPlus size={11} /> 保存风格
              </Button>
            </div>
            <div className="field-hint" style={{ marginTop: 6 }}>
              保存后会出现在「规范库」中，可绑定到项目或单个页面，也能导出复用。
            </div>
          </div>
        )}

        <input
          ref={htmlRef}
          type="file"
          accept=".html,.htm,text/html"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onStyleFromHtml(f)
          }}
        />
        <input
          ref={imgRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onStyleFromImage(f)
          }}
        />
      </div>

      {/* ------------------ 操作 ------------------ */}
      <div className="block">
        <div className="block-title">新建 / 导入</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button
            size="sm"
            onClick={() => {
              const preset = specs.find((s) => s.source === 'builtin')
              const derived = preset ? forkBuiltinSpec(preset.id) : null
              if (derived) {
                upsertSpec(derived)
                toast('success', `已从「${preset!.name}」创建可编辑副本`)
              } else {
                toast('warn', '暂无可派生的内置规范')
              }
            }}
          >
            <IconPlus size={11} /> 从内置派生
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
            <IconPalette size={11} /> 导入规范文件
          </Button>
          {projectSpec && (
            <Button size="sm" variant="ghost" onClick={() => doExport(projectSpec, 'md')}>
              导出 Markdown
            </Button>
          )}
        </div>
        <div className="field-hint" style={{ marginTop: 6 }}>
          支持望舒规范 JSON（`*.json`）与含 JSON 块的 Markdown（对齐 Stitch design.md）
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.md,.txt,application/json,text/markdown"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void doImport(f)
          }}
        />
      </div>
    </div>
  )
}

function sourceLabel(spec: DesignSpec): string {
  if (spec.source === 'builtin') return '内置'
  if (spec.source === 'derived') return '派生'
  return '导入'
}

/** 规范摘要卡片：色卡 + 首条负面规则 */
function SpecCard({ spec }: { spec: DesignSpec }) {
  const sum = summarizeSpec(spec)
  const colors = Object.entries(spec.tokens.color ?? {}).slice(0, 14)
  return (
    <div style={{ marginTop: 10 }}>
      <div className="token-chips">
        {colors.map(([k, v]) => (
          <span key={k} className="token-chip" title={`${k} = ${v}`}>
            <i style={{ background: v }} />
            {k}
          </span>
        ))}
      </div>
      {sum.donts.length > 0 && (
        <div className="field-hint" style={{ marginTop: 8 }}>
          负面规则（{sum.donts.length}）：{sum.donts[0]}
          {sum.donts.length > 1 ? ' 等' : ''}
        </div>
      )}
    </div>
  )
}
