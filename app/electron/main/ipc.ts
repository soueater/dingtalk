// electron/main/ipc.ts
// 所有 IPC 通道注册：统一 IpcResult 信封，绝不抛异常穿透
import { ipcMain, dialog, shell, webContents, BrowserWindow, nativeTheme } from 'electron'
import { writeFileSync } from 'node:fs'
import type {
  ChatRequest,
  ConfigInput,
  DesignSpec,
  ErrorCode,
  ExportRequest,
  IpcResult,
  ProjectFile,
  SessionFile,
  WorkspaceEntry,
  WorkspaceIndex,
} from '../../shared/design'
import { APP_VERSION } from '../../shared/version'
import { projectFs, readThumbnail, removeThumbnail, writeThumbnail } from './project-fs'
import { workspaceStore } from './workspace-store'
import { specLibraryStore } from './spec-library-store'
import { snapshotStore } from './snapshot-store'
import { branchStore } from './branch-store'
import { sessionStore } from './session-store'
import { appSettingsStore } from './app-settings-store'
import { mcpServer, selfTestMcp } from './mcp-server'
import { exportFs, pickExportTarget } from './export-fs'
import { configStore } from './config-store'
import { secureStore } from './secure-store'
import { llmProxy, LlmError } from './llm-proxy'
import { renderPagesToPng } from './png-render'
import { getPrimaryWindow, openProjectWindow, rememberProject, snapshotSession } from './window-manager'

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

function fail(code: ErrorCode, message: string, detail?: string): IpcResult<never> {
  return { ok: false, code, message, detail }
}

function toFail(e: unknown): IpcResult<never> {
  if (e instanceof LlmError) return fail(e.code, e.message, e.detail)
  const err = e as { code?: ErrorCode; message?: string; detail?: string }
  const msg = err?.message ?? String(e)
  if (/EACCES|EPERM/i.test(msg)) return fail('E_FS_PERM', '无权限访问该位置')
  if (/ENOENT/i.test(msg)) return fail('E_FS_NOTFOUND', '文件或目录不存在')
  if (err?.code === 'E_FS_TRASH') return fail('E_FS_TRASH', msg, err.detail)
  return fail(err?.code ?? 'E_UNKNOWN', msg, err?.detail)
}

/** 请求 token → AbortController */
const inflight = new Map<string, AbortController>()

/** 主进程抓网页的超时（DESIGN.md URL 导入） */
const FETCH_TIMEOUT_MS = 15_000

