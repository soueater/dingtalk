// scripts/stub-projects.js
// 测试替身：parse.ts 只需要 emptyPage 的兜底能力
export function emptyPage() {
  return {
    id: 'page_stub',
    name: '页面',
    order: 0,
    pos: { x: 0, y: 0 },
    background: '$color.bg',
    root: { id: 'root_stub', type: 'frame', layout: { mode: 'flex', width: 'fill', height: 'fill' }, children: [] },
  }
}

export function createDefaultProject() {
  return {
    schemaVersion: '1.0',
    meta: { id: 'p', name: 'x', device: 'MOBILE', canvas: { width: 390, height: 844 }, createdAt: '', updatedAt: '', source: 'blank' },
    tokens: {},
    assets: [],
    pages: [emptyPage()],
    flows: [],
  }
}

export const MOCK_PROJECTS = []
