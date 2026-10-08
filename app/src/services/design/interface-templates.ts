// src/services/design/interface-templates.ts
// 界面模板（F-PM-05 扩展机制 X-6）：从模板实例化界面骨架。
//
// 定位：模板**不是**成品设计，而是"结构草稿" —— 给出一屏该有的分区（导航 / 标题 /
// 列表 / 表单 / 按钮），让用户或 AI 在此之上继续。这与 Stitch 的 Examples 预设
// 不同（那是成品案例），望舒两者都要有：成品用 MOCK_PROJECTS，结构用本文件。
import type { Device, Node } from '@shared/design'
import { uid } from '@/lib/id'

/** 分区类型 —— 描述"这一块大概长什么样"，由 buildBlock 展开为真实节点 */
export type BlockKind =
  | 'navbar'
  | 'title'
  | 'subtitle'
  | 'text'
  | 'input'
  | 'button'
  | 'list'
  | 'cardGrid'
  | 'chart'
  | 'avatarRow'
  | 'tabs'
  | 'spacer'

export interface BlockSpec {
  kind: BlockKind
  /** 展示文案（标题 / 按钮文字 / 占位符） */
  text?: string
  /** 重复份数（列表行数、卡片数） */
  count?: number
  /** 主按钮用 primary 填充 */
  primary?: boolean
}

export interface PageTemplate {
  name: string
  blocks: BlockSpec[]
}

export interface InterfaceTemplate {
  id: string
  name: string
  desc: string
  /** 适用设备；不填表示通用 */
  device?: Device
  /** 建议的界面分组名（多个界面会归入同一分组） */
  groupName?: string
  pages: PageTemplate[]
}

/* ---------------------------------- 构建 ---------------------------------- */

const SP = { t: 16, r: 16, b: 16, l: 16 }

function n(
  type: Node['type'],
  name: string,
  props: Record<string, unknown> | undefined,
  layout: Node['layout'],
  style: Node['style'],
  children?: Node[],
): Node {
  return { id: `${type}_${uid()}`, type, name, props, layout, style, children }
}

/** 把一个分区描述展开为节点 */
export function buildBlock(b: BlockSpec): Node {
  switch (b.kind) {
    case 'navbar':
      return n(
        'navbar',
        '顶部导航',
        { title: b.text ?? '标题' },
        { mode: 'flex', direction: 'row', width: 'fill', height: 52, align: 'center', padding: { t: 0, r: 16, b: 0, l: 16 } },
        { fill: '$color.surface', textColor: '$color.text' },
      )
    case 'title':
      return n('text', b.text ?? '大标题', { content: b.text ?? '大标题' }, { width: 'fill', height: 'fit' }, {
        font: { size: 24, weight: 700 },
        textColor: '$color.text',
      })
    case 'subtitle':
      return n('text', b.text ?? '副标题', { content: b.text ?? '副标题' }, { width: 'fill', height: 'fit' }, {
        font: { size: 14, weight: 400 },
        textColor: '$color.textSecondary',
      })
    case 'text':
      return n('text', b.text ?? '正文', { content: b.text ?? '正文内容' }, { width: 'fill', height: 'fit' }, {
        font: { size: 14, weight: 400 },
        textColor: '$color.text',
      })
    case 'input':
      return n('input', b.text ?? '输入框', { placeholder: b.text ?? '请输入' }, { width: 'fill', height: 44 }, {
        radius: '$radius.md',
        fill: '$color.surface',
        stroke: { color: '$color.border', width: 1 },
      })
    case 'button':
      return n(
        'button',
        b.text ?? '按钮',
        { label: b.text ?? '按钮' },
        { mode: 'flex', width: 'fill', height: 48, justify: 'center', align: 'center' },
        b.primary
          ? { fill: '$color.primary', radius: '$radius.md', textColor: '$color.onPrimary' }
          : { fill: '$color.surface', radius: '$radius.md', textColor: '$color.text', stroke: { color: '$color.border', width: 1 } },
      )
    case 'list': {
      const rows = Math.max(1, b.count ?? 4)
      return n(
        'list',
        '列表',
        {},
        { mode: 'flex', direction: 'column', width: 'fill', height: 'fit', gap: 8 },
        {},
        Array.from({ length: rows }, (_, i) =>
          n(
            'listItem',
            `条目 ${i + 1}`,
            { title: `列表项 ${i + 1}`, subtitle: '辅助说明' },
            { mode: 'flex', direction: 'row', width: 'fill', height: 56, align: 'center', padding: { t: 0, r: 12, b: 0, l: 12 } },
            { fill: '$color.surface', radius: '$radius.md' },
          ),
        ),
      )
    }
    case 'cardGrid': {
      const cols = Math.max(1, Math.min(3, b.count ?? 2))
      return n(
        'frame',
        '卡片栅格',
        {},
        { mode: 'grid', columns: cols, width: 'fill', height: 'fit', gap: 12 },
        {},
        Array.from({ length: cols * 2 }, (_, i) =>
          n(
            'card',
            `卡片 ${i + 1}`,
            { title: `卡片 ${i + 1}` },
            { width: 'fill', height: 96, padding: { t: 12, r: 12, b: 12, l: 12 } },
            { fill: '$color.surface', radius: '$radius.lg', stroke: { color: '$color.border', width: 1 } },
          ),
        ),
      )
    }
    case 'chart':
      return n('chart', '图表', { dataset: [12, 18, 24, 30, 26, 34] }, { width: 'fill', height: 180 }, {
        fill: '$color.surface',
        radius: '$radius.lg',
      })
    case 'avatarRow':
      return n(
        'frame',
        '头像行',
        {},
        { mode: 'flex', direction: 'row', width: 'fill', height: 56, gap: 12, align: 'center' },
        {},
        Array.from({ length: Math.max(1, b.count ?? 4) }, (_, i) =>
          n('avatar', `头像 ${i + 1}`, {}, { width: 44, height: 44 }, { radius: '$radius.full', fill: '$color.surfaceAlt' }),
        ),
      )
    case 'tabs':
      return n(
        'tabs',
        '标签栏',
        { items: ['全部', '进行中', '已完成'], active: 0 },
        { width: 'fill', height: 40 },
        { textColor: '$color.textSecondary' },
      )
    case 'spacer':
    default:
      return n('frame', '留白', {}, { width: 'fill', height: b.count ?? 16 }, {})
  }
}

