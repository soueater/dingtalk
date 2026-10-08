// src/components/settings/SettingsModal.tsx
// 模型配置面板：分步引导 + 多厂商适配 + 连通性测试
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ConfigInput, ConfigPublic } from '@shared/design'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Switch, CheckRow } from '@/components/ui/Field'
import { IconPlus, IconTrash, IconCheck, IconRefresh, IconInfo, IconWarning, IconEye, IconSettings } from '@/components/ui/Icons'
import { useConfigStore, defaultConfigInput } from '@/stores/config.store'
import { useUiStore } from '@/stores/ui.store'
import { ADAPTERS, BASE_URL_PRESETS, getAdapter } from '@/services/config'
import { ApiError, configService } from '@/services/config'
import { AppSettingsPanel } from './AppSettingsPanel'

type Draft = ConfigInput & { _keyDirty?: boolean }

/** 新建配置的初值：与 store 的 defaultConfigInput 共用同一来源，避免默认值漂移 */
function newDraft(): Draft {
  return { ...defaultConfigInput('openai'), _keyDirty: false }
}
const EMPTY_DRAFT: Draft = newDraft()

/** 从已保存配置构造草稿（密钥永远不回填明文，只保留掩码用于展示） */
function draftFrom(c: ConfigPublic): Draft {
  return {
    id: c.id,
    name: c.name,
    adapter: c.adapter,
    baseUrl: c.baseUrl,
    model: c.model,
    temperature: c.temperature,
    maxTokens: c.maxTokens,
    timeoutMs: c.timeoutMs,
    stream: c.stream,
    isDefault: c.isDefault,
    apiKey: '',
    _keyDirty: false,
  }
}

