/**
 * Design JSON —— 全项目唯一数据源的类型契约
 * 严格对应 docs/S2-2-Design-JSON-Schema.md
 */

/**
 * 1.2：新增可选字段 meta.quota / page.groupId / design.pageGroups（F-PM-05），
 *      解析层向后兼容 1.0 与 1.1（缺失字段按默认值处理，见 resolveQuota）。
 * 1.1：新增可选字段 meta.specId / page.specId / design.specs（F-ST-01）。
 */
export const SCHEMA_VERSION = '1.2'

export type Device = 'MOBILE' | 'TABLET' | 'DESKTOP' | 'RESPONSIVE'

/**
 * 设备 → 默认画布尺寸。
 * 放在 shared 而非渲染层，是因为**主进程也需要**它：
 * 复制项目时要重排界面坐标、渲染缩略图时要算画布比例。
 * 渲染层的 `services/design/style-presets.ts` 直接 re-export 本常量。
 */
export const DEVICE_CANVAS: Record<string, { width: number; height: number; label: string }> = {
  MOBILE: { width: 390, height: 844, label: '移动端 390×844' },
  TABLET: { width: 834, height: 1112, label: '平板 834×1112' },
  DESKTOP: { width: 1440, height: 900, label: '桌面端 1440×900' },
  RESPONSIVE: { width: 1280, height: 800, label: '响应式 1280×800' },
}
export type SizeValue = number | 'auto' | 'fill' | 'fit' | `${number}%`
export type PaintRef = string | Record<string, unknown>

export interface DesignJSON {
  schemaVersion: string
  meta: Meta
  tokens: Tokens
  assets: Asset[]
  pages: Page[]
  flows: Flow[]
  /** 项目内可用的设计规范（F-ST-01）。旧文件无此字段，按「仅内置规范」处理 */
  specs?: DesignSpec[]
  /** 界面分组（F-PM-05）。旧文件无此字段，按「不分组」处理 */
  pageGroups?: PageGroup[]
}

/**
 * 界面配额（F-PM-05）。
 *
 * 「界面数量 N」在真实流程里是**三个不同的数**，混用会互相打架，故必须拆开：
 *   - planned：本次生成打算产出几屏（给 AI 规划器的目标数）。只有它 → 用户想
 *     手动加第 6 屏时会被"计划 5"卡住，荒谬。
 *   - softLimit：超了就提示但允许。只有它 → 无法表达"这个项目我就是要 30 屏"。
 *   - hardLimit：超了就禁止；0 表示不限（仍受全局兜底约束）。只有它 → AI 不知
 *     道该生成几屏，N 依然不可控。
 */
export interface InterfaceQuota {
  /** 计划界面数（生成目标），≥ 1 */
  planned: number
  /** 软上限：超出提示但允许 */
  softLimit: number
  /** 硬上限：超出禁止；0 = 不限（仍受全局 appLimits.maxPagesPerProject 约束） */
  hardLimit: number
  /** 界面的组织方式偏好，仅作生成提示，不参与强约束 */
  strategy: 'single' | 'flow' | 'batch'
}

/** 配额默认值（旧项目文件缺 meta.quota 时使用） */
export const DEFAULT_QUOTA: InterfaceQuota = {
  planned: 1,
  softLimit: 20,
  hardLimit: 100,
  strategy: 'single',
}

/** 全局兜底：无论项目怎么配，单项目界面数不得超过此值，防止内存失控 */
export const GLOBAL_MAX_PAGES = 500

/**
 * 界面分组（F-PM-05）：把 N 个界面按功能模块归拢（如「登录模块」「首页模块」）。
 * 它属于设计产物的一部分（画布上要画分组框），故进 schema 而非工作区索引。
 */
export interface PageGroup {
  id: string
  name: string
  order: number
  collapsed?: boolean
  /** 画布分组框的着色，形如 #4C8DFF；未设置时由 UI 按序取默认色板 */
  color?: string
}


