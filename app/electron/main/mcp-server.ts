// electron/main/mcp-server.ts
// 本地开放接口（F-PM-08）：把望舒既有能力以 MCP 工具的形式暴露给外部 Agent。
//
// 设计取舍：
//   · 传输用 MCP 的 **Streamable HTTP** 最简形态 —— 客户端 POST 一段 JSON-RPC，
//     服务端直接回 JSON。不引入 SSE / stdio，因为望舒本身是桌面应用，外部 Agent
//     只需一个 localhost 地址即可，无需派生子进程。
//   · **仅监听 127.0.0.1**，且默认关闭 + 强制 Bearer token —— 任何对外暴露的能力
//     都必须由用户显式开启（安全默认）。
//   · 所有写操作最终都落到与 UI 相同的文件读写路径上，不存在"绕过撤销栈偷偷改数据"
//     的旁路；但 MCP 直接写文件，故只暴露**结构清晰、幂等**的少量工具。
import http from 'node:http'
import { app } from 'electron'
import { APP_NAME, APP_VERSION } from '../../shared/version'
import { projectFs } from './project-fs'
import { workspaceStore } from './workspace-store'
import { snapshotStore } from './snapshot-store'
import { appSettingsStore } from './app-settings-store'
import { parseDesignMd, specFromParsed, serializeDesignMd } from '../../shared/design-md'
import { appendInterfaces, remapProjectIds } from '../../shared/interfaces'
import { resolveQuota, canAddInterfaces } from '../../shared/quota'
import type { DesignJSON, DesignSpec, Device, ProjectFile } from '../../shared/design'
import { DEFAULT_QUOTA, DEVICE_CANVAS, FILE_VERSION } from '../../shared/design'

/** MCP 协议版本（跟随主流客户端的 2025-06 稳定版） */
const MCP_PROTOCOL_VERSION = '2025-06-18'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** 返回给客户端的文本内容 */
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? n : fallback
}

/* ================================ 工具定义 ================================ */

