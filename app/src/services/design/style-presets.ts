// src/services/design/style-presets.ts
// 四套内置风格预设（用户设计稿的 Token 基线），对应 docs/S2-3 §1.4
import type { Tokens } from '@shared/design'
import { DEVICE_CANVAS } from '@shared/design'

// 设备 → 画布尺寸的事实来源已上移到 shared/design.ts，
// 以便主进程（复制项目、缩略图渲染）与渲染层共用同一份定义。
export { DEVICE_CANVAS }

export interface StylePreset {
  id: string
  name: string
  desc: string
  tokens: Tokens
}

const BASE_SPACE = { xxs: 2, xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48, huge: 64 }
const BASE_FONT = (family = 'Inter'): Tokens['font'] => ({
  display: { family, size: 34, weight: 700, lineHeight: 42 },
  h1: { family, size: 28, weight: 700, lineHeight: 36 },
  h2: { family, size: 22, weight: 600, lineHeight: 30 },
  h3: { family, size: 18, weight: 600, lineHeight: 26 },
  body: { family, size: 15, weight: 400, lineHeight: 22 },
  bodyStrong: { family, size: 15, weight: 600, lineHeight: 22 },
  caption: { family, size: 13, weight: 400, lineHeight: 18 },
  overline: { family, size: 11, weight: 600, lineHeight: 16 },
})
const BASE_SHADOW: Tokens['shadow'] = {
  xs: { x: 0, y: 1, blur: 2, color: 'rgba(0,0,0,0.05)' },
  sm: { x: 0, y: 2, blur: 8, color: 'rgba(0,0,0,0.06)' },
  md: { x: 0, y: 4, blur: 16, color: 'rgba(0,0,0,0.08)' },
  lg: { x: 0, y: 8, blur: 32, color: 'rgba(0,0,0,0.12)' },
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'clear-blue',
    name: '清透蓝',
    desc: '通用 SaaS、工具类。干净中性，留白充足',
    tokens: {
      color: {
        primary: '#3B82F6', primaryHover: '#2563EB', primaryActive: '#1D4ED8',
        primarySoft: '#EFF6FF', onPrimary: '#FFFFFF',
        bg: '#FFFFFF', surface: '#F9FAFB', surfaceAlt: '#F3F4F6',
        border: '#E5E7EB', borderStrong: '#D1D5DB',
        text: '#111827', textSecondary: '#6B7280', textMuted: '#9CA3AF', textInverse: '#FFFFFF',
        success: '#10B981', warning: '#F59E0B', danger: '#EF4444', info: '#3B82F6',
      },
      font: BASE_FONT(),
      space: { ...BASE_SPACE },
      radius: { sm: 6, md: 10, lg: 16, xl: 24, full: 999 },
      shadow: { ...BASE_SHADOW },
    },
  },
  {
    id: 'mono-ink',
    name: '墨韵',
    desc: '极简、专业工具、后台。无彩高对比，锐利',
    tokens: {
      color: {
        primary: '#111827', primaryHover: '#1F2937', primaryActive: '#374151',
        primarySoft: '#F3F4F6', onPrimary: '#FFFFFF',
        bg: '#FFFFFF', surface: '#F5F5F5', surfaceAlt: '#EAEAEA',
        border: '#E0E0E0', borderStrong: '#C4C4C4',
        text: '#0A0A0A', textSecondary: '#525252', textMuted: '#8A8A8A', textInverse: '#FFFFFF',
        success: '#15803D', warning: '#B45309', danger: '#B91C1C', info: '#111827',
      },
      font: BASE_FONT(),
      space: { ...BASE_SPACE },
      radius: { sm: 4, md: 6, lg: 10, xl: 14, full: 999 },
      shadow: { ...BASE_SHADOW },
    },
  },
  {
    id: 'warm-amber',
    name: '暖橙',
    desc: '消费类、社区、内容。温暖亲和，圆润',
    tokens: {
      color: {
        primary: '#F97316', primaryHover: '#EA580C', primaryActive: '#C2410C',
        primarySoft: '#FFF7ED', onPrimary: '#FFFFFF',
        bg: '#FFFBF7', surface: '#FFF4EC', surfaceAlt: '#FFEDD5',
        border: '#F3E4D7', borderStrong: '#E7D2C0',
        text: '#1C1917', textSecondary: '#78716C', textMuted: '#A8A29E', textInverse: '#FFFFFF',
        success: '#16A34A', warning: '#F59E0B', danger: '#EF4444', info: '#F97316',
      },
      font: BASE_FONT(),
      space: { ...BASE_SPACE },
      radius: { sm: 8, md: 14, lg: 20, xl: 28, full: 999 },
      shadow: { ...BASE_SHADOW },
    },
  },
  {
    id: 'teal-calm',
    name: '青碧',
    desc: '健康、金融、B 端控制台。冷静可信，克制',
    tokens: {
      color: {
        primary: '#0D9488', primaryHover: '#0F766E', primaryActive: '#115E59',
        primarySoft: '#F0FDFA', onPrimary: '#FFFFFF',
        bg: '#FFFFFF', surface: '#F0FDFA', surfaceAlt: '#CCFBF1',
        border: '#D5E8E5', borderStrong: '#B6D8D4',
        text: '#0F172A', textSecondary: '#475569', textMuted: '#94A3B8', textInverse: '#FFFFFF',
        success: '#059669', warning: '#D97706', danger: '#DC2626', info: '#0D9488',
      },
      font: BASE_FONT(),
      space: { ...BASE_SPACE },
      radius: { sm: 6, md: 10, lg: 16, xl: 24, full: 999 },
      shadow: { ...BASE_SHADOW },
    },
  },
]

export function getPreset(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find((p) => p.id === id)
}