export interface Meta {
  id: string
  name: string
  device: Device
  canvas: { width: number; height: number }
  createdAt: string
  updatedAt: string
  source: 'ai' | 'mock' | 'blank' | 'import'
  prompt?: string
  /** 项目级默认设计规范 id（F-ST-01）。未设置表示「未绑定」 */
  specId?: string
  /** 界面配额（F-PM-05）。旧文件无此字段，读取时由 resolveQuota 兜底 */
  quota?: InterfaceQuota
}

export interface FontToken {
  family: string
  size: number
  weight?: number
  lineHeight?: number
  letterSpacing?: number
}

export interface ShadowToken {
  x: number
  y: number
  blur: number
  spread?: number
  color: string
}

export interface Tokens {
  color?: Record<string, string>
  font?: Record<string, FontToken>
  space?: Record<string, number>
  radius?: Record<string, number>
  shadow?: Record<string, ShadowToken>
}

export interface Asset {
  id: string
  type: 'image' | 'icon' | 'font'
  src: string
  mime?: string
  width?: number
  height?: number
}

export interface Page {
  id: string
  name: string
  order: number
  pos: { x: number; y: number }
  background?: string
  root: Node
  /** 页面级设计规范 id（F-ST-01），覆盖 meta.specId */
  specId?: string
  /** 所属界面分组 id（F-PM-05），须能在 design.pageGroups 中找到 */
  groupId?: string
}

/* ---------------------------- 设计规范（F-ST-01） ---------------------------- */

/** 规范来源：内置 / 用户导入 / 从项目派生 */
export type SpecSource = 'builtin' | 'imported' | 'derived'

/** 对齐 Stitch design.md 的「要做什么 / 不要做什么」负面规则 */
export interface SpecRules {
  dos?: string[]
  donts?: string[]
}

export interface DesignSpec {
  id: string
  name: string
  desc?: string
  source: SpecSource
  tokens: Tokens
  rules?: SpecRules
  createdAt: string
}

export type NodeType =
  | 'frame' | 'group'
  | 'text' | 'image' | 'icon' | 'divider' | 'shape'
  | 'button' | 'input' | 'textarea' | 'checkbox' | 'radio' | 'switch' | 'slider' | 'select'
  | 'avatar' | 'badge' | 'tag' | 'chip' | 'progress' | 'skeleton'
  | 'navbar' | 'tabbar' | 'sidebar' | 'breadcrumb' | 'stepper'
  | 'card' | 'list' | 'listItem' | 'table' | 'tableRow' | 'tableCell'
  | 'modal' | 'drawer' | 'tooltip' | 'toast' | 'accordion' | 'tabs'
  | 'chart' | 'map' | 'calendar' | 'searchbar' | 'pagination' | 'empty'

export interface Edges {
  t?: number
  r?: number
  b?: number
  l?: number
}

export interface Layout {
  mode?: 'absolute' | 'flex' | 'grid'
  x?: number
  y?: number
  width?: SizeValue
  height?: SizeValue
  direction?: 'row' | 'column'
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline'
  gap?: number
  padding?: Edges
  margin?: Edges
  columns?: number
  wrap?: boolean
  position?: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky'
  zIndex?: number
  grow?: number
  selfAlign?: 'auto' | 'start' | 'center' | 'end' | 'stretch'
}

export interface Style {
  fill?: PaintRef
  stroke?: { color?: PaintRef; width?: number; position?: 'inside' | 'center' | 'outside' }
  radius?: number | string | { tl?: number; tr?: number; br?: number; bl?: number }
  shadow?: ShadowToken[]
  opacity?: number
  overflow?: 'visible' | 'hidden' | 'scroll' | 'auto'
  font?: {
    family?: string
    size?: number
    weight?: number
    lineHeight?: number
    letterSpacing?: number
    italic?: boolean
  }
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  textColor?: PaintRef
  textDecoration?: 'none' | 'underline' | 'line-through'
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  maxLines?: number
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none'
  cursor?: 'default' | 'pointer' | 'text' | 'grab' | 'not-allowed'
  /**
   * F-ST-02：CSS transform 原文（如 `scale(0.96)`、`translateY(-2px)`）。
   * 交互状态最常见的两种反馈「缩放」与「位移」无法用其它字段表达，
   * 而内联样式又无法承载伪类，故开放此字段供 states 使用。
   * 可选字段，旧文件不受影响。
   */
  transform?: string
}