const TOOLS: ToolDef[] = [
  {
    name: 'wanshu_app_info',
    description: '获取望舒应用信息（名称、版本、平台、项目默认目录）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => ({
      name: APP_NAME,
      version: APP_VERSION,
      platform: process.platform,
      defaultDir: projectFs.defaultDir(),
    }),
  },
  {
    name: 'wanshu_list_projects',
    description: '列出所有项目：最近打开的项目与默认目录扫描结果的并集，含界面数量、设备、工作区标签。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const metas = projectFs.list()
      const scanned = projectFs.scan()
      const seen = new Set(metas.map((m) => m.path))
      const merged = workspaceStore.merge([...metas, ...scanned.filter((m) => !seen.has(m.path))])
      return merged.map((m) => ({
        id: m.id,
        name: m.name,
        path: m.path,
        device: m.device,
        interfaceCount: m.pageCount,
        updatedAt: m.updatedAt,
        favorite: !!m.workspace?.favorite,
        tags: m.workspace?.tags ?? [],
      }))
    },
  },
  {
    name: 'wanshu_get_project',
    description: '读取一个项目的完整 Design JSON（唯一数据源）。',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: '项目文件绝对路径（.dsproj）' } },
      required: ['path'],
      additionalProperties: false,
    },
    handler: (a) => projectFs.open(str(a.path)),
  },
  {
    name: 'wanshu_list_interfaces',
    description: '列出某个项目下的全部功能界面（等价于 Stitch 的 Screens），含分组与跳转关系统计。',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    handler: (a) => {
      const pf = projectFs.open(str(a.path))
      const d = pf.design
      const quota = resolveQuota(d.meta)
      const linked = new Set<string>()
      d.flows.forEach((f) => {
        linked.add(f.fromPage)
        linked.add(f.to)
      })
      return {
        project: { id: d.meta.id, name: d.meta.name, device: d.meta.device },
        quota,
        groups: d.pageGroups ?? [],
        interfaces: d.pages.map((p) => ({
          id: p.id,
          name: p.name,
          order: p.order,
          groupId: p.groupId ?? null,
          specId: p.specId ?? null,
          hasFlow: linked.has(p.id),
        })),
      }
    },
  },
  {
    name: 'wanshu_create_project',
    description:
      '在默认项目目录创建一个新项目，可指定设备与计划界面数 N。返回落盘路径。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '项目名称' },
        device: { type: 'string', enum: ['MOBILE', 'TABLET', 'DESKTOP', 'RESPONSIVE'] },
        planned: { type: 'number', description: '计划界面数 N（默认 1）' },
        softLimit: { type: 'number' },
        hardLimit: { type: 'number', description: '硬上限；0 表示不限' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    handler: (a) => {
      const name = str(a.name, '未命名项目')
      const device = (str(a.device, 'MOBILE') as Device) ?? 'MOBILE'
      const quota = {
        ...DEFAULT_QUOTA,
        planned: Math.max(1, num(a.planned, 1)),
        softLimit: Math.max(1, num(a.softLimit, DEFAULT_QUOTA.softLimit)),
        hardLimit: Math.max(0, num(a.hardLimit, DEFAULT_QUOTA.hardLimit)),
      }
      const canvas = DEVICE_CANVAS[device] ?? DEVICE_CANVAS.MOBILE
      const now = new Date().toISOString()
      const design: DesignJSON = {
        schemaVersion: '1.2',
        meta: {
          id: `proj_${Date.now().toString(36)}`,
          name,
          device,
          canvas: { width: canvas.width, height: canvas.height },
          createdAt: now,
          updatedAt: now,
          source: 'blank',
          quota,
        },
        tokens: {},
        assets: [],
        pages: [],
        flows: [],
        pageGroups: [],
      }
      // 按 planned 预置 N 个空白界面（受配额约束）
      const decision = canAddInterfaces(0, quota.planned, quota)
      const withPages = appendInterfaces(design, decision.allowed ? quota.planned : 1, { device })
      const path = projectFs.createInDefaultDir(name, { fileVersion: FILE_VERSION, design: withPages })
      return { path, interfaceCount: withPages.pages.length, quota }
    },
  },
  {
    name: 'wanshu_save_project',
    description: '把一份 Design JSON 写回指定项目路径（整文件覆盖）。',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, design: { type: 'object' } },
      required: ['path', 'design'],
      additionalProperties: false,
    },
    handler: (a) => {
      const design = a.design as DesignJSON
      const p = projectFs.save(str(a.path), { fileVersion: FILE_VERSION, design })
      return { path: p, interfaceCount: design.pages?.length ?? 0 }
    },
  },
  {
    name: 'wanshu_create_interfaces',
    description: '向已有项目追加 N 个空白界面（受项目配额约束）。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        count: { type: 'number' },
        groupId: { type: 'string' },
      },
      required: ['path', 'count'],
      additionalProperties: false,
    },
    handler: (a) => {
      const path = str(a.path)
      const pf = projectFs.open(path)
      const quota = resolveQuota(pf.design.meta)
      const count = Math.max(1, num(a.count, 1))
      const decision = canAddInterfaces(pf.design.pages.length, count, quota)
      if (!decision.allowed) {
        return { ok: false, reason: decision.message, remaining: decision.remaining }
      }
      const next = appendInterfaces(pf.design, count, {
        device: pf.design.meta.device,
        groupId: str(a.groupId) || undefined,
      })
      projectFs.save(path, { fileVersion: FILE_VERSION, design: next })
      return { ok: true, interfaceCount: next.pages.length, warning: decision.message }
    },
  },
  {
    name: 'wanshu_duplicate_project',
    description: '复制一个项目（全部界面 / 节点 / 跳转 id 都会重排，副本与原项目完全隔离）。',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, name: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    handler: (a) => {
      const copy = projectFs.duplicate(str(a.path), str(a.name) || undefined)
      const meta = projectFs.meta(copy)
      return { path: copy, meta }
    },
  },
  {
    name: 'wanshu_list_snapshots',
    description: '列出某项目的手动快照（最近 10 个）。',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    handler: (a) => {
      const pf = projectFs.open(str(a.path))
      return snapshotStore.list(pf.design.meta.id)
    },
  },
  {
    name: 'wanshu_list_specs',
    description: '列出项目内可用的设计规范（含内置四套）。',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    handler: (a) => {
      const pf = projectFs.open(str(a.path))
      return {
        boundSpecId: pf.design.meta.specId ?? null,
        specs: (pf.design.specs ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          source: s.source,
          colorKeys: Object.keys(s.tokens.color ?? {}),
        })),
      }
    },
  },
  {
    name: 'wanshu_import_design_md',
    description:
      '解析一份 DESIGN.md 文本为设计规范（Token + 正负规则），返回规范对象与警告；不写盘。',
    inputSchema: {
      type: 'object',
      properties: {
        markdown: { type: 'string' },
        name: { type: 'string' },
        baseSpecId: { type: 'string', description: '缺项从该规范继承（可选）' },
      },
      required: ['markdown'],
      additionalProperties: false,
    },
    handler: (a) => {
      const parsed = parseDesignMd(str(a.markdown))
      const spec = specFromParsed(parsed, { name: str(a.name) || undefined })
      return { spec, warnings: parsed.warnings, unrecognized: parsed.raw }
    },
  },
  {
    name: 'wanshu_export_design_md',
    description: '把一份设计规范序列化为 DESIGN.md 文本（可交给其它 AI 设计工具消费）。',
    inputSchema: {
      type: 'object',
      properties: { spec: { type: 'object' } },
      required: ['spec'],
      additionalProperties: false,
    },
    handler: (a) => ({ markdown: serializeDesignMd(a.spec as Pick<DesignSpec, 'name' | 'desc' | 'tokens' | 'rules'>) }),
  },
  {
    name: 'wanshu_remap_project',
    description: '把一份项目 JSON 的全部实体 id 重排后返回（用于把项目合并进另一个项目）。',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'object' }, name: { type: 'string' } },
      required: ['project'],
      additionalProperties: false,
    },
    handler: (a) => remapProjectIds(a.project as ProjectFile, { name: str(a.name) || undefined }),
  },
]

