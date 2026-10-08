// src/stores/theme.store.ts —— 外观主题管理
//
// 单一事实来源：
//   · 颜色变量全部定义在 styles/tokens.css 的 `[data-theme="..."]` 块中
//   · 本模块只负责「当前是哪个主题」，并把结果写到 <html data-theme>
//
// 因此新增主题 = 在 tokens.css 追加一个 `[data-theme="xxx"]` 块 + 在下方 THEMES 追加一项。
import { create } from 'zustand'

export type ThemeId = 'night' | 'dawn' | 'ocean' | 'ink'

export interface ThemeMeta {
  id: ThemeId
  /** 展示名（取自中国古典意象，与项目名「望舒」同源） */
  label: string
  /** 一句话说明，展示在主题选择器中 */
  desc: string
  /** 明暗类型，用于设置 <html> 的 color-scheme */
  kind: 'dark' | 'light'
  /** 选择器中的三色小样，顺序：[主色, 背景, 表面]（与 tokens.css 保持同步） */
  swatch: [string, string, string]
  /** 原生窗口装饰（窗口底色 + Win 标题栏按钮区）取色，需与 --app-bg / --text-2 一致 */
  chrome: { bg: string; symbol: string }
}

/** 主题清单（顺序即选择器中的展示顺序） */
export const THEMES: readonly ThemeMeta[] = [
  {
    id: 'night',
    label: '夜阑',
    desc: '深色 · 默认',
    kind: 'dark',
    swatch: ['#4c8dff', '#0f1115', '#20252f'],
    chrome: { bg: '#0f1115', symbol: '#9aa4b2' },
  },
  {
    id: 'dawn',
    label: '晨光',
    desc: '浅色 · 清爽',
    kind: 'light',
    swatch: ['#2f6fed', '#f4f6f9', '#ffffff'],
    chrome: { bg: '#f4f6f9', symbol: '#56637a' },
  },
  {
    id: 'ocean',
    label: '沧海',
    desc: '深色 · 蓝调',
    kind: 'dark',
    swatch: ['#35b8d8', '#0a1018', '#1a2637'],
    chrome: { bg: '#0a1018', symbol: '#93a8bb' },
  },
  {
    id: 'ink',
    label: '墨韵',
    desc: '浅色 · 紫调',
    kind: 'light',
    swatch: ['#6b5b95', '#f5f4f8', '#ffffff'],
    chrome: { bg: '#f5f4f8', symbol: '#5f5877' },
  },
] as const

export const DEFAULT_THEME: ThemeId = 'night'

/** localStorage 键（改名后保持稳定，勿随品牌名变化） */
const STORAGE_KEY = 'wangshu.theme'

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && THEMES.some((t) => t.id === v)
}

export function getThemeMeta(id: ThemeId): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/** 读取持久化主题；非法/缺失时回落到默认 */
function readStored(): ThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isThemeId(v) ? v : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/**
 * 把主题写到 DOM 上。
 * 只改 `data-theme`（触发 tokens.css 的变量覆盖）与 `color-scheme`
 * （让原生滚动条 / 表单控件 / Windows 窗口边框跟随明暗）。
 * 若在桌面客户端内，再顺带把原生窗口底色与标题栏按钮区同步过去，
 * 否则浅色主题下 Windows 右上角会残留一条深色条带。
 */
export function applyTheme(id: ThemeId): void {
  const root = document.documentElement
  const meta = getThemeMeta(id)
  root.dataset.theme = id
  root.style.colorScheme = meta.kind

  const api = (window as unknown as { dsa?: { app?: { setTheme?: (o: unknown) => unknown } } }).dsa
  try {
    api?.app?.setTheme?.({ ...meta.chrome, dark: meta.kind === 'dark' })
  } catch {
    /* 纯浏览器环境（devtools / 单测）没有该通道，忽略 */
  }
}

interface ThemeState {
  theme: ThemeId
  /** 切换主题：写 DOM + 持久化 + 更新状态 */
  setTheme: (id: ThemeId) => void
  /** 启动时调用：从 localStorage 恢复并应用 */
  init: () => ThemeId
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: DEFAULT_THEME,

  setTheme: (id) => {
    applyTheme(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      /* 隐私模式 / 配额满：不阻断切换，仅不持久化 */
    }
    set({ theme: id })
  },

  init: () => {
    const id = readStored()
    applyTheme(id)
    set({ theme: id })
    return id
  },
}))
