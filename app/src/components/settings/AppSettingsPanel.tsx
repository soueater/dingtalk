// src/components/settings/AppSettingsPanel.tsx —— 应用级设置（F-PM-08 / F-PM-05 全局兜底 / F-PM-03）
//
// 与「模型配置」分开的原因：模型配置是**一次性的凭据编排**（配好基本不动），
// 应用设置是**需要反复微调的行为开关**（MCP 端口、自动保存间隔、缩略图）。
// 把两者塞进同一屏会让人以为"改个端口也要重配模型"。
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Switch, CheckRow } from '@/components/ui/Field'
import { IconRefresh, IconInfo, IconCheck, IconSettings, IconBranch } from '@/components/ui/Icons'
import { useUiStore } from '@/stores/ui.store'
import { APP_VERSION } from '@shared/version'
import { SCHEMA_VERSION, GLOBAL_MAX_PAGES } from '@shared/design'

interface AppSettings {
  mcp: { enabled: boolean; port: number; tokenMasked: string }
  limits: { maxPagesPerProject: number }
  autoThumbnail: boolean
  autoSaveDebounceMs: number
}

interface McpStatus {
  running: boolean
  enabled: boolean
  port: number
  endpoint: string
  toolCount: number
  tokenMasked: string
  selfTest: { ok: boolean; detail: string }
}

const SAVE_INTERVAL_PRESETS = [
  { ms: 10_000, label: '10 秒' },
  { ms: 30_000, label: '30 秒' },
  { ms: 60_000, label: '1 分钟' },
  { ms: 300_000, label: '5 分钟' },
]