/* ================================ 服务实现 ================================ */

interface RpcResult {
  status: number
  body: unknown
}

class McpServer {
  private server: http.Server | null = null
  private port = 0

  status() {
    const s = appSettingsStore.get()
    return {
      running: !!this.server,
      enabled: s.mcp.enabled,
      port: this.server ? this.port : s.mcp.port,
      endpoint: this.server ? `http://127.0.0.1:${this.port}/mcp` : '',
      toolCount: TOOLS.length,
      tokenMasked: `****${s.mcp.token.slice(-4)}`,
    }
  }

  listTools() {
    return TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
  }

  private authorized(header: string | undefined): boolean {
    const token = appSettingsStore.get().mcp.token
    if (!header) return false
    const m = /^Bearer\s+(.+)$/i.exec(header.trim())
    return !!m && m[1] === token
  }

  /** 处理一条 JSON-RPC 消息；返回 null 表示这是通知（无需响应体） */
  async handleRpc(req: JsonRpcRequest): Promise<unknown | null> {
    const { method, params, id } = req
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result })

    if (method === 'initialize') {
      return reply({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: `${APP_NAME} MCP`, version: APP_VERSION },
      })
    }
    if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
      return null
    }
    if (method === 'ping') return reply({})
    if (method === 'tools/list') return reply({ tools: this.listTools() })

    if (method === 'tools/call') {
      const name = str((params?.name as string) ?? '')
      const args = (params?.arguments as Record<string, unknown>) ?? {}
      const tool = TOOLS.find((t) => t.name === name)
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          error: { code: -32602, message: `未知工具：${name}` },
        }
      }
      try {
        const data = await tool.handler(args)
        return reply({
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          isError: false,
        })
      } catch (e) {
        const msg = (e as { message?: string })?.message ?? String(e)
        return reply({ content: [{ type: 'text', text: `执行失败：${msg}` }], isError: true })
      }
    }

    return { jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: `未实现的方法：${method}` } }
  }

  private async handleHttp(req: http.IncomingMessage, body: string): Promise<RpcResult> {
    if (req.method === 'GET') {
      // 健康检查：不暴露任何数据，只回答"活着"
      return { status: 200, body: { ok: true, name: `${APP_NAME} MCP`, toolCount: TOOLS.length } }
    }
    if (req.method !== 'POST') return { status: 405, body: { ok: false, message: '仅支持 POST' } }
    if (!this.authorized(req.headers.authorization)) {
      return { status: 401, body: { ok: false, message: '缺少或错误的访问令牌' } }
    }
    let parsed: JsonRpcRequest
    try {
      parsed = JSON.parse(body) as JsonRpcRequest
    } catch {
      return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } } }
    }
    const out = await this.handleRpc(parsed)
    if (out === null) return { status: 202, body: { ok: true } }
    return { status: 200, body: out }
  }

  /** 是否正在运行 */
  get running() {
    return !!this.server
  }

  async start(): Promise<{ port: number; endpoint: string }> {
    if (this.server) return { port: this.port, endpoint: `http://127.0.0.1:${this.port}/mcp` }
    const settings = appSettingsStore.get()
    const port = settings.mcp.port

    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
        if (body.length > 4 * 1024 * 1024) req.destroy() // 超大报文直接断开，防止内存被吃
      })
      req.on('end', () => {
        void this.handleHttp(req, body)
          .then(({ status, body: payload }) => {
            res.writeHead(status, {
              'content-type': 'application/json; charset=utf-8',
              // 仅本机可达，但仍显式关掉 CORS 方便本地调试脚本
              'access-control-allow-origin': '*',
              'access-control-allow-headers': 'authorization, content-type',
            })
            res.end(JSON.stringify(payload))
          })
          .catch((e: unknown) => {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, message: String((e as Error)?.message ?? e) }))
          })
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      // 只绑定回环地址：绝不允许局域网/公网访问
      server.listen(port, '127.0.0.1', () => resolve())
    })

    this.server = server
    this.port = port
    console.log(`[mcp] ${APP_NAME} MCP 已启动：http://127.0.0.1:${port}/mcp（工具 ${TOOLS.length} 个）`)
    return { port, endpoint: `http://127.0.0.1:${port}/mcp` }
  }

  async stop(): Promise<void> {
    const s = this.server
    this.server = null
    if (!s) return
    await new Promise<void>((resolve) => s.close(() => resolve()))
    console.log('[mcp] 已停止')
  }

  async restart(): Promise<{ port: number; endpoint: string } | null> {
    await this.stop()
    if (!appSettingsStore.get().mcp.enabled) return null
    return this.start()
  }
}

export const mcpServer = new McpServer()

/** 供 IPC 层做无网络的自检（不监听端口，只跑一遍 RPC 逻辑） */
export async function selfTestMcp(): Promise<{ ok: boolean; detail: string }> {
  try {
    const init = (await mcpServer.handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' })) as {
      result?: { serverInfo?: { version?: string } }
    }
    const list = (await mcpServer.handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as {
      result?: { tools?: unknown[] }
    }
    const n = list?.result?.tools?.length ?? 0
    const v = init?.result?.serverInfo?.version ?? '?'
    return { ok: n > 0, detail: `版本 ${v}，可用工具 ${n} 个，当前${mcpServer.running ? '已' : '未'}监听端口` }
  } catch (e) {
    return { ok: false, detail: String((e as Error)?.message ?? e) }
  }
}

/** 应用退出时的兜底（避免 before-quit 未走到） */
app.on('will-quit', () => {
  void mcpServer.stop()
})