/** 把模板的某一页展开为节点树 */
export function buildTemplatePageNodes(blocks: BlockSpec[]): Node {
  return n(
    'frame',
    '界面根容器',
    {},
    { mode: 'flex', direction: 'column', width: 'fill', height: 'fill', padding: SP, gap: 12 },
    { fill: '$color.bg' },
    blocks.map(buildBlock),
  )
}

/* ---------------------------------- 模板库 ---------------------------------- */

export const INTERFACE_TEMPLATES: InterfaceTemplate[] = [
  {
    id: 'tpl-auth-flow',
    name: '登录注册流',
    desc: '登录 + 注册 + 找回密码三屏，含表单与主按钮',
    groupName: '认证模块',
    pages: [
      {
        name: '登录',
        blocks: [
          { kind: 'spacer', count: 40 },
          { kind: 'title', text: '欢迎回来' },
          { kind: 'subtitle', text: '登录后继续你的工作' },
          { kind: 'spacer', count: 12 },
          { kind: 'input', text: '手机号 / 邮箱' },
          { kind: 'input', text: '密码' },
          { kind: 'spacer', count: 8 },
          { kind: 'button', text: '登录', primary: true },
          { kind: 'button', text: '还没有账号？去注册' },
        ],
      },
      {
        name: '注册',
        blocks: [
          { kind: 'navbar', text: '创建账号' },
          { kind: 'input', text: '手机号 / 邮箱' },
          { kind: 'input', text: '设置密码' },
          { kind: 'input', text: '确认密码' },
          { kind: 'spacer', count: 8 },
          { kind: 'button', text: '注册', primary: true },
        ],
      },
      {
        name: '找回密码',
        blocks: [
          { kind: 'navbar', text: '找回密码' },
          { kind: 'subtitle', text: '我们会向你的邮箱发送验证码' },
          { kind: 'input', text: '邮箱地址' },
          { kind: 'input', text: '验证码' },
          { kind: 'button', text: '发送验证码' },
          { kind: 'button', text: '下一步', primary: true },
        ],
      },
    ],
  },
  {
    id: 'tpl-list-detail',
    name: '列表 + 详情',
    desc: '最常见的两屏结构：可滚动列表与条目详情',
    groupName: '内容模块',
    pages: [
      {
        name: '列表',
        blocks: [
          { kind: 'navbar', text: '全部内容' },
          { kind: 'tabs' },
          { kind: 'list', count: 5 },
        ],
      },
      {
        name: '详情',
        blocks: [
          { kind: 'navbar', text: '详情' },
          { kind: 'title', text: '条目标题' },
          { kind: 'subtitle', text: '发布时间 · 作者' },
          { kind: 'chart' },
          { kind: 'text', text: '这里是正文段落，用于占位说明信息层级。' },
          { kind: 'button', text: '立即操作', primary: true },
        ],
      },
    ],
  },
  {
    id: 'tpl-dashboard',
    name: '数据看板',
    desc: '桌面端管理后台：概览卡片 + 趋势图 + 明细表',
    device: 'DESKTOP',
    groupName: '数据模块',
    pages: [
      {
        name: '总览',
        blocks: [
          { kind: 'title', text: '数据总览' },
          { kind: 'cardGrid', count: 3 },
          { kind: 'chart' },
          { kind: 'list', count: 4 },
        ],
      },
      {
        name: '明细',
        blocks: [
          { kind: 'title', text: '明细数据' },
          { kind: 'tabs' },
          { kind: 'list', count: 6 },
        ],
      },
    ],
  },
  {
    id: 'tpl-profile',
    name: '个人中心',
    desc: '个人中心 + 设置两屏',
    groupName: '账户模块',
    pages: [
      {
        name: '个人中心',
        blocks: [
          { kind: 'avatarRow', count: 1 },
          { kind: 'title', text: '用户昵称' },
          { kind: 'subtitle', text: '这里是个人签名' },
          { kind: 'cardGrid', count: 3 },
          { kind: 'list', count: 3 },
        ],
      },
      {
        name: '设置',
        blocks: [
          { kind: 'navbar', text: '设置' },
          { kind: 'list', count: 5 },
          { kind: 'button', text: '退出登录' },
        ],
      },
    ],
  },
  {
    id: 'tpl-empty',
    name: '单屏空白',
    desc: '只含一个空的纵向容器，适合从零开始画',
    pages: [{ name: '界面 1', blocks: [{ kind: 'spacer', count: 24 }] }],
  },
]

export function findTemplate(id: string): InterfaceTemplate | undefined {
  return INTERFACE_TEMPLATES.find((t) => t.id === id)
}
