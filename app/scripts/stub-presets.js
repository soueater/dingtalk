// scripts/stub-presets.js
// 测试替身：parse.ts 只用 DEVICE_CANVAS 做尺寸兜底
export const DEVICE_CANVAS = {
  MOBILE: { width: 390, height: 844, label: '移动端' },
  TABLET: { width: 834, height: 1112, label: '平板' },
  DESKTOP: { width: 1440, height: 900, label: '桌面端' },
  RESPONSIVE: { width: 1280, height: 800, label: '响应式' },
}

export const STYLE_PRESETS = [
  {
    id: 'clear-blue',
    name: '清透蓝',
    desc: '',
    tokens: { color: { primary: '#3B82F6', bg: '#FFFFFF' } },
  },
]

export function getPreset() {
  return STYLE_PRESETS[0]
}