export interface StateOverride {
  style?: Style
  props?: Record<string, unknown>
}

export interface Node {
  id: string
  type: NodeType
  name?: string
  layout?: Layout
  style?: Style
  props?: Record<string, unknown>
  children?: Node[]
  states?: Record<string, StateOverride>
  locked?: boolean
  hidden?: boolean
}

export interface Flow {
  id: string
  from: string
  fromPage: string
  to: string
  trigger: 'click' | 'hover' | 'longPress' | 'submit' | 'back'
  transition?: 'none' | 'slide-left' | 'slide-right' | 'fade' | 'slide-up'
  params?: Record<string, unknown>
}

/* ------------------------------- 项目文件 ------------------------------- */

export interface ProjectFile {
  /** 项目文件格式版本，与 DesignJSON.schemaVersion 独立 */
  fileVersion: string
  design: DesignJSON
}

/** 当前项目文件格式版本 */
export const FILE_VERSION = '1.0'

export interface ProjectMeta {
  id: string
  name: string
  updatedAt: string
  createdAt: string
  device: Device
  pageCount: number
  /** 项目文件绝对路径 */
  path: string
  thumbnail?: string
  /** F-PM-02：工作区侧元数据（收藏 / 分组 / 标签），由 workspace.json 合并而来 */
  workspace?: WorkspaceEntry
}

/* --------------------------- 工作区索引（F-PM-02） --------------------------- */

/**
 * 工作区索引：**使用者视角**的项目元数据。
 *
 * 为何独立成文件而不写进 .dsproj：
 *   1. 「收藏 / 标签 / 分组」是使用者的组织习惯，不是设计产物 —— 换个人拿到
 *      .dsproj 不应该看到别人的分类；
 *   2. 写进 .dsproj 会让多人协作编辑同一项目时产生无意义的冲突；
 *   3. 项目文件被移动/删除后，索引仍能展示"失效占位"，提升容错。
 */
export interface WorkspaceIndex {
  version: 1
  /** 项目 id → 工作区侧元数据 */
  entries: Record<string, WorkspaceEntry>
  groups: WorkspaceGroup[]
  tags: string[]
}

export interface WorkspaceEntry {
  /** 最近一次已知的绝对路径；项目被移动后靠 id 仍可认回 */
  path?: string
  /** 冗余一份名称，便于源文件被删后展示「已失效」占位 */
  name: string
  favorite?: boolean
  pinned?: boolean
  archived?: boolean
  groupId?: string
  tags?: string[]
  /** 缩略图缓存文件名（相对 thumbnailDir） */
  thumbnailFile?: string
  lastOpenedAt?: string
}

export interface WorkspaceGroup {
  id: string
  name: string
  order: number
  color?: string
}

export const EMPTY_WORKSPACE: WorkspaceIndex = { version: 1, entries: {}, groups: [], tags: [] }

/* --------------------------- 方案分支（F-PM-07） --------------------------- */

/**
 * 项目方案分支：多方向探索时，每个方向独立产出一批界面，互不干扰。
 * 存于用户数据目录（不进 .dsproj），采纳时才合并进主项目 —— 采纳必须由用户显式触发。
 */
export interface ProjectBranch {
  id: string
  projectId: string
  name: string
  /** 差异维度描述，如「布局更紧凑」「配色更暖」 */
  aspect?: string
  createdAt: string
  /** 该分支产出的界面快照 */
  pages: Page[]
  /** 该分支内的跳转关系 */
  flows: Flow[]
  /** 该分支使用的 Token 快照 */
  tokens?: Tokens
  /** 是否已被采纳进主项目 */
  adopted?: boolean
}

