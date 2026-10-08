// src/services/mock/projects.ts
// 内置示例项目与空项目工厂。示例用于「无需配置模型即可体验编辑器」。
//
// 注意：空白界面 / 空白项目的**规范工厂**已下沉到
// `services/project/pages.ts`（blankInterface）与 `services/project/quota.ts`，
// 本文件只做示例数据 + 向后兼容的转发，避免同一逻辑存在两处实现。
import type { DesignJSON, Device, Node, Page } from '@shared/design'
import { DEFAULT_QUOTA, SCHEMA_VERSION } from '@shared/design'
import { DEVICE_CANVAS, getPreset } from '@/services/design/style-presets'
import { uid } from '@/lib/id'
import { blankInterface } from '@/services/project/pages'

/* --------------------------------- 工具 --------------------------------- */

function canvasOf(device: Device) {
  return DEVICE_CANVAS[device] ?? DEVICE_CANVAS.MOBILE
}

export function createDefaultProject(device: Device = 'MOBILE'): DesignJSON {
  const now = new Date().toISOString()
  const c = canvasOf(device)
  const preset = getPreset('clear-blue')!
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: `proj_${uid()}`,
      name: '未命名项目',
      device,
      canvas: { width: c.width, height: c.height },
      createdAt: now,
      updatedAt: now,
      source: 'blank',
      // F-PM-05：新项目一律带一份显式配额，避免"读取时兜底"成为唯一来源
      quota: { ...DEFAULT_QUOTA },
    },
    tokens: JSON.parse(JSON.stringify(preset.tokens)),
    assets: [],
    pages: [emptyPage(device, 0)],
    flows: [],
    pageGroups: [],
  }
}

/** 一个空白界面：转发到生产路径的唯一工厂（services/project/pages.ts） */
export function emptyPage(device: Device = 'MOBILE', order = 0): Page {
  return blankInterface(device, order)
}

/* ------------------------------- 示例项目 ------------------------------- */

/** 简写：文本节点 */
function text(
  content: string,
  fontKey: string,
  opt: { color?: string; id?: string; width?: unknown; align?: 'left' | 'center' | 'right' } = {},
): Node {
  return {
    id: opt.id ?? `txt_${uid()}`,
    type: 'text',
    name: content.slice(0, 14),
    props: { content },
    layout: {
      mode: 'flex',
      width: (opt.width ?? 'fill') as never,
      height: 'fit',
    },
    style: {
      font: { size: undefined },
      textColor: opt.color ?? '$color.text',
      textAlign: opt.align ?? 'left',
      // 用 token 引用表达字阶，渲染层解析
      ...({ fontToken: fontKey } as Record<string, unknown>),
    },
  }
}

function stack(
  id: string,
  name: string,
  children: Node[],
  layout: Node['layout'],
  style: Node['style'] = {},
): Node {
  return { id, type: 'frame', name, layout, style, children }
}

function button(label: string, id?: string, variant: 'primary' | 'ghost' = 'primary'): Node {
  return {
    id: id ?? `btn_${uid()}`,
    type: 'button',
    name: label,
    props: { label, variant },
    layout: { mode: 'flex', width: 'fill', height: 48, justify: 'center', align: 'center' },
    style: {
      fill: variant === 'primary' ? '$color.primary' : 'transparent',
      radius: '$radius.md',
      stroke: variant === 'ghost' ? { color: '$color.border', width: 1, position: 'inside' } : undefined,
      font: { size: 15, weight: 600 },
      textColor: variant === 'primary' ? '$color.onPrimary' : '$color.text',
      cursor: 'pointer',
    },
  }
}

function inputField(placeholder: string, id?: string): Node {
  return {
    id: id ?? `inp_${uid()}`,
    type: 'input',
    name: placeholder,
    props: { placeholder, inputType: 'text' },
    layout: { mode: 'flex', width: 'fill', height: 48, align: 'center' },
    style: {
      fill: '$color.surface',
      radius: '$radius.md',
      stroke: { color: '$color.border', width: 1, position: 'inside' },
      font: { size: 15 },
      textColor: '$color.text',
    },
  }
}

