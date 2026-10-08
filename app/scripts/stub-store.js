// scripts/stub-store.js
// 导出测试用的 store 替身：提供一个含两页的示例设计
const loginRoot = {
  id: 'root_login',
  type: 'frame',
  name: '登录页根容器',
  layout: { mode: 'flex', direction: 'column', width: 'fill', height: 'fill', gap: 12, padding: { t: 24, r: 24, b: 24, l: 24 } },
  style: { fill: '$color.bg' },
  children: [
    {
      id: 'txt_title',
      type: 'text',
      name: '标题',
      props: { content: '欢迎回来' },
      layout: { width: 'fill', height: 'fit' },
      style: { font: { size: 28, weight: 700 }, textColor: '$color.text' },
    },
    {
      id: 'btn_login',
      type: 'button',
      name: '登录',
      props: { label: '登录' },
      layout: { mode: 'flex', width: 'fill', height: 48, justify: 'center', align: 'center' },
      style: { fill: '$color.primary', radius: '$radius.md', textColor: '$color.onPrimary' },
    },
  ],
}

const homeRoot = {
  id: 'root_home',
  type: 'frame',
  name: '首页根容器',
  layout: { mode: 'flex', direction: 'column', width: 'fill', height: 'fill' },
  style: { fill: '$color.bg' },
  children: [
    {
      id: 'chart_1',
      type: 'chart',
      name: '趋势图',
      props: { dataset: [12, 18, 24, 30] },
      layout: { width: 'fill', height: 200 },
      style: { fill: '$color.surface' },
    },
  ],
}

const design = {
  // 与 shared/design.ts 的 SCHEMA_VERSION 对齐（test-export 会断言导出产物携带当前 schema）
  schemaVersion: '1.2',
  meta: {
    id: 'proj_test',
    name: '导出测试项目',
    device: 'MOBILE',
    canvas: { width: 390, height: 844 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'mock',
    prompt: '测试',
  },
  tokens: {
    color: {
      primary: '#3B82F6',
      onPrimary: '#FFFFFF',
      bg: '#FFFFFF',
      surface: '#F9FAFB',
      border: '#E5E7EB',
      text: '#111827',
      textSecondary: '#6B7280',
    },
    radius: { sm: 6, md: 10, lg: 16, full: 999 },
    space: { xs: 4, sm: 8, md: 16 },
  },
  assets: [],
  pages: [
    { id: 'page_login', name: '登录页', order: 0, pos: { x: 0, y: 0 }, background: '$color.bg', root: loginRoot },
    { id: 'page_home', name: '首页', order: 1, pos: { x: 430, y: 0 }, background: '$color.bg', root: homeRoot },
  ],
  flows: [
    { id: 'f1', from: 'btn_login', fromPage: 'page_login', to: 'page_home', trigger: 'click', transition: 'slide-left' },
  ],
}

export const __testDesign = design

export const useProjectStore = {
  getState: () => ({ design }),
}