/**
 * 分支列表条目（F-PM-07）。
 *
 * 列表接口不能把整棵 pages/flows 搬到渲染层 —— 一个 30 屏项目分支动辄数 MB，
 * 只为了显示一行「方案 B · 12 屏」不值得。故列表只回摘要，详情按需 read。
 */
export interface ProjectBranchSummary {
  id: string
  projectId: string
  name: string
  aspect?: string
  createdAt: string
  adopted?: boolean
  pageCount: number
  flowCount: number
  /** 分支内节点总数，用于与主项目做「重量级」对比 */
  nodeCount: number
}


/* ------------------------------- 配置相关 ------------------------------- */

export type AdapterId = 'openai' | 'anthropic' | 'gemini' | 'ollama'

export interface ConfigPublic {
  id: string
  name: string
  adapter: AdapterId
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  timeoutMs: number
  stream: boolean
  isDefault: boolean
  /** 掩码后的密钥，如 sk-****abcd */
  keyMasked: string
  hasKey: boolean
}

export interface ConfigInput {
  id?: string
  name: string
  adapter: AdapterId
  baseUrl: string
  model: string
  /** 明文密钥，仅在保存/测试时一次性传递 */
  apiKey?: string
  temperature: number
  maxTokens: number
  timeoutMs: number
  stream: boolean
  isDefault?: boolean
}

export interface TestResult {
  ok: boolean
  message: string
  latencyMs?: number
  modelEcho?: string
  errorCode?: string
}

/* --------------------------------- IPC --------------------------------- */

export type ErrorCode =
  | 'E_FS_PERM'
  | 'E_FS_NOTFOUND'
  | 'E_FS_CORRUPT'
  | 'E_FS_TRASH'
  | 'E_QUOTA'
  | 'E_NET'
  | 'E_AUTH'
  | 'E_TIMEOUT'
  | 'E_RATE_LIMIT'
  | 'E_MODEL'
  | 'E_PARSE'
  | 'E_SCHEMA'
  | 'E_ABORTED'
  | 'E_MCP'
  | 'E_UNKNOWN'

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string; detail?: string }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  configId: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  timeoutMs?: number
}

export interface ChatResponse {
  content: string
  model: string
  ms: number
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

export interface ChunkEvent {
  token: string
  delta: string
  index: number
}

export interface DoneEvent {
  token: string
  content: string
  ms: number
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

export interface ErrorEvent {
  token: string
  code: ErrorCode
  message: string
}

export type ExportFormat = 'png' | 'svg' | 'html-single' | 'html-multi' | 'json'

export interface ExportRequest {
  format: ExportFormat
  /** 导出的目标文件或目录 */
  targetPath: string
  /** 要导出的页面 id；为空表示全部 */
  pageIds?: string[]
  /** 用于 PNG 渲染：每个页面的 HTML 内容 */
  pages?: Array<{ id: string; name: string; width: number; height: number; html: string }>
  /** 用于 PNG 渲染的期望像素比 */
  scale?: number
  transparent?: boolean
  /** 项目 JSON（json 格式导出时使用） */
  design?: DesignJSON
  /** html-multi 时的单文件内容映射 */
  files?: Array<{ name: string; content: string }>
}

export interface ExportResult {
  ok: boolean
  path?: string
  message: string
  files?: string[]
}

/* --------------------------- F-PM 主进程通道载荷 --------------------------- */

/** 项目中心一次拉取的项目集合（含工作区元数据） */
export interface ProjectListPayload {
  projects: ProjectMeta[]
  workspace: WorkspaceIndex
  /** 数据来源目录（默认文档/望舒） */
  defaultDir: string
}

/** 快照条目（autosave 与手动快照共用） */
export interface SnapshotEntry {
  id: string
  projectId: string
  /** ISO 时间戳 */
  at: string
  /** 'auto' 崩溃恢复 | 'manual' 用户主动创建 */
  kind: 'auto' | 'manual'
  name: string
  path: string
}

/** 会话恢复：上次退出时打开的窗口及其项目 */
export interface SessionFile {
  version: 1
  windows: Array<{ path: string; activePageId?: string }>
}