function buildLoginProject(): DesignJSON {
  const now = new Date().toISOString()
  const preset = getPreset('clear-blue')!
  const c = canvasOf('MOBILE')

  const loginRoot = stack(
    'root_login',
    '登录页根容器',
    [
      stack('brand_block', '品牌区', [
        {
          id: 'logo_1',
          type: 'shape',
          name: 'Logo',
          layout: { width: 64, height: 64 },
          style: { fill: '$color.primary', radius: '$radius.lg' },
        },
        text('欢迎回来', 'h1', { color: '$color.text', align: 'center' }),
        text('登录以继续使用您的账户', 'body', { color: '$color.textSecondary', align: 'center' }),
      ], {
        mode: 'flex', direction: 'column', width: 'fill', height: 'fit',
        align: 'center', gap: 12, padding: { t: 48, b: 32 },
      } as never),
      stack('form_block', '表单区', [
        inputField('手机号或邮箱', 'input_account'),
        inputField('密码', 'input_password'),
        button('登录', 'btn_login'),
        text('忘记密码？', 'caption', { color: '$color.primary', align: 'center', id: 'txt_forgot' }),
      ], {
        mode: 'flex', direction: 'column', width: 'fill', height: 'fit',
        gap: 14, padding: { l: 24, r: 24 },
      } as never),
      { id: 'spacer_login', type: 'frame', name: '弹性占位', layout: { width: 'fill', height: 'fill', grow: 1 } },
      text('还没有账号？立即注册', 'caption', { color: '$color.textSecondary', align: 'center', id: 'txt_signup' }),
    ],
    {
      mode: 'flex', direction: 'column', width: 'fill', height: 'fill', gap: 0,
    } as never,
    { fill: '$color.bg' },
  )

  const homeRoot = stack(
    'root_home',
    '首页根容器',
    [
      stack('nav_home', '顶部导航', [
        text('首页', 'h3', { color: '$color.text' }),
        text('账户', 'body', { color: '$color.textSecondary', align: 'right', id: 'txt_to_login' }),
      ], {
        mode: 'flex', direction: 'row', width: 'fill', height: 'fit',
        justify: 'between', align: 'center', padding: { t: 16, b: 16 },
      } as never),
      stack('hero_card', '欢迎卡片', [
        text('下午好，李明', 'h2', { color: '$color.text' }),
        text('今天有 3 项待办等待处理', 'body', { color: '$color.textSecondary' }),
      ], {
        mode: 'flex', direction: 'column', width: 'fill', height: 'fit',
        gap: 8, padding: { t: 20, r: 20, b: 20, l: 20 },
      } as never, { fill: '$color.primarySoft', radius: '$radius.lg' }),
      stack('list_block', '数据列表', [
        text('最近动态', 'h3', { color: '$color.text' }),
        ...[1, 2, 3].map((i) =>
          stack(`list_item_${i}`, `条目 ${i}`, [
            { id: `avatar_${i}`, type: 'avatar', name: '头像', layout: { width: 40, height: 40 }, style: { fill: '$color.surfaceAlt', radius: '$radius.full' } },
            stack(`item_text_${i}`, '文本', [
              text(`待办事项 ${i}`, 'bodyStrong', { color: '$color.text' }),
              text('由张伟分配 · 今天 15:00', 'caption', { color: '$color.textMuted' }),
            ], { mode: 'flex', direction: 'column', width: 'fill', height: 'fit', gap: 2 } as never),
          ], {
            mode: 'flex', direction: 'row', width: 'fill', height: 'fit',
            gap: 12, align: 'center', padding: { t: 12, b: 12 },
          } as never, { stroke: { color: '$color.border', width: 1, position: 'inside' }, radius: '$radius.md', fill: '$color.bg' }),
        ),
      ], {
        mode: 'flex', direction: 'column', width: 'fill', height: 'fit', gap: 12,
        padding: { l: 20, r: 20, t: 20, b: 20 },
      } as never),
    ],
    { mode: 'flex', direction: 'column', width: 'fill', height: 'fill', gap: 0 } as never,
    { fill: '$color.bg' },
  )

  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: 'proj_demo_login',
      name: '示例 · 登录与首页',
      device: 'MOBILE',
      canvas: { width: c.width, height: c.height },
      createdAt: now,
      updatedAt: now,
      source: 'mock',
      prompt: '一个简洁的移动端登录页和一个含待办列表的首页',
    },
    tokens: JSON.parse(JSON.stringify(preset.tokens)),
    assets: [],
    pages: [
      { id: 'page_login', name: '登录页', order: 0, pos: { x: 0, y: 0 }, background: '$color.bg', root: loginRoot },
      { id: 'page_home', name: '首页', order: 1, pos: { x: 440, y: 0 }, background: '$color.bg', root: homeRoot },
    ],
    flows: [
      { id: 'flow_1', from: 'btn_login', fromPage: 'page_login', to: 'page_home', trigger: 'click', transition: 'slide-left' },
      { id: 'flow_2', from: 'txt_to_login', fromPage: 'page_home', to: 'page_login', trigger: 'click', transition: 'slide-right' },
    ],
  }
}

