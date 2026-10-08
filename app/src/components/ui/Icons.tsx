// src/components/ui/Icons.tsx —— 内联 SVG 图标（不引第三方，保证离线可用）
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function Base({ size = 14, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconPlus = (p: P) => (
  <Base {...p}>
    <path d="M8 3v10M3 8h10" />
  </Base>
)
export const IconFolder = (p: P) => (
  <Base {...p}>
    <path d="M2 4.5h4l1.2 1.5H14v6.5H2z" />
  </Base>
)
export const IconSave = (p: P) => (
  <Base {...p}>
    <path d="M3 2.5h8L13.5 5v8.5h-11z" />
    <path d="M5.5 2.5v4h5v-4M5.5 13.5v-4h5v4" />
  </Base>
)
export const IconExport = (p: P) => (
  <Base {...p}>
    <path d="M8 10.5V2.5M5 5.5 8 2.5l3 3" />
    <path d="M2.5 10v3.5h11V10" />
  </Base>
)
export const IconSettings = (p: P) => (
  <Base {...p}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.3 3.3l1.3 1.3M11.4 11.4l1.3 1.3M12.7 3.3l-1.3 1.3M4.6 11.4l-1.3 1.3" />
  </Base>
)
export const IconSparkles = (p: P) => (
  <Base {...p}>
    <path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4z" />
    <path d="M12.5 11.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" />
  </Base>
)
export const IconLayers = (p: P) => (
  <Base {...p}>
    <path d="M8 2 2 5.2l6 3.2 6-3.2z" />
    <path d="M2 8.4l6 3.2 6-3.2" />
    <path d="M2 11.4l6 3.2 6-3.2" />
  </Base>
)
export const IconComponent = (p: P) => (
  <Base {...p}>
    <rect x="2.5" y="2.5" width="5" height="5" rx="1" />
    <rect x="8.5" y="8.5" width="5" height="5" rx="1" />
    <path d="M5 7.5v3a1 1 0 0 0 1 1h2.5" />
  </Base>
)
export const IconSliders = (p: P) => (
  <Base {...p}>
    <path d="M3 2.5v11M8 2.5v11M13 2.5v11" />
    <circle cx="3" cy="6" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="8" cy="10" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="13" cy="4.5" r="1.4" fill="currentColor" stroke="none" />
  </Base>
)
export const IconUndo = (p: P) => (
  <Base {...p}>
    <path d="M6 4.5 3 7.5l3 3" />
    <path d="M3 7.5h6.5a3.5 3.5 0 0 1 0 7H8" />
  </Base>
)
export const IconRedo = (p: P) => (
  <Base {...p}>
    <path d="M10 4.5l3 3-3 3" />
    <path d="M13 7.5H6.5a3.5 3.5 0 0 0 0 7H8" />
  </Base>
)
export const IconZoomIn = (p: P) => (
  <Base {...p}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2 14 14M5.2 7h3.6M7 5.2v3.6" />
  </Base>
)
export const IconZoomOut = (p: P) => (
  <Base {...p}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2 14 14M5.2 7h3.6" />
  </Base>
)
export const IconFit = (p: P) => (
  <Base {...p}>
    <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
  </Base>
)
export const IconClose = (p: P) => (
  <Base {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Base>
)
export const IconCheck = (p: P) => (
  <Base {...p}>
    <path d="M3 8.5 6.2 11.5 13 4.5" />
  </Base>
)
export const IconTrash = (p: P) => (
  <Base {...p}>
    <path d="M2.5 4h11M5.5 4V2.5h5V4M4 4l.7 9.5h6.6L12 4" />
  </Base>
)
export const IconPlay = (p: P) => (
  <Base {...p}>
    <path d="M4.5 3 12.5 8l-8 5z" />
  </Base>
)
export const IconEye = (p: P) => (
  <Base {...p}>
    <path d="M1.5 8S4 4 8 4s6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4z" />
    <circle cx="8" cy="8" r="1.8" />
  </Base>
)
export const IconLink = (p: P) => (
  <Base {...p}>
    <path d="M6.5 9.5 9.5 6.5" />
    <path d="M7 4.5 8.6 3a2.5 2.5 0 0 1 3.5 3.5L10.6 8" />
    <path d="M9 11.5 7.4 13A2.5 2.5 0 0 1 3.9 9.5L5.4 8" />
  </Base>
)
export const IconWand = IconSparkles
export const IconRefresh = (p: P) => (
  <Base {...p}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.7-4" />
    <path d="M13.5 2.5V6H10" />
  </Base>
)
export const IconCopy = (p: P) => (
  <Base {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </Base>
)
export const IconEdit = (p: P) => (
  <Base {...p}>
    <path d="M10.5 2.5 13.5 5.5 6 13H3v-3z" />
  </Base>
)
export const IconInfo = (p: P) => (
  <Base {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.2v4M8 5.1v.01" />
  </Base>
)
export const IconWarning = (p: P) => (
  <Base {...p}>
    <path d="M8 2.5 14 13H2z" />
    <path d="M8 6.5v3M8 11.4v.01" />
  </Base>
)
export const IconLock = (p: P) => (
  <Base {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
    <path d="M5.8 7V5.2a2.2 2.2 0 0 1 4.4 0V7" />
  </Base>
)
export const IconMonitor = (p: P) => (
  <Base {...p}>
    <rect x="2" y="3" width="12" height="8" rx="1" />
    <path d="M6 13.5h4M8 11v2.5" />
  </Base>
)
export const IconPhone = (p: P) => (
  <Base {...p}>
    <rect x="4.5" y="2" width="7" height="12" rx="1.5" />
    <path d="M7 12.2h2" />
  </Base>
)
export const IconTablet = (p: P) => (
  <Base {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    <path d="M7.6 12h.8" />
  </Base>
)
export const IconPalette = (p: P) => (
  <Base {...p}>
    <path d="M8 1.8a6.2 6.2 0 0 0 0 12.4c.9 0 1.5-.7 1.5-1.5 0-.4-.15-.75-.4-1-.25-.27-.4-.6-.4-.98 0-.83.67-1.5 1.5-1.5h1.1c1.06 0 1.9-.85 1.9-1.9C13.2 4.3 10.9 1.8 8 1.8Z" />
    <circle cx="5.1" cy="7.6" r="0.9" />
    <circle cx="7" cy="4.7" r="0.9" />
    <circle cx="10.2" cy="4.9" r="0.9" />
  </Base>
)
export const IconSun = (p: P) => (
  <Base {...p}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.4v1.6M8 13v1.6M1.4 8H3M13 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
  </Base>
)
export const IconMoon = (p: P) => (
  <Base {...p}>
    <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" />
  </Base>
)
export const IconChevronDown = (p: P) => (
  <Base {...p}>
    <path d="M4 6.2 8 10.2l4-4" />
  </Base>
)
export const IconZoom = IconZoomIn

/* ------------ F-PM 项目管理相关图标 ------------ */

/** 星标（收藏）；filled=true 为实心 */
export const IconStar = ({ filled = false, ...p }: P & { filled?: boolean }) => (
  <Base {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="M8 2.2l1.75 3.55 3.92.57-2.84 2.76.67 3.9L8 11.14l-3.5 1.84.67-3.9L2.33 6.32l3.92-.57z" />
  </Base>
)

export const IconGrid = (p: P) => (
  <Base {...p}>
    <rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1" />
    <rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1" />
    <rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1" />
    <rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1" />
  </Base>
)

export const IconList = (p: P) => (
  <Base {...p}>
    <path d="M5.6 4h8M5.6 8h8M5.6 12h8M2.6 4h.01M2.6 8h.01M2.6 12h.01" />
  </Base>
)

export const IconTag = (p: P) => (
  <Base {...p}>
    <path d="M7.6 2.2H13v5.4l-5.5 5.5a1.4 1.4 0 0 1-2 0L2.2 9.8a1.4 1.4 0 0 1 0-2z" />
    <circle cx="10.4" cy="5.1" r="0.9" />
  </Base>
)

export const IconClock = (p: P) => (
  <Base {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.6V8l2.3 1.4" />
  </Base>
)

export const IconSearch = (p: P) => (
  <Base {...p}>
    <circle cx="7.2" cy="7.2" r="4.4" />
    <path d="M10.6 10.6 13.6 13.6" />
  </Base>
)

export const IconMore = (p: P) => (
  <Base {...p}>
    <circle cx="3.6" cy="8" r="1" fill="currentColor" />
    <circle cx="8" cy="8" r="1" fill="currentColor" />
    <circle cx="12.4" cy="8" r="1" fill="currentColor" />
  </Base>
)

export const IconWindow = (p: P) => (
  <Base {...p}>
    <rect x="2.2" y="3" width="11.6" height="10" rx="1.4" />
    <path d="M2.2 6h11.6M4.6 4.4h.01M6.4 4.4h.01" />
  </Base>
)

export const IconArchive = (p: P) => (
  <Base {...p}>
    <rect x="2.2" y="2.8" width="11.6" height="3.4" rx="1" />
    <path d="M3.4 6.2v6.4a1 1 0 0 0 1 1h7.2a1 1 0 0 0 1-1V6.2M6.6 9h2.8" />
  </Base>
)

export const IconHistory = (p: P) => (
  <Base {...p}>
    <path d="M2.6 8a5.4 5.4 0 1 0 1.7-3.9" />
    <path d="M2.4 2.6v2.6h2.6" />
    <path d="M8 5.4V8l2 1.4" />
  </Base>
)

/** 界面（屏幕）图标 —— 项目管理里表示"功能界面" */
export const IconScreen = (p: P) => (
  <Base {...p}>
    <rect x="2.6" y="2.4" width="10.8" height="11.2" rx="1.6" />
    <path d="M2.6 5.2h10.8" />
    <circle cx="5" cy="3.8" r="0.5" fill="currentColor" />
  </Base>
)

export const IconGroup = (p: P) => (
  <Base {...p}>
    <path d="M2.4 6.4 8 3.2l5.6 3.2L8 9.6z" />
    <path d="M2.4 9.6 8 12.8l5.6-3.2" />
  </Base>
)

export const IconBranch = (p: P) => (
  <Base {...p}>
    <circle cx="4.4" cy="3.6" r="1.6" />
    <circle cx="4.4" cy="12.4" r="1.6" />
    <circle cx="11.6" cy="8" r="1.6" />
    <path d="M4.4 5.2v5.6M6 8h4" />
  </Base>
)

