// src/components/layout/ThemeMenu.tsx —— 顶栏外观主题切换入口
//
// 交互：点击图标按钮弹出面板 → 点选主题即时生效并持久化。
// 关闭：点击面板外、按 Esc、或再次点击按钮。
import { useEffect, useRef, useState } from 'react'
import { IconPalette, IconCheck } from '@/components/ui/Icons'
import { THEMES, useThemeStore, type ThemeId } from '@/stores/theme.store'

export function ThemeMenu() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  /* 点击外部 / Esc 关闭 */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (id: ThemeId) => {
    setTheme(id)
    setOpen(false)
  }

  return (
    <div className="theme-menu no-drag" ref={wrapRef}>
      <button
        className="btn btn-ghost btn-sm btn-icon"
        onClick={() => setOpen((v) => !v)}
        title="外观主题"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <IconPalette size={15} />
      </button>

      {open && (
        <div className="theme-pop" role="menu">
          <div className="theme-pop-head">外观主题</div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-item ${t.id === theme ? 'active' : ''}`}
              role="menuitemradio"
              aria-checked={t.id === theme}
              onClick={() => pick(t.id)}
            >
              <span className="theme-swatch" aria-hidden>
                {t.swatch.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              <span className="theme-item-text">
                <span className="theme-item-title">
                  {t.label}
                  <span className="theme-item-kind">{t.kind === 'dark' ? '暗' : '亮'}</span>
                </span>
                <span className="theme-item-desc">{t.desc}</span>
              </span>
              {t.id === theme && <IconCheck size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
