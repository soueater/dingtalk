// electron/main/app-settings-store.ts
// 应用级设置（F-PM-08 开放接口 / 全局限制）。
//
// 与 config-store（模型配置）分开：这里放的是「应用行为开关」，
// 不含任何密钥 —— MCP token 单独生成并按 0600 权限落盘。
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const FILE = 'app-settings.json'
/** 默认端口：避开常见服务端口，且落在动态端口区间之外便于记忆 */
export const DEFAULT_MCP_PORT = 43117

export interface AppSettings {
  version: 1
  mcp: {
    /** 默认关闭 —— 安全默认：任何对外暴露的能力都必须由用户显式开启 */
    enabled: boolean
    port: number
    token: string
  }
  limits: {
    /** 单项目界面数全局兜底（与 shared/design.ts 的 GLOBAL_MAX_PAGES 呼应） */
    maxPagesPerProject: number
  }
  /** 保存项目时是否同时刷新缩略图（缩略图渲染有开销，允许用户关掉） */
  autoThumbnail: boolean
  /** 自动保存防抖毫秒数；0 表示关闭自动保存 */
  autoSaveDebounceMs: number
}

function settingsPath() {
  return path.join(app.getPath('userData'), FILE)
}

function newToken(): string {
  return randomBytes(24).toString('hex')
}

function defaults(): AppSettings {
  return {
    version: 1,
    mcp: { enabled: false, port: DEFAULT_MCP_PORT, token: newToken() },
    limits: { maxPagesPerProject: 500 },
    autoThumbnail: true,
    autoSaveDebounceMs: 30_000,
  }
}

function sanitize(raw: unknown): AppSettings {
  const d = defaults()
  const s = raw as Partial<AppSettings> | null
  if (!s || typeof s !== 'object') return d
  const port = Number((s.mcp as { port?: number } | undefined)?.port)
  return {
    version: 1,
    mcp: {
      enabled: !!(s.mcp as { enabled?: boolean } | undefined)?.enabled,
      port: Number.isFinite(port) && port > 1024 && port < 65536 ? port : d.mcp.port,
      token:
        typeof (s.mcp as { token?: string } | undefined)?.token === 'string' &&
        (s.mcp as { token: string }).token.length >= 16
          ? (s.mcp as { token: string }).token
          : d.mcp.token,
    },
    limits: {
      maxPagesPerProject: Number.isFinite(s.limits?.maxPagesPerProject)
        ? Math.max(1, Math.trunc(s.limits!.maxPagesPerProject))
        : d.limits.maxPagesPerProject,
    },
    autoThumbnail: s.autoThumbnail !== false,
    autoSaveDebounceMs:
      Number.isFinite(s.autoSaveDebounceMs) && (s.autoSaveDebounceMs as number) >= 0
        ? Math.trunc(s.autoSaveDebounceMs as number)
        : d.autoSaveDebounceMs,
  }
}

let cache: AppSettings | null = null

export const appSettingsStore = {
  get(): AppSettings {
    if (cache) return cache
    try {
      const p = settingsPath()
      cache = fs.existsSync(p)
        ? sanitize(JSON.parse(fs.readFileSync(p, 'utf8')))
        : (() => {
            const d = defaults()
            // 首次生成即落盘，保证 token 在多窗口/多次启动之间稳定
            fs.writeFileSync(p, JSON.stringify(d, null, 2), { encoding: 'utf8', mode: 0o600 })
            return d
          })()
    } catch {
      cache = defaults()
    }
    return cache
  },

  save(patch: Partial<AppSettings>): AppSettings {
    const cur = this.get()
    const next = sanitize({
      ...cur,
      ...patch,
      mcp: { ...cur.mcp, ...(patch.mcp ?? {}) },
      limits: { ...cur.limits, ...(patch.limits ?? {}) },
    })
    try {
      fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      })
    } catch {
      /* 写入失败时至少让内存态生效，下次启动回退默认值 */
    }
    cache = next
    return next
  },

  /** 重新生成 MCP 访问令牌（用户怀疑泄露时的处置手段） */
  rotateMcpToken(): AppSettings {
    return this.save({ mcp: { ...this.get().mcp, token: newToken() } })
  },

  /** 供 UI 展示的脱敏视图：只给尾 4 位 */
  publicView() {
    const s = this.get()
    return {
      mcp: {
        enabled: s.mcp.enabled,
        port: s.mcp.port,
        tokenMasked: `****${s.mcp.token.slice(-4)}`,
      },
      limits: s.limits,
      autoThumbnail: s.autoThumbnail,
      autoSaveDebounceMs: s.autoSaveDebounceMs,
    }
  },
}