export function AppSettingsPanel() {
  const toast = useUiStore((s) => s.toast)
  const [s, setS] = useState<AppSettings | null>(null)
  const [mcp, setMcp] = useState<McpStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const r = await window.dsa?.settings.get()
      if (r?.ok) setS(r.data as AppSettings)
      const m = await window.dsa?.mcp?.status()
      if (m?.ok) setMcp(m.data)
    } catch {
      /* 浏览器环境无 bridge */
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const patch = async (p: Record<string, unknown>) => {
    setBusy(true)
    try {
      const r = await window.dsa?.settings.save(p)
      if (r?.ok) {
        setS(r.data as AppSettings)
        await refresh()
        toast('success', '设置已保存')
      } else if (r && !r.ok) {
        toast('error', r.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const onRotateToken = async () => {
    if (!window.confirm('轮换令牌会让当前已接入望舒 MCP 的客户端立即失效，需要重新填入新令牌。继续？')) return
    setBusy(true)
    try {
      const r = await window.dsa?.settings.rotateMcpToken()
      if (r?.ok) {
        setS(r.data as AppSettings)
        await refresh()
        toast('success', '已轮换 MCP 访问令牌')
      }
    } finally {
      setBusy(false)
    }
  }

  const onToggleMcp = async (on: boolean) => {
    setBusy(true)
    try {
      const r = on ? await window.dsa?.mcp.start() : await window.dsa?.mcp.stop()
      if (r?.ok) {
        await refresh()
        toast('success', on ? '本地 MCP 服务已启动' : '本地 MCP 服务已停止')
      } else if (r && !r.ok) {
        toast('error', r.message)
      }
    } finally {
      setBusy(false)
    }
  }

  if (!s) {
    return (
      <div className="modal-col-main">
        <div className="scroll" style={{ padding: 'var(--sp-4)' }}>
          <div className="field-hint">应用设置在桌面客户端中可用。</div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-col-main">
      <div className="scroll" style={{ padding: 'var(--sp-4)' }}>
        {/* ---------------- 本地 MCP 服务 ---------------- */}
        <div className="ps-sec">
          <div className="ps-sec-title">
            <IconSettings size={12} /> 本地 MCP 服务
            <span className="badge" style={{ marginLeft: 6 }}>
              F-PM-08
            </span>
            <span className="flex-1" />
            <span className={`chip-mini ${mcp?.running ? '' : 'danger'}`}>
              {mcp?.running ? `运行中 · ${mcp.toolCount} 个工具` : '未运行'}
            </span>
          </div>
          <p className="dim">
            开启后，望舒会在本机 <code>127.0.0.1</code> 上暴露一个 MCP 接口，
            Claude Code / Cursor 等工具就能读写你的项目。只监听回环地址，不对外网开放。
          </p>

          <CheckRow checked={!!s.mcp.enabled} onChange={(v) => void onToggleMcp(v)} disabled={busy}>
            <span>启用本地 MCP 服务</span>
          </CheckRow>

          <div className="row">
            <Field label="监听端口" hint="改动后服务会自动重启">
              <input
                className="input"
                type="number"
                min={1024}
                max={65535}
                defaultValue={s.mcp.port}
                onKeyDown={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const port = Math.trunc(Number(e.target.value))
                  if (Number.isFinite(port) && port >= 1024 && port <= 65535 && port !== s.mcp.port) {
                    void patch({ mcp: { ...s.mcp, port } })
                  }
                }}
              />
            </Field>
            <Field label="访问令牌" hint="客户端需带 Bearer 令牌才能调用">
              <div className="row" style={{ gap: 6 }}>
                <input className="input" readOnly value={s.mcp.tokenMasked} />
                <Button variant="ghost" size="sm" onClick={() => void onRotateToken()} disabled={busy}>
                  <IconRefresh size={12} /> 轮换
                </Button>
              </div>
            </Field>
          </div>

          {mcp && (
            <div className="ps-kv">
              <span>接口地址</span>
              <b>{mcp.endpoint}</b>
              <span>协议版本</span>
              <b>2025-06-18</b>
              <span>自检</span>
              <b style={{ color: mcp.selfTest.ok ? 'var(--success-text)' : 'var(--warning-text)' }}>
                {mcp.selfTest.ok ? '通过' : mcp.selfTest.detail}
              </b>
            </div>
          )}
        </div>

        {/* ---------------- 自动保存 ---------------- */}
        <div className="ps-sec">
          <div className="ps-sec-title">
            <IconCheck size={12} /> 自动保存
            <span className="badge" style={{ marginLeft: 6 }}>
              F-PM-03
            </span>
          </div>
          <p className="dim">
            只对「已经保存过一次」的项目生效 —— 没选过存放位置的新项目不会被悄悄写盘。
            窗口失焦时还会额外补一次保存。
          </p>
          <Field label="保存间隔">
            <div className="row-wrap">
              {SAVE_INTERVAL_PRESETS.map((p) => (
                <button
                  key={p.ms}
                  className={`ifc-btn ${s.autoSaveDebounceMs === p.ms ? 'on' : ''}`}
                  onClick={() => void patch({ autoSaveDebounceMs: p.ms })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
        </div>

        {/* ---------------- 界面缩略图 ---------------- */}
        <div className="ps-sec">
          <div className="ps-sec-title">
            <IconBranch size={12} /> 项目缩略图
          </div>
          <CheckRow
            checked={s.autoThumbnail}
            onChange={(v) => void patch({ autoThumbnail: v })}
          >
            <span>保存后自动更新项目缩略图（用于项目中心卡片预览）</span>
          </CheckRow>
          <Field
            label="单项目界面数全局兜底"
            hint={`项目级硬上限不能超过这个值（当前 ${GLOBAL_MAX_PAGES}）。这是防止"把 500 屏塞进一个项目"这类失控操作的最后一道闸。`}
          >
            <input
              className="input"
              type="number"
              min={1}
              max={5000}
              defaultValue={s.limits.maxPagesPerProject}
              onKeyDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const v = Math.trunc(Number(e.target.value))
                if (Number.isFinite(v) && v >= 1 && v !== s.limits.maxPagesPerProject) {
                  void patch({ limits: { maxPagesPerProject: v } })
                }
              }}
            />
          </Field>
        </div>

        {/* ---------------- 关于 ---------------- */}
        <div className="ps-sec">
          <div className="ps-sec-title">
            <IconInfo size={12} /> 关于
          </div>
          <div className="ps-kv">
            <span>产品</span>
            <b>望舒（Wanshu）</b>
            <span>版本</span>
            <b>v{APP_VERSION}</b>
            <span>数据格式</span>
            <b>Schema {SCHEMA_VERSION}</b>
            <span>存储</span>
            <b>全部数据保存在本机</b>
          </div>
        </div>
      </div>
    </div>
  )
}
