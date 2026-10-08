// electron/preload/index.ts
// 唯一的主进程通道：contextBridge 只暴露语义化方法，不透传 ipcRenderer
import { contextBridge, ipcRenderer } from 'electron'
import type {
  ChatRequest,
  ConfigInput,
  DesignSpec,
  ExportFormat,
  ExportRequest,
  ExportResult,
  ChunkEvent,
  DoneEvent,
  ErrorEvent,
  ProjectFile,
  ProjectMeta,
  ProjectListPayload,
  SnapshotEntry,
  ProjectBranch,
  ProjectBranchSummary,
  WorkspaceEntry,
  WorkspaceIndex,
  SessionFile,
  TestResult,
  IpcResult,
  ConfigPublic,
} from '../../shared/design'

type R<T> = Promise<IpcResult<T>>

/** 本窗口启动时被要求打开的项目（多窗口会话恢复 / 用望舒打开 .dsproj） */
function initialProjectFromArgv(): string | null {
  const hit = process.argv.find((a) => a.startsWith('--wshu-project='))
  return hit ? hit.slice('--wshu-project='.length) : null
}

const api = {
  project: {
    list: (): R<ProjectListPayload> => ipcRenderer.invoke('project:list'),
    scan: (dir?: string): R<ProjectMeta[]> => ipcRenderer.invoke('project:scan', dir),
    open: (filePath: string): R<{ path: string; project: ProjectFile }> =>
      ipcRenderer.invoke('project:open', filePath),
    openByDialog: (): R<{ path: string; project: ProjectFile } | null> =>
      ipcRenderer.invoke('project:openByDialog'),
    save: (path: string, project: ProjectFile): R<{ path: string }> =>
      ipcRenderer.invoke('project:save', { path, project }),
    saveAs: (project: ProjectFile, suggestedName?: string): R<{ path: string } | null> =>
      ipcRenderer.invoke('project:saveAs', { project, suggestedName }),
    create: (name: string, project: ProjectFile): R<{ path: string }> =>
      ipcRenderer.invoke('project:create', { name, project }),
    duplicate: (path: string, newName?: string): R<{ path: string; meta: ProjectMeta | null }> =>
      ipcRenderer.invoke('project:duplicate', { path, newName }),
    /** deleteFile=true 时走系统回收站（可恢复） */
    remove: (path: string, deleteFile = false, projectId?: string): R<boolean> =>
      ipcRenderer.invoke('project:remove', { path, deleteFile, projectId }),
    revealInFolder: (path: string): R<boolean> => ipcRenderer.invoke('project:revealInFolder', path),
    defaultDir: (): R<string> => ipcRenderer.invoke('project:defaultDir'),
    thumb: {
      set: (id: string, dataUrl: string): R<boolean> =>
        ipcRenderer.invoke('project:thumb:set', { id, dataUrl }),
      get: (id: string): R<string | null> => ipcRenderer.invoke('project:thumb:get', id),
      clear: (id: string): R<boolean> => ipcRenderer.invoke('project:thumb:clear', id),
      /** 由主进程光栅化并缓存缩略图（项目中心卡片用） */
      render: (
        id: string,
        page: { id: string; name: string; width: number; height: number; html: string },
        targetWidth?: number,
      ): R<boolean> => ipcRenderer.invoke('project:thumb:render', { id, page, targetWidth }),
    },
  },

  workspace: {
    get: (): R<WorkspaceIndex> => ipcRenderer.invoke('workspace:get'),
    save: (index: WorkspaceIndex): R<WorkspaceIndex> => ipcRenderer.invoke('workspace:save', index),
    patchEntry: (id: string, patch: Partial<WorkspaceEntry>): R<WorkspaceIndex> =>
      ipcRenderer.invoke('workspace:patchEntry', { id, patch }),
    forget: (id: string): R<WorkspaceIndex> => ipcRenderer.invoke('workspace:forget', id),
    addGroup: (name: string): R<WorkspaceIndex> => ipcRenderer.invoke('workspace:addGroup', name),
    renameGroup: (id: string, name: string): R<WorkspaceIndex> =>
      ipcRenderer.invoke('workspace:renameGroup', { id, name }),
    removeGroup: (id: string): R<WorkspaceIndex> => ipcRenderer.invoke('workspace:removeGroup', id),
    ensureTag: (tag: string): R<WorkspaceIndex> => ipcRenderer.invoke('workspace:ensureTag', tag),
  },

  snapshot: {
    writeAuto: (projectId: string, design: ProjectFile['design']): R<boolean> =>
      ipcRenderer.invoke('snapshot:auto:write', { projectId, design }),
    readAuto: (projectId: string, updatedAt?: string): R<ProjectFile | null> =>
      ipcRenderer.invoke('snapshot:auto:read', { projectId, updatedAt }),
    clearAuto: (projectId: string): R<boolean> => ipcRenderer.invoke('snapshot:auto:clear', projectId),
    list: (projectId: string): R<SnapshotEntry[]> => ipcRenderer.invoke('snapshot:list', projectId),
    create: (projectId: string, design: ProjectFile['design'], name: string): R<SnapshotEntry | null> =>
      ipcRenderer.invoke('snapshot:create', { projectId, design, name }),
    read: (projectId: string, snapshotId: string): R<ProjectFile | null> =>
      ipcRenderer.invoke('snapshot:read', { projectId, snapshotId }),
    remove: (projectId: string, snapshotId: string): R<boolean> =>
      ipcRenderer.invoke('snapshot:remove', { projectId, snapshotId }),
  },

  /* 方案分支（F-PM-07） */
  branch: {
    list: (projectId: string): R<ProjectBranchSummary[]> => ipcRenderer.invoke('branch:list', projectId),
    create: (args: {
      projectId: string
      name: string
      aspect?: string
      pages: ProjectFile['design']['pages']
      flows: ProjectFile['design']['flows']
      tokens?: ProjectFile['design']['tokens']
    }): R<ProjectBranchSummary | null> => ipcRenderer.invoke('branch:create', args),
    read: (projectId: string, branchId: string): R<ProjectBranch | null> =>
      ipcRenderer.invoke('branch:read', { projectId, branchId }),
    rename: (args: { projectId: string; branchId: string; name: string; aspect?: string }): R<boolean> =>
      ipcRenderer.invoke('branch:rename', args),
    adopt: (projectId: string, branchId: string): R<boolean> =>
      ipcRenderer.invoke('branch:adopt', { projectId, branchId }),
    remove: (projectId: string, branchId: string): R<boolean> =>
      ipcRenderer.invoke('branch:remove', { projectId, branchId }),
  },

  win: {
    openProject: (projectPath: string): R<boolean> =>
      ipcRenderer.invoke('window:openProject', projectPath),
    setProject: (projectPath: string | null): R<boolean> =>
      ipcRenderer.invoke('window:setProject', projectPath),
    snapshotSession: (): R<SessionFile> => ipcRenderer.invoke('window:snapshotSession'),
  },

  settings: {
    get: (): R<{
      mcp: { enabled: boolean; port: number; tokenMasked: string }
      limits: { maxPagesPerProject: number }
      autoThumbnail: boolean
      autoSaveDebounceMs: number
    }> => ipcRenderer.invoke('settings:get'),
    save: (patch: Record<string, unknown>): R<unknown> => ipcRenderer.invoke('settings:save', patch),
    rotateMcpToken: (): R<unknown> => ipcRenderer.invoke('settings:rotateMcpToken'),
  },

  mcp: {
    status: (): R<{
      running: boolean
      enabled: boolean
      port: number
      endpoint: string
      toolCount: number
      tokenMasked: string
      selfTest: { ok: boolean; detail: string }
    }> => ipcRenderer.invoke('mcp:status'),
    start: (): R<{ port: number; endpoint: string }> => ipcRenderer.invoke('mcp:start'),
    stop: (): R<boolean> => ipcRenderer.invoke('mcp:stop'),
  },

  designMd: {
    /** 由主进程抓取任意 URL 的 DESIGN.md（渲染层受 CSP/CORS 限制，做不到） */
    fetch: (url: string): R<{ url: string; text: string }> => ipcRenderer.invoke('designMd:fetch', url),
  },

  specLibrary: {
    list: (): R<DesignSpec[]> => ipcRenderer.invoke('spec:library:list'),
    upsert: (spec: DesignSpec): R<DesignSpec[]> => ipcRenderer.invoke('spec:library:upsert', spec),
    remove: (id: string): R<DesignSpec[]> => ipcRenderer.invoke('spec:library:remove', id),
    save: (list: DesignSpec[]): R<DesignSpec[]> => ipcRenderer.invoke('spec:library:save', list),
  },

  config: {
    get: (): R<{ list: ConfigPublic[]; encrypted: boolean }> => ipcRenderer.invoke('config:get'),
    save: (input: ConfigInput): R<ConfigPublic> => ipcRenderer.invoke('config:save', input),
    remove: (id: string): R<boolean> => ipcRenderer.invoke('config:remove', id),
    setDefault: (id: string): R<boolean> => ipcRenderer.invoke('config:setDefault', id),
    test: (input: ConfigInput): R<TestResult> => ipcRenderer.invoke('config:test', input),
  },

  llm: {
    chat: (req: ChatRequest): R<{ content: string; model: string; ms: number }> =>
      ipcRenderer.invoke('llm:chat', req),
    chatStream: (req: ChatRequest, token: string): R<boolean> =>
      ipcRenderer.invoke('llm:chatStream', { req, token }),
    abort: (token: string): R<boolean> => ipcRenderer.invoke('llm:abort', token),
    onChunk: (cb: (e: ChunkEvent) => void) => subscribe('llm:chunk', cb),
    onDone: (cb: (e: DoneEvent) => void) => subscribe('llm:done', cb),
    onError: (cb: (e: ErrorEvent) => void) => subscribe('llm:error', cb),
  },

  exporter: {
    pickTarget: (format: ExportFormat, name: string, isDir: boolean): R<string | null> =>
      ipcRenderer.invoke('export:pickTarget', { format, name, isDir }),
    write: (
      req: ExportRequest & { pngBase64?: Record<string, string> },
    ): R<ExportResult> => ipcRenderer.invoke('export:write', req),
    /** F-ST-01 / F-PM-06：另存为纯文本（设计规范 JSON / Markdown / DESIGN.md） */
    saveText: (
      suggestedName: string,
      content: string,
      filters?: Array<{ name: string; extensions: string[] }>,
    ): R<{ ok: boolean; canceled: boolean; path: string }> =>
      ipcRenderer.invoke('export:saveText', { suggestedName, content, filters }),
  },

  app: {
    info: (): R<{
      version: string
      platform: string
      encrypted: boolean
      primaryWindowId: number | null
    }> => ipcRenderer.invoke('app:info'),
    openExternal: (url: string): R<boolean> => ipcRenderer.invoke('app:openExternal', url),
    relaunch: (): R<void> => ipcRenderer.invoke('app:relaunch'),
    /** 把渲染层的主题色同步给原生窗口（底色 / Win 标题栏按钮区 / color-scheme） */
    setTheme: (opts: { bg: string; symbol: string; dark: boolean }): R<boolean> =>
      ipcRenderer.invoke('app:setTheme', opts),
    /**
     * 把「有未保存改动」同步给主进程关闭守卫。
     * 主进程据此决定关窗时是否弹「保存并关闭 / 不保存 / 取消」。
     */
    setDirty: (dirty: boolean): R<boolean> => ipcRenderer.invoke('app:setDirty', dirty),
    /** 主进程请求渲染层保存（关闭守卫选了「保存并关闭」时触发） */
    onCloseSaveRequest: (cb: () => void) => subscribe('app:closeSaveRequest', cb),
    /** 回报保存结果：true 主进程放行关闭，false 保持窗口打开 */
    reportCloseSaveResult: (ok: boolean): R<boolean> => ipcRenderer.invoke('app:closeSaveResult', ok),
    /** 本窗口启动时被要求打开的项目路径（多窗口会话恢复用） */
    initialProject: initialProjectFromArgv(),
  },
}

/** 订阅主进程推送，返回退订函数 */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, handler as never)
  return () => ipcRenderer.removeListener(channel, handler as never)
}

contextBridge.exposeInMainWorld('dsa', api)

export type DsaApi = typeof api