function buildDashboardProject(): DesignJSON {
  const now = new Date().toISOString()
  const preset = getPreset('teal-calm')!
  const c = canvasOf('DESKTOP')

  const root = stack(
    'root_dash',
    '仪表盘根容器',
    [
      stack('sidebar', '侧边栏', [
        text('控制台', 'h3', { color: '$color.onPrimary' }),
        ...['概览', '数据', '用户', '设置'].map((label, i) =>
          text(label, 'body', { color: '$color.onPrimary', id: `nav_${i}` }),
        ),
      ], {
        mode: 'flex', direction: 'column', width: 200, height: 'fill', gap: 14,
        padding: { t: 24, r: 16, b: 24, l: 16 },
      } as never, { fill: '$color.primary' }),
      stack('content', '内容区', [
        text('数据概览', 'h1', { color: '$color.text' }),
        stack('kpi_row', '指标卡行', [
          ...[['总用户', '12,480'], ['活跃度', '68%'], ['转化率', '4.2%']].map(([k, v], i) =>
            stack(`kpi_${i}`, k, [
              text(k, 'caption', { color: '$color.textSecondary' }),
              text(v, 'h2', { color: '$color.text' }),
            ], {
              mode: 'flex', direction: 'column', width: 'fill', height: 'fit', gap: 6,
              padding: { t: 20, r: 20, b: 20, l: 20 }, grow: 1,
            } as never, { fill: '$color.surface', radius: '$radius.lg', stroke: { color: '$color.border', width: 1, position: 'inside' } }),
          ),
        ], { mode: 'flex', direction: 'row', width: 'fill', height: 'fit', gap: 16 } as never),
        stack('chart_card', '趋势图', [
          text('近 30 天趋势', 'h3', { color: '$color.text' }),
          { id: 'chart_1', type: 'chart', name: '折线图', layout: { width: 'fill', height: 260 }, style: { fill: '$color.surfaceAlt', radius: '$radius.md' }, props: { chartType: 'line', dataset: [12, 18, 15, 24, 30, 28, 36] } },
        ], {
          mode: 'flex', direction: 'column', width: 'fill', height: 'fit', gap: 12,
          padding: { t: 20, r: 20, b: 20, l: 20 },
        } as never, { fill: '$color.bg', radius: '$radius.lg', stroke: { color: '$color.border', width: 1, position: 'inside' } }),
      ], {
        mode: 'flex', direction: 'column', width: 'fill', height: 'fill', gap: 20,
        padding: { t: 24, r: 24, b: 24, l: 24 }, grow: 1,
      } as never),
    ],
    { mode: 'flex', direction: 'row', width: 'fill', height: 'fill', gap: 0 } as never,
    { fill: '$color.bg' },
  )

  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: 'proj_demo_dashboard',
      name: '示例 · 数据看板',
      device: 'DESKTOP',
      canvas: { width: c.width, height: c.height },
      createdAt: now,
      updatedAt: now,
      source: 'mock',
      prompt: '一个带侧边栏和数据卡片的桌面端管理看板',
    },
    tokens: JSON.parse(JSON.stringify(preset.tokens)),
    assets: [],
    pages: [{ id: 'page_dash', name: '数据看板', order: 0, pos: { x: 0, y: 0 }, background: '$color.bg', root }],
    flows: [],
  }
}

export interface MockProject {
  id: string
  title: string
  desc: string
  device: Device
  prompt: string
  design: DesignJSON
}

export const MOCK_PROJECTS: MockProject[] = [
  {
    id: 'demo-login',
    title: '登录与首页',
    desc: '移动端双页 · 含页面跳转',
    device: 'MOBILE',
    prompt: '一个简洁的移动端登录页和一个含待办列表的首页，登录后跳转到首页',
    design: buildLoginProject(),
  },
  {
    id: 'demo-dashboard',
    title: '数据看板',
    desc: '桌面端单页 · 侧边栏 + KPI 卡片',
    device: 'DESKTOP',
    prompt: '一个带侧边栏、KPI 指标卡和趋势图的桌面端数据看板',
    design: buildDashboardProject(),
  },
]
