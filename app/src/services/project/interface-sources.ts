// src/services/project/interface-sources.ts
// 界面来源适配器注册表（F-PM-05 的"扩展机制"第二层）。
//
// 需求里的"扩展机制"应理解为两层：
//   ① 界面**数量**的扩展（单个新增 / 复制 / 批量 / 续生成 / 导入 / 模板）
//   ② **能力本身**的扩展 —— 未来要接入新的界面来源（MCP、Figma、设计稿解析…）
//      时，不应该改动 UI 与数据结构。
// 本文件负责 ②：UI 只消费 `listInterfaceSources()`，新增来源只需 register 一个适配器。
import type { DesignJSON, Device, Node } from '@shared/design'
import { buildTemplatePageNodes, findTemplate } from '@/services/design/interface-templates'
import { guessInterfaceName, htmlToNodes } from '@/services/design/html-to-nodes'

/** 一个"待落盘"的界面提案：调用方确认后才写进项目 */
export interface PageProposal {
  name: string
  /** 节点树；不提供则由调用方补一个空白根容器 */
  root?: Node
  /** 建议归入的分组名；调用方按需建组 */
  groupName?: string
}

export interface ProposeContext {
  /** 当前项目数据（只读） */
  design: DesignJSON
  /** 要产出几个（部分来源支持） */
  count?: number
  device?: Device
  /** 模板 id（template 来源用） */
  templateId?: string
  /** 原始 HTML（html 来源用） */
  html?: string
  /** 自然语言描述（describe 来源用） */
  description?: string
  /** 模型配置 id（联网来源用） */
  configId?: string
  /** 已有界面名，供联网来源避免重复 */
  existingNames?: string[]
  /** 分组名（批量新增时归入） */
  groupName?: string
}

export interface InterfaceSource {
  id: string
  label: string
  /** 一句话说明，用于 UI 的按钮 tooltip */
  desc: string
  /** 是否完全离线（离线来源在无模型配置时也应当可用） */
  offline: boolean
  /** UI 需要用户补充哪些输入 */
  requires: Array<'count' | 'template' | 'description' | 'html' | 'image' | 'config'>
  propose: (ctx: ProposeContext) => Promise<PageProposal[]>
}

const REGISTRY = new Map<string, InterfaceSource>()

export function registerInterfaceSource(s: InterfaceSource): void {
  REGISTRY.set(s.id, s)
}

export function listInterfaceSources(): InterfaceSource[] {
  return [...REGISTRY.values()]
}

export function getInterfaceSource(id: string): InterfaceSource | undefined {
  return REGISTRY.get(id)
}

/* ------------------------------ 内置离线来源 ------------------------------ */

/** 空白：只申请 N 个空界面，节点树交给调用方生成 */
registerInterfaceSource({
  id: 'blank',
  label: '空白界面',
  desc: '追加 N 个空白界面，自己画或稍后让 AI 补齐',
  offline: true,
  requires: ['count'],
  propose: async (ctx) => {
    const n = Math.max(1, Math.trunc(ctx.count ?? 1))
    return Array.from({ length: n }, (_, i) => ({ name: `界面 ${i + 1}` }))
  },
})

/** 模板：从内置模板实例化骨架 */
registerInterfaceSource({
  id: 'template',
  label: '从模板',
  desc: '用内置结构模板（登录流 / 列表详情 / 数据看板 …）快速起稿',
  offline: true,
  requires: ['template'],
  propose: async (ctx) => {
    const tpl = findTemplate(ctx.templateId ?? '')
    if (!tpl) return []
    return tpl.pages.map((p) => ({
      name: p.name,
      root: buildTemplatePageNodes(p.blocks),
      groupName: tpl.groupName,
    }))
  },
})

/** HTML 导入：结构提炼（离线） */
registerInterfaceSource({
  id: 'html',
  label: '从 HTML 导入',
  desc: '粘贴 HTML 源码，本地提炼出可编辑的结构骨架（离线）',
  offline: true,
  requires: ['html'],
  propose: async (ctx) => {
    const html = String(ctx.html ?? '')
    if (!html.trim()) return []
    return [{ name: guessInterfaceName(html), root: htmlToNodes(html) }]
  },
})

/** 描述导入：走模型的来源在此"占位注册"，实现由 plan-interfaces 在联网侧覆盖 */
registerInterfaceSource({
  id: 'describe',
  label: '按描述生成',
  desc: '用一段文字描述生成一个界面（需要配置模型）',
  offline: false,
  requires: ['description', 'config'],
  propose: async () => {
    throw new Error('「按描述生成」需要模型支持，请在 AI 面板中使用「生成界面」')
  },
})

export { guessInterfaceName, htmlToNodes }