export function registerIpc() {
  /* -------------------------------- 项目文件 -------------------------------- */
  ipcMain.handle('project:list', async () => {
    try {
      const recent = projectFs.list()
      const scanned = projectFs.scan()
      const seen = new Set(recent.map((m) => m.path))
      const merged = [...recent, ...scanned.filter((m) => !seen.has(m.path))]
      // 合并工作区元数据（收藏 / 分组 / 标签 / 缩略图指针），并保留磁盘上已消失的占位
      return ok({
        projects: workspaceStore.merge(merged),
        workspace: workspaceStore.load(),
        defaultDir: projectFs.defaultDir(),
      })
    } catch (e) {
      return toFail(e)
    }
  })

  /** 仅扫描目录（不做工作区合并），供「按目录浏览」使用 */
  ipcMain.handle('project:scan', async (_e, dir?: string) => {
    try {
      return ok(projectFs.scan(dir))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('project:openByDialog', async () => {
    try {
      const res = await dialog.showOpenDialog({
        title: '打开项目',
        defaultPath: projectFs.defaultDir(),
        properties: ['openFile'],
        filters: [{ name: '望舒项目', extensions: ['dsproj'] }],
      })
      if (res.canceled || !res.filePaths.length) return ok(null)
      const pf = projectFs.open(res.filePaths[0])
      return ok({ path: res.filePaths[0], project: pf })
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('project:open', async (_e, filePath: string) => {
    try {
      const pf = projectFs.open(filePath)
      // 记录「最近打开」到工作区索引，供项目中心排序
      workspaceStore.touchOpened(pf.design.meta.id, pf.design.meta.name, filePath)
      return ok({ path: filePath, project: pf })
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('project:save', async (_e, args: { path: string; project: ProjectFile }) => {
    try {
      const p = projectFs.save(args.path, args.project)
      snapshotStore.clearAuto(args.project.design.meta.id)
      // 名称可能在编辑中改过，同步进工作区索引
      workspaceStore.patchEntry(args.project.design.meta.id, {
        name: args.project.design.meta.name,
        path: p,
      })
      return ok({ path: p })
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('project:saveAs', async (_e, args: { project: ProjectFile; suggestedName?: string }) => {
    try {
      const p = await projectFs.saveAs(args.project, args.suggestedName)
      if (!p) return ok(null)
      workspaceStore.patchEntry(args.project.design.meta.id, {
        name: args.project.design.meta.name,
        path: p,
      })
      return ok({ path: p })
    } catch (e) {
      return toFail(e)
    }
  })

  /** 创建项目到默认目录（不弹对话框）—— 项目中心「新建向导」用 */
  ipcMain.handle('project:create', async (_e, args: { name: string; project: ProjectFile }) => {
    try {
      const p = projectFs.createInDefaultDir(args.name, args.project)
      workspaceStore.patchEntry(args.project.design.meta.id, {
        name: args.project.design.meta.name,
        path: p,
        lastOpenedAt: new Date().toISOString(),
      })
      return ok({ path: p })
    } catch (e) {
      return toFail(e)
    }
  })

  /** 复制项目（全部实体 id 重排，副本与原件完全隔离） */
  ipcMain.handle('project:duplicate', async (_e, args: { path: string; newName?: string }) => {
    try {
      const p = projectFs.duplicate(args.path, args.newName)
      const meta = projectFs.meta(p)
      if (meta) workspaceStore.patchEntry(meta.id, { name: meta.name, path: p })
      return ok({ path: p, meta })
    } catch (e) {
      return toFail(e)
    }
  })

  /**
   * 移除项目。
   * `deleteFile: true` 时走**系统回收站**（历史缺陷 BUG-PM-1：旧实现用 unlinkSync 永久删除）。
   */
  ipcMain.handle(
    'project:remove',
    async (_e, args: { path: string; deleteFile?: boolean; projectId?: string }) => {
      try {
        if (args.deleteFile) {
          await projectFs.trash(args.path)
        } else {
          projectFs.remove(args.path)
        }
        if (args.projectId) {
          const pid = args.projectId
          workspaceStore.removeEntry(pid)
          /* 连带清掉缩略图 / 自动快照 / 手动快照 / 方案分支，避免 userData 里留下孤儿数据 */
          removeThumbnail(pid)
          snapshotStore.clearAuto(pid)
          snapshotStore.list(pid).forEach((s) => snapshotStore.remove(pid, s.id))
          branchStore.clear(pid)
        }
        return ok(true)
      } catch (e) {
        return toFail(e)
      }
    },
  )

  ipcMain.handle('project:revealInFolder', async (_e, filePath: string) => {
    try {
      shell.showItemInFolder(filePath)
      return ok(true)
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('project:defaultDir', async () => ok(projectFs.defaultDir()))

  /* -------------------------------- 缩略图 -------------------------------- */
  ipcMain.handle('project:thumb:set', async (_e, args: { id: string; dataUrl: string }) => {
    try {
      const file = writeThumbnail(args.id, args.dataUrl)
      if (file) workspaceStore.patchEntry(args.id, { thumbnailFile: `${args.id}.png` })
      return ok(!!file)
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('project:thumb:get', async (_e, id: string) => {
    try {
      return ok(readThumbnail(id))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('project:thumb:clear', async (_e, id: string) => {
    try {
      removeThumbnail(id)
      return ok(true)
    } catch (e) {
      return toFail(e)
    }
  })

  /**
   * 由主进程把某个界面光栅化为缩略图并缓存（F-PM-02）。
   * 复用导出链路的隐藏窗口渲染，不引入任何第三方绘图库。
   * 渲染较慢（百毫秒级），故只允许单次并发并做去重，避免项目中心里一次刷十几个窗口。
   */
  const thumbInflight = new Map<string, Promise<IpcResult<boolean>>>()
  ipcMain.handle(
    'project:thumb:render',
    async (_e, args: { id: string; page: { id: string; name: string; width: number; height: number; html: string }; targetWidth?: number }) => {
      const key = `${args?.id}:${args?.page?.id}`
      const prev = thumbInflight.get(key)
      if (prev) return prev

      const job = (async (): Promise<IpcResult<boolean>> => {
        try {
          const targetW = Math.max(120, Math.min(640, args.targetWidth ?? 320))
          const scale = Math.max(0.1, Math.min(3, targetW / Math.max(1, args.page.width)))
          const png = await renderPagesToPng([args.page], scale, false)
          const dataUrl = `data:image/png;base64,${png[args.page.id] ?? ''}`
          if (!png[args.page.id]) return fail('E_UNKNOWN', '缩略图渲染失败')
          const file = writeThumbnail(args.id, dataUrl)
          if (file) workspaceStore.patchEntry(args.id, { thumbnailFile: `${args.id}.png` })
          return ok(!!file)
        } catch (e) {
          return toFail(e)
        } finally {
          thumbInflight.delete(key)
        }
      })()

      thumbInflight.set(key, job)
      return job
    },
  )

  /* -------------------------------- 工作区 -------------------------------- */
  ipcMain.handle('workspace:get', async () => {
    try {
      return ok(workspaceStore.load())
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('workspace:save', async (_e, index: WorkspaceIndex) => {
    try {
      return ok(workspaceStore.save(index))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle(
    'workspace:patchEntry',
    async (_e, args: { id: string; patch: Partial<WorkspaceEntry> }) => {
      try {
        return ok(workspaceStore.patchEntry(args.id, args.patch))
      } catch (e) {
        return toFail(e)
      }
    },
  )

  ipcMain.handle('workspace:forget', async (_e, id: string) => {
    try {
      return ok(workspaceStore.removeEntry(id))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('workspace:addGroup', async (_e, name: string) => {
    try {
      return ok(workspaceStore.addGroup(name))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('workspace:renameGroup', async (_e, args: { id: string; name: string }) => {
    try {
      return ok(workspaceStore.renameGroup(args.id, args.name))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('workspace:removeGroup', async (_e, id: string) => {
    try {
      return ok(workspaceStore.removeGroup(id))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('workspace:ensureTag', async (_e, tag: string) => {
    try {
      return ok(workspaceStore.ensureTag(tag))
    } catch (e) {
      return toFail(e)
    }
  })

  /* -------------------------- 快照 / 崩溃恢复（F-PM-03） -------------------------- */
  ipcMain.handle('snapshot:auto:write', async (_e, args: { projectId: string; design: ProjectFile['design'] }) => {
    try {
      return ok(snapshotStore.writeAuto(args.projectId, args.design))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle(
    'snapshot:auto:read',
    async (_e, args: { projectId: string; updatedAt?: string }) => {
      try {
        const pf = snapshotStore.readAuto(args.projectId)
        if (!pf) return ok(null)
        // 只有在快照确实比当前项目文件新时才值得提示恢复
        if (args.updatedAt && !snapshotStore.hasNewerAuto(args.projectId, args.updatedAt)) {
          return ok(null)
        }
        return ok(pf)
      } catch (e) {
        return toFail(e)
      }
    },
  )

  ipcMain.handle('snapshot:auto:clear', async (_e, projectId: string) => {
    try {
      snapshotStore.clearAuto(projectId)
      return ok(true)
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('snapshot:list', async (_e, projectId: string) => {
    try {
      return ok(snapshotStore.list(projectId))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle(
    'snapshot:create',
    async (_e, args: { projectId: string; design: ProjectFile['design']; name: string }) => {
      try {
        return ok(snapshotStore.createManual(args.projectId, args.design, args.name))
      } catch (e) {
        return toFail(e)
      }
    },
  )

  ipcMain.handle('snapshot:read', async (_e, args: { projectId: string; snapshotId: string }) => {
    try {
      return ok(snapshotStore.read(args.projectId, args.snapshotId))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('snapshot:remove', async (_e, args: { projectId: string; snapshotId: string }) => {
    try {
      snapshotStore.remove(args.projectId, args.snapshotId)
      return ok(true)
    } catch (e) {
      return toFail(e)
    }
  })

  /* ------------------------------ 方案分支（F-PM-07） ------------------------------ */
  ipcMain.handle('branch:list', async (_e, projectId: string) => {
    try {
      return ok(branchStore.list(projectId))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle(
    'branch:create',
    async (
      _e,
      args: {
        projectId: string
        name: string
        aspect?: string
        pages: ProjectFile['design']['pages']
        flows: ProjectFile['design']['flows']
        tokens?: ProjectFile['design']['tokens']
      },
    ) => {
      try {
        return ok(
          branchStore.create(args.projectId, {
            name: args.name,
            aspect: args.aspect,
            pages: args.pages,
            flows: args.flows,
            tokens: args.tokens,
          }),
        )
      } catch (e) {
        return toFail(e)
      }
    },
  )

  ipcMain.handle('branch:read', async (_e, args: { projectId: string; branchId: string }) => {
    try {
      return ok(branchStore.read(args.projectId, args.branchId))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle(
    'branch:rename',
    async (_e, args: { projectId: string; branchId: string; name: string; aspect?: string }) => {
      try {
        return ok(branchStore.rename(args.projectId, args.branchId, args.name, args.aspect))
      } catch (e) {
        return toFail(e)
      }
    },
  )

  ipcMain.handle('branch:adopt', async (_e, args: { projectId: string; branchId: string }) => {
    try {
      return ok(branchStore.markAdopted(args.projectId, args.branchId))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('branch:remove', async (_e, args: { projectId: string; branchId: string }) => {
    try {
      branchStore.remove(args.projectId, args.branchId)
      return ok(true)
    } catch (e) {
      return toFail(e)
    }
  })

  /* --------------------------------- 会话 --------------------------------- */
  ipcMain.handle('session:load', async () => {
    try {
      return ok(sessionStore.load())
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('session:save', async (_e, session: SessionFile) => {
    try {
      sessionStore.save(session)
      return ok(true)
    } catch (e) {
      return toFail(e)
    }
  })

  /* --------------------------------- 窗口 --------------------------------- */
  ipcMain.handle('window:openProject', async (_e, projectPath: string) => {
    try {
      openProjectWindow(projectPath)
      return ok(true)
    } catch (e) {
      return toFail(e)
    }
  })

  /** 渲染层回报「本窗口现在在编辑哪个项目」，多窗口会话恢复依赖它 */
  ipcMain.handle('window:setProject', async (e, projectPath: string | null) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (win) rememberProject(win, projectPath)
      return ok(true)
    } catch (err) {
      return toFail(err)
    }
  })

  ipcMain.handle('window:snapshotSession', async () => {
    try {
      return ok(snapshotSession())
    } catch (e) {
      return toFail(e)
    }
  })

  /* ------------------------------ 应用级设置 ------------------------------ */
  ipcMain.handle('settings:get', async () => {
    try {
      return ok(appSettingsStore.publicView())
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('settings:save', async (_e, patch: Record<string, unknown>) => {
    try {
      appSettingsStore.save(patch as never)
      // MCP 开关变化时立即生效，避免用户改了设置还得重启
      await mcpServer.restart()
      return ok(appSettingsStore.publicView())
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('settings:rotateMcpToken', async () => {
    try {
      appSettingsStore.rotateMcpToken()
      await mcpServer.restart()
      return ok(appSettingsStore.publicView())
    } catch (e) {
      return toFail(e)
    }
  })

  /* ---------------------------- MCP 开放接口（F-PM-08） ---------------------------- */
  ipcMain.handle('mcp:status', async () => {
    try {
      const test = await selfTestMcp()
      return ok({ ...mcpServer.status(), selfTest: test })
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('mcp:start', async () => {
    try {
      appSettingsStore.save({ mcp: { ...appSettingsStore.get().mcp, enabled: true } })
      const r = await mcpServer.start()
      return ok(r)
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('mcp:stop', async () => {
    try {
      appSettingsStore.save({ mcp: { ...appSettingsStore.get().mcp, enabled: false } })
      await mcpServer.stop()
      return ok(true)
    } catch (e) {
      return toFail(e)
    }
  })

  /* -------------------- 用户级规范库（F-PM-06 跨项目复用） -------------------- */
  ipcMain.handle('spec:library:list', async () => {
    try {
      return ok(specLibraryStore.list())
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('spec:library:upsert', async (_e, spec: DesignSpec) => {
    try {
      return ok(specLibraryStore.upsert(spec))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('spec:library:remove', async (_e, id: string) => {
    try {
      return ok(specLibraryStore.remove(id))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('spec:library:save', async (_e, list: DesignSpec[]) => {
    try {
      return ok(specLibraryStore.save(list))
    } catch (e) {
      return toFail(e)
    }
  })

  /* ------------------------ DESIGN.md URL 抓取（F-PM-06） ------------------------ */  ipcMain.handle('designMd:fetch', async (_e, url: string) => {
    try {
      if (!/^https?:\/\//i.test(String(url ?? ''))) {
        return fail('E_UNKNOWN', '仅支持 http/https 地址')
      }
      // 抓网页必须在主进程做：渲染层受 CSP 与 CORS 双重限制
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          redirect: 'follow',
          headers: { accept: 'text/markdown, text/plain, text/*, */*' },
        })
        if (!res.ok) return fail('E_NET', `抓取失败：HTTP ${res.status}`)
        const text = await res.text()
        if (text.length > 512 * 1024) return fail('E_NET', '文档过大（超过 512KB），请改为粘贴关键片段')
        return ok({ url, text })
      } finally {
        clearTimeout(timer)
      }
    } catch (e) {
      const msg = (e as Error)?.name === 'AbortError' ? '抓取超时' : String((e as Error)?.message ?? e)
      return fail('E_NET', msg)
    }
  })

  /* --------------------------------- 配置 --------------------------------- */
  ipcMain.handle('config:get', async () => {
    try {
      return ok({ list: configStore.list(), encrypted: secureStore.isEncrypted() })
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('config:save', async (_e, input: ConfigInput) => {
    try {
      return ok(configStore.save(input))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('config:remove', async (_e, id: string) => {
    try {
      configStore.remove(id)
      return ok(true)
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('config:setDefault', async (_e, id: string) => {
    try {
      configStore.setDefault(id)
      return ok(true)
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('config:test', async (_e, input: ConfigInput) => {
    try {
      const result = await llmProxy.test({
        adapter: input.adapter,
        baseUrl: input.baseUrl,
        model: input.model,
        apiKey: input.apiKey,
        configId: input.id,
        timeoutMs: Math.min(input.timeoutMs || 30000, 60000),
      })
      return ok(result)
    } catch (e) {
      return toFail(e)
    }
  })

  /* ---------------------------------- LLM --------------------------------- */
  ipcMain.handle('llm:chat', async (_e, req: ChatRequest) => {
    try {
      return ok(await llmProxy.chat(req))
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('llm:chatStream', async (e, args: { req: ChatRequest; token: string }) => {
    const { req, token } = args
    const ctrl = new AbortController()
    inflight.set(token, ctrl)
    const wc = e.sender
    let last = 0
    try {
      const r = await llmProxy.chatStream(req, ctrl.signal, (delta) => {
        const now = Date.now()
        if (now - last < 16) return // 节流
        last = now
        if (!wc.isDestroyed()) wc.send('llm:chunk', { token, delta, index: 0 })
      })
      if (!wc.isDestroyed()) wc.send('llm:done', { token, content: r.content, ms: r.ms, usage: r.usage })
      return ok(true)
    } catch (er) {
      const le = er instanceof LlmError ? er : new LlmError('E_UNKNOWN', String((er as Error)?.message ?? er))
      if (!wc.isDestroyed()) wc.send('llm:error', { token, code: le.code, message: le.message })
      return toFail(er)
    } finally {
      inflight.delete(token)
    }
  })

  ipcMain.handle('llm:abort', async (_e, token: string) => {
    inflight.get(token)?.abort()
    inflight.delete(token)
    return ok(true)
  })

  /* --------------------------------- 导出 --------------------------------- */
  ipcMain.handle('export:pickTarget', async (_e, args: { format: ExportRequest['format']; name: string; isDir: boolean }) => {
    try {
      const p = await pickExportTarget(args.format, args.name, args.isDir)
      return ok(p)
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('export:write', async (_e, req: ExportRequest & { pngBase64?: Record<string, string> }) => {
    try {
      let pngBase64 = req.pngBase64
      // PNG 且未附带位图时，由主进程用隐藏窗口自行光栅化
      if (req.format === 'png' && !pngBase64 && req.pages?.length) {
        pngBase64 = await renderPagesToPng(req.pages, req.scale ?? 2, req.transparent ?? false)
      }
      return ok(exportFs.write({ ...req, pngBase64 }))
    } catch (e) {
      return toFail(e)
    }
  })

  /**
   * 保存纯文本文件（F-ST-01 导出设计规范 JSON / Markdown；F-PM-06 导出 DESIGN.md）。
   * 与 export:write 分开：这里只需一次「另存为」对话框 + 写文本，语义更窄更安全。
   */
  ipcMain.handle(
    'export:saveText',
    async (
      _e,
      args: {
        suggestedName: string
        content: string
        filters?: Array<{ name: string; extensions: string[] }>
      },
    ) => {
      try {
        const name = String(args?.suggestedName ?? 'export.txt').replace(/[\\/:*?"<>|]/g, '_')
        const res = await dialog.showSaveDialog({
          title: '导出文本',
          defaultPath: name,
          filters: args?.filters?.length
            ? args.filters
            : [
                { name: 'Markdown', extensions: ['md'] },
                { name: 'JSON', extensions: ['json'] },
                { name: '文本', extensions: ['txt'] },
              ],
        })
        if (res.canceled || !res.filePath) return ok({ ok: false, canceled: true, path: '' })
        writeFileSync(res.filePath, String(args?.content ?? ''), 'utf8')
        return ok({ ok: true, canceled: false, path: res.filePath })
      } catch (e) {
        return toFail(e)
      }
    },
  )

  /* --------------------------------- 应用 --------------------------------- */
  ipcMain.handle('app:info', async () => {
    return ok({
      version: APP_VERSION,
      platform: process.platform,
      encrypted: secureStore.isEncrypted(),
      primaryWindowId: getPrimaryWindow()?.id ?? null,
    })
  })

  ipcMain.handle('app:openExternal', async (_e, url: string) => {
    try {
      if (!/^https?:\/\//i.test(url)) return fail('E_UNKNOWN', '仅允许打开 http/https 链接')
      await shell.openExternal(url)
      return ok(true)
    } catch (e) {
      return toFail(e)
    }
  })

  ipcMain.handle('app:setTheme', async (e, opts: { bg: string; symbol: string; dark: boolean }) => {
    try {
      // 只接受形如 #rrggbb 的颜色，避免脏值写入原生窗口
      const hex = /^#[0-9a-f]{6}$/i
      const bg = hex.test(opts?.bg ?? '') ? opts.bg : '#0f1115'
      const symbol = hex.test(opts?.symbol ?? '') ? opts.symbol : '#9aa4b2'
      const win = BrowserWindow.fromWebContents(e.sender)
      win?.setBackgroundColor(bg)
      // titleBarOverlay 仅 Windows 生效；其他平台调用会被忽略，用 try 兜底
      try {
        win?.setTitleBarOverlay?.({ color: bg, symbolColor: symbol, height: 48 })
      } catch {
        /* 未启用 titleBarOverlay 的窗口会抛错，忽略 */
      }
      nativeTheme.themeSource = opts?.dark ? 'dark' : 'light'
      return ok(true)
    } catch (err) {
      return toFail(err)
    }
  })

  ipcMain.handle('app:relaunch', async () => {
    const { app } = await import('electron')
    app.relaunch()
    app.exit(0)
  })
}

export function abortAllInflight() {
  for (const c of inflight.values()) c.abort()
  inflight.clear()
}

export function broadcastToAll(channel: string, payload: unknown) {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send(channel, payload)
  }
}