export function SettingsModal() {
  const overlay = useUiStore((s) => s.overlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const toast = useUiStore((s) => s.toast)

  const { list, encrypted, loaded, loading, load, save, remove, setDefault } = useConfigStore()

  /** 当前实际生效的配置 id（运行时使用的就是默认项，见 config.store 的 current()） */
  const usingId = useConfigStore((s) => s.current()?.id)

  const open = overlay === 'settings'
  const [activeId, setActiveId] = useState<string | '__new__' | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    if (open && !loaded) void load()
  }, [open, loaded, load])

  /* 选中项校正：
     这里**只做「失效才纠正」**——当 activeId 为空、或指向的配置已被删除时才回退到
     默认项/第一项。绝不能无条件 setActiveId(default)：
     那样用户每次点选另一条配置都会被立即弹回默认项，导致既无法编辑非默认配置，
     也无法把它设为默认（「设为默认」按钮永远作用于被弹回的那一条）。 */
  useEffect(() => {
    if (!open) return
    if (activeId === '__new__') return
    if (activeId && list.some((c) => c.id === activeId)) return
    const next = list.find((c) => c.isDefault) ?? list[0]
    setActiveId(next ? next.id : '__new__')
  }, [open, list, activeId])

  // 载入所选配置到草稿。
  // 只在「选中项发生变化」时重载，而不是每次 list 变化都重载——
  // 否则点一下「设为默认」（会触发 load() 刷新 list）就会把用户正在编辑的
  // 接口地址/模型名等未保存改动全部冲掉。
  const loadedIdRef = useRef<string | '__new__' | null>(null)
  useEffect(() => {
    if (!open) {
      loadedIdRef.current = null
      return
    }
    if (!activeId) return
    if (loadedIdRef.current === activeId) return
    loadedIdRef.current = activeId

    if (activeId === '__new__') {
      setDraft({ ...EMPTY_DRAFT, isDefault: list.length === 0 })
      setTestMsg(null)
      return
    }
    const c = list.find((x) => x.id === activeId)
    if (!c) {
      // 选中的配置已不存在（被删除）→ 让校正 effect 接管
      loadedIdRef.current = null
      return
    }
    setDraft(draftFrom(c))
    setTestMsg(null)
  }, [activeId, open, list])

  const adapter = useMemo(() => getAdapter(draft.adapter), [draft.adapter])

  /** 已保存的那一份（用于「已保存密钥」提示、脏检查与步骤判定） */
  const savedCfg = draft.id ? list.find((c) => c.id === draft.id) : undefined
  const hasStoredKey = !!savedCfg?.hasKey
  const hasKey = !!draft.apiKey?.trim() || hasStoredKey
  const credentialsReady =
    !!draft.baseUrl.trim() && !!draft.model.trim() && (!adapter.keyRequired || hasKey)

  /* 步骤条不再是一个永远停在 0 的死状态，而是从真实填写情况推导出来 */
  const step = testMsg?.ok ? 2 : credentialsReady ? 1 : 0

  /** 是否存在未保存改动 */
  const isDirty = useMemo(() => {
    if (!savedCfg) return true // 新建配置：始终视为待保存
    return (
      draft.name.trim() !== savedCfg.name ||
      draft.adapter !== savedCfg.adapter ||
      draft.baseUrl.trim().replace(/\/+$/, '') !== savedCfg.baseUrl ||
      draft.model.trim() !== savedCfg.model ||
      draft.temperature !== savedCfg.temperature ||
      draft.maxTokens !== savedCfg.maxTokens ||
      draft.timeoutMs !== savedCfg.timeoutMs ||
      draft.stream !== savedCfg.stream ||
      draft.isDefault !== savedCfg.isDefault ||
      !!draft._keyDirty
    )
  }, [draft, savedCfg])

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  const onAdapterChange = (id: ConfigInput['adapter']) => {
    const meta = getAdapter(id)
    patch({
      adapter: id,
      baseUrl: meta.defaultBaseUrl,
      model: meta.defaultModel,
      apiKey: '',
      _keyDirty: false,
    })
    setTestMsg(null)
  }

  const validate = (d: Draft): string | null => {
    if (!d.name.trim()) return '请填写配置名称'
    if (!/^https?:\/\//i.test(d.baseUrl.trim())) return '接口地址需以 http:// 或 https:// 开头'
    if (!d.model.trim()) return '请填写模型名称'
    if (adapter.keyRequired && !d.id && !d.apiKey?.trim()) return '首次保存需填写 API 密钥'
    if (d.temperature < 0 || d.temperature > 2) return '温度需在 0 ~ 2 之间'
    if (d.maxTokens < 1 || d.maxTokens > 200000) return '最大输出 tokens 需在 1 ~ 200000 之间'
    if (d.timeoutMs < 3000 || d.timeoutMs > 600000) return '超时需在 3 ~ 600 秒之间'
    return null
  }

  const buildInput = (): ConfigInput => ({
    id: draft.id,
    name: draft.name.trim(),
    adapter: draft.adapter,
    baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
    model: draft.model.trim(),
    apiKey: draft._keyDirty || !draft.id ? (draft.apiKey ?? '') : undefined,
    temperature: draft.temperature,
    maxTokens: draft.maxTokens,
    timeoutMs: draft.timeoutMs,
    stream: draft.stream,
    isDefault: draft.isDefault,
  })

  const onTest = async () => {
    const err = validate(draft)
    if (err) {
      setTestMsg({ ok: false, text: err })
      return
    }
    setTesting(true)
    setTestMsg(null)
    try {
      const input = buildInput()
      // 已有配置且未改密钥时，走已存密钥测试
      const res = await configService.test({ ...input, id: draft.id })
      if (res.ok) {
        setTestMsg({ ok: true, text: `连接成功 · ${res.latencyMs ?? 0} ms${res.modelEcho ? ` · ${res.modelEcho}` : ''}` })
      } else {
        setTestMsg({ ok: false, text: `${res.message}${res.errorCode ? `（${res.errorCode}）` : ''}` })
      }
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof ApiError ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  const onSave = async () => {
    const err = validate(draft)
    if (err) {
      setTestMsg({ ok: false, text: err })
      return
    }
    setSaving(true)
    try {
      const saved = await save(buildInput())
      toast('success', `配置「${saved.name}」已保存`)
      setActiveId(saved.id)
      setDraft((d) => ({ ...d, id: saved.id, apiKey: '', _keyDirty: false }))
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (c: ConfigPublic) => {
    if (!window.confirm(`确定删除配置「${c.name}」？此操作不可撤销。`)) return
    try {
      await remove(c.id)
      toast('success', '已删除')
      setActiveId(null)
    } catch {
      toast('error', '删除失败')
    }
  }

  if (!open) return null

  return (
    <Modal
      open={open}
      title="模型配置"
      subtitle={encrypted ? '密钥已加密存储于本机' : '密钥以混淆方式存储于本机'}
      width={860}
      onClose={closeOverlay}
      footer={
        <>
          <span className="field-hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isDirty ? (
              <>
                <span className="dot dot-warn" /> 有未保存的改动
              </>
            ) : (
              <>
                <IconCheck size={12} /> 已保存
              </>
            )}
          </span>
          <div className="flex-1" />
          <Button onClick={closeOverlay}>关闭</Button>
          <Button variant="primary" onClick={onSave} disabled={saving || !isDirty}>
            {saving ? (
              <>
                <span className="spinner" /> 保存中…
              </>
            ) : (
              <>
                <IconCheck size={13} /> 保存配置
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="modal-body" style={{ padding: 0 }}>
        <div className="modal-cols" style={{ minHeight: 460 }}>
          {/* 左：配置列表 */}
          <div className="modal-col-aside">
            <div style={{ padding: 'var(--sp-3)', borderBottom: '1px solid var(--border-subtle)' }}>
              <Button variant="ghost" block size="sm" onClick={() => setActiveId('__new__')}>
                <IconPlus size={12} /> 新建配置
              </Button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--sp-2)' }}>
              {loading && <div className="field-hint" style={{ padding: 8 }}>读取中…</div>}
              {!loading && list.length === 0 && (
                <div className="field-hint" style={{ padding: 8 }}>还没有配置，点击上方新建</div>
              )}
              {list.map((c) => (
                <div
                  key={c.id}
                  className={`list-item ${activeId === c.id ? 'selected' : ''}`}
                  onClick={() => setActiveId(c.id)}
                >
                  <div className="flex-1">
                    <div className="title">
                      {c.name}
                      {c.id === usingId && (
                        <span className="badge badge-brand" style={{ marginLeft: 6 }}>使用中</span>
                      )}
                      {c.isDefault && c.id !== usingId && (
                        <span className="badge" style={{ marginLeft: 6 }}>默认</span>
                      )}
                    </div>
                    <div className="sub">
                      {getAdapter(c.adapter).label} · {c.model}
                    </div>
                  </div>
                  {activeId === c.id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      onClick={(e) => {
                        e.stopPropagation()
                        void onDelete(c)
                      }}
                      aria-label="删除"
                    >
                      <IconTrash size={12} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {list.length > 0 && (
              <div style={{ padding: 'var(--sp-3)', borderTop: '1px solid var(--border-subtle)' }}>
                <div className="field-hint" style={{ marginBottom: 6 }}>
                  默认配置将作为生成与对话的首选模型
                </div>
                {activeId && activeId !== '__new__' && (
                  savedCfg?.isDefault ? (
                    <div
                      className="alert alert-success"
                      style={{ padding: '6px 10px', fontSize: 'var(--fs-12)' }}
                    >
                      <IconCheck size={12} />
                      <span className="flex-1">当前即是默认配置</span>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      block
                      onClick={async () => {
                        await setDefault(activeId)
                        toast('success', '已设为默认配置')
                      }}
                    >
                      <IconCheck size={12} /> 设为默认
                    </Button>
                  )
                )}
              </div>
            )}

            {/* 应用级设置入口：与模型配置并列，但语义不同（行为开关 vs 凭据编排） */}
            <div style={{ padding: 'var(--sp-2)', borderTop: '1px solid var(--border-subtle)' }}>
              <button
                className={`list-item ${activeId === '__app__' ? 'selected' : ''}`}
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => setActiveId('__app__')}
              >
                <div className="flex-1">
                  <div className="title">应用设置</div>
                  <div className="sub">MCP 服务 · 自动保存 · 缩略图 · 上限</div>
                </div>
              </button>
            </div>
          </div>

          {/* 右：表单 */}
          {activeId === '__app__' ? (
            <AppSettingsPanel />
          ) : (
          <div className="modal-col-main">
            <div className="scroll">
              <Steps step={step} />
              <GuideCard adapter={adapter} />
              <div style={{ height: 'var(--sp-4)' }} />

              <div className="row">
                <Field label="配置名称" required>
                  <input
                    className="input"
                    value={draft.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    placeholder="例如：我的 GPT-4o"
                  />
                </Field>
                <Field label="服务商类型" required>
                  <select
                    className="select"
                    value={draft.adapter}
                    onChange={(e) => onAdapterChange(e.target.value as ConfigInput['adapter'])}
                  >
                    {ADAPTERS.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field
                label="接口地址（Base URL）"
                required
                hint={adapter.note}
              >
                <input
                  className="input"
                  value={draft.baseUrl}
                  onChange={(e) => patch({ baseUrl: e.target.value })}
                  placeholder={adapter.defaultBaseUrl}
                  spellCheck={false}
                />
              </Field>

              {draft.adapter === 'openai' && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: -6, marginBottom: 12 }}>
                  {BASE_URL_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className="badge"
                      style={{ cursor: 'pointer', border: 'none' }}
                      title={p.hint}
                      onClick={() => patch({ baseUrl: p.url })}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}

              <Field label="模型名称" required hint={`推荐：${adapter.models.slice(0, 3).join(' / ')}`}>
                <input
                  className="input"
                  value={draft.model}
                  onChange={(e) => patch({ model: e.target.value })}
                  placeholder={adapter.defaultModel}
                  spellCheck={false}
                  list="model-suggest"
                />
                <datalist id="model-suggest">
                  {adapter.models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>

              <Field
                label="API 密钥"
                required={adapter.keyRequired}
                hint={
                  draft.id && !draft._keyDirty
                    ? '留空表示沿用已保存的密钥；填写新值将覆盖'
                    : adapter.keyRequired
                      ? '密钥仅保存在本机，加密后写入本地文件'
                      : '本地模型通常无需密钥'
                }
                extra={
                  draft.id ? (
                    <span className="badge">已保存：{list.find((c) => c.id === draft.id)?.keyMasked || '未设置'}</span>
                  ) : null
                }
              >
                <div className="input-group">
                  <input
                    className="input"
                    type={showKey ? 'text' : 'password'}
                    value={draft.apiKey ?? ''}
                    onChange={(e) => patch({ apiKey: e.target.value, _keyDirty: true })}
                    placeholder={adapter.keyPlaceholder}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <Button variant="ghost" onClick={() => setShowKey((v) => !v)} aria-label="显示/隐藏密钥">
                    <IconEye size={13} />
                  </Button>
                </div>
              </Field>

              <div style={{ height: 'var(--sp-2)' }} />

              {/* 高级参数 */}
              <details>
                <summary style={{ cursor: 'pointer', fontSize: 'var(--fs-12)', color: 'var(--text-2)' }}>
                  高级参数
                </summary>
                <div style={{ paddingTop: 'var(--sp-3)' }}>
                  <Field
                    label={`温度（${draft.temperature.toFixed(2)}）`}
                    hint="越低越稳定，越高越有创意。生成 UI 建议 0.4 ~ 0.7"
                  >
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={draft.temperature}
                      onChange={(e) => patch({ temperature: Number(e.target.value) })}
                      style={{ width: '100%' }}
                    />
                  </Field>
                  <div className="row">
                    <Field label="最大输出 tokens">
                      <input
                        className="input"
                        type="number"
                        value={draft.maxTokens}
                        onChange={(e) => patch({ maxTokens: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="超时（秒）">
                      <input
                        className="input"
                        type="number"
                        value={Math.round(draft.timeoutMs / 1000)}
                        onChange={(e) => patch({ timeoutMs: Number(e.target.value) * 1000 })}
                      />
                    </Field>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                    <Switch on={draft.stream} onChange={(v) => patch({ stream: v })} />
                    <span className="field-hint" style={{ margin: 0 }}>流式输出（边生成边显示，推荐开启）</span>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <CheckRow checked={!!draft.isDefault} onChange={(v) => patch({ isDefault: v })}>
                      设为默认配置
                    </CheckRow>
                  </div>
                </div>
              </details>

              {testMsg && (
                <div className={`alert ${testMsg.ok ? 'alert-success' : 'alert-danger'}`} style={{ marginTop: 'var(--sp-4)' }}>
                  {testMsg.ok ? <IconCheck size={14} /> : <IconWarning size={14} />}
                  <span className="flex-1">{testMsg.text}</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 'var(--sp-4)', alignItems: 'center' }}>
                <Button onClick={onTest} disabled={testing}>
                  {testing ? (
                    <>
                      <span className="spinner" /> 测试中…
                    </>
                  ) : (
                    <>
                      <IconRefresh size={13} /> 测试连接
                    </>
                  )}
                </Button>
                <div className="flex-1" />
                <span className="field-hint" style={{ margin: 0 }}>
                  {testMsg?.ok && isDirty ? '测试通过，请记得保存' : ''}
                </span>
              </div>
            </div>
          </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function Steps({ step }: { step: number }) {
  const items = [
    { label: '选择服务商', desc: '匹配接口协议' },
    { label: '填写凭据', desc: '地址 / 模型 / 密钥' },
    { label: '测试连接', desc: '验证可用性' },
  ]
  return (
    <div className="steps">
      {items.map((it, i) => (
        <Fragment key={it.label}>
          <div className={`step ${i === step ? 'active' : i < step ? 'done' : ''}`}>
            <span className="n">{i < step ? '✓' : i + 1}</span>
            <span className="step-txt">
              <b>{it.label}</b>
              <em>{it.desc}</em>
            </span>
          </div>
          {i < items.length - 1 && <span className="step-line" />}
        </Fragment>
      ))}
    </div>
  )
}

function GuideCard({ adapter }: { adapter: ReturnType<typeof getAdapter> }) {
  return (
    <div className="guide-card">
      <h4>
        <IconInfo size={13} style={{ verticalAlign: -2 }} /> {adapter.label} 接入说明
      </h4>
      <ol>
        {adapter.guide.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
      {adapter.notes.length > 0 && (
        <ul className="guide-notes">
          {adapter.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      <p className="guide-links">
        <a
          href={adapter.keyUrl}
          onClick={(e) => {
            e.preventDefault()
            void window.dsa?.app?.openExternal?.(adapter.keyUrl)
          }}
        >
          获取密钥
        </a>
        <span>·</span>
        <a
          href={adapter.docsUrl}
          onClick={(e) => {
            e.preventDefault()
            void window.dsa?.app?.openExternal?.(adapter.docsUrl)
          }}
        >
          接口文档
        </a>
      </p>
    </div>
  )
}

/** 供其他模块复用：确保存在可用配置，否则提示打开设置 */
export function useEnsureConfig() {
  const openOverlay = useUiStore((s) => s.openOverlay)
  const toast = useUiStore((s) => s.toast)
  const current = useConfigStore((s) => s.current)
  return () => {
    if (!current()) {
      toast('warn', '尚未配置模型，请先在「模型配置」中添加')
      openOverlay('settings')
      return false
    }
    return true
  }
}
