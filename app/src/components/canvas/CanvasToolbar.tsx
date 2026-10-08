// src/components/canvas/CanvasToolbar.tsx
import { Button } from '@/components/ui/Button'
import {
  IconZoomIn,
  IconZoomOut,
  IconFit,
  IconPlay,
  IconMonitor,
  IconPhone,
  IconSparkles,
  IconWand,
  IconLayers,
  IconGroup,
  IconBranch,
  IconScreen,
  IconGrid,
} from '@/components/ui/Icons'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'
import { DEVICE_CANVAS } from '@/services/design/style-presets'
import type { Device } from '@shared/design'

interface Props {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onFit: () => void
  /* F-PM-09 画布增强 */
  showGroups: boolean
  showFlows: boolean
  showMiniMap: boolean
  onToggleGroups: () => void
  onToggleFlows: () => void
  onToggleMiniMap: () => void
  onTidy: () => void
  pageCount: number
}

export function CanvasToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFit,
  showGroups,
  showFlows,
  showMiniMap,
  onToggleGroups,
  onToggleFlows,
  onToggleMiniMap,
  onTidy,
  pageCount,
}: Props) {
  const device = useProjectStore((s) => s.design.meta.device)
  const commit = useProjectStore((s) => s.commit)
  const openOverlay = useUiStore((s) => s.openOverlay)

  const setDevice = (d: Device) => {
    const c = DEVICE_CANVAS[d]
    if (!c) return
    commit('切换设备', (dd) => {
      dd.meta.device = d
      dd.meta.canvas = { width: c.width, height: c.height }
      return dd
    })
  }

  const devices: Array<{ id: Device; icon: typeof IconPhone; title: string }> = [
    { id: 'MOBILE', icon: IconPhone, title: DEVICE_CANVAS.MOBILE.label },
    { id: 'TABLET', icon: IconMonitor, title: DEVICE_CANVAS.TABLET.label },
    { id: 'DESKTOP', icon: IconMonitor, title: DEVICE_CANVAS.DESKTOP.label },
  ]

  return (
    <div className="canvas-toolbar">
      <div className="segmented">
        {devices.map(({ id, icon: Icon, title }) => (
          <button
            key={id}
            className={device === id ? 'active' : ''}
            title={title}
            onClick={() => setDevice(id)}
          >
            <Icon size={12} />
          </button>
        ))}
      </div>

      <div className="sep" style={{ width: 1, height: 16, background: 'var(--border)' }} />

      <Button variant="ghost" size="sm" iconOnly onClick={onZoomOut} title="缩小 (Ctrl+-)">
        <IconZoomOut size={13} />
      </Button>
      <button
        className="zoom-label"
        onClick={onZoomReset}
        title="重置为 100%"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
      >
        {Math.round(zoom * 100)}%
      </button>
      <Button variant="ghost" size="sm" iconOnly onClick={onZoomIn} title="放大 (Ctrl++)">
        <IconZoomIn size={13} />
      </Button>
      <Button variant="ghost" size="sm" iconOnly onClick={onFit} title="适应窗口 (Ctrl+1)">
        <IconFit size={13} />
      </Button>

      <div className="sep" style={{ width: 1, height: 16, background: 'var(--border)' }} />

      {/* F-PM-09 画布视图开关 */}
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        onClick={onTidy}
        title="一键排布：把同一分组的界面归拢到一起 (Ctrl+Shift+L)"
        disabled={pageCount <= 1}
      >
        <IconGrid size={13} />
      </Button>
      <button
        className={`cv-toggle ${showGroups ? 'on' : ''}`}
        onClick={onToggleGroups}
        title="显示 / 隐藏分组外框 (Ctrl+Shift+G)"
      >
        <IconGroup size={12} /> 分组
      </button>
      <button
        className={`cv-toggle ${showFlows ? 'on' : ''}`}
        onClick={onToggleFlows}
        title="显示 / 隐藏界面跳转连线 (Ctrl+Shift+F)"
      >
        <IconBranch size={12} /> 流程
      </button>
      <button
        className={`cv-toggle ${showMiniMap ? 'on' : ''}`}
        onClick={onToggleMiniMap}
        title="显示 / 隐藏缩略导航图"
      >
        <IconScreen size={12} /> 导航
      </button>

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="sm"
        onClick={() => openOverlay('variants')}
        title="为当前页面生成多个差异化设计方案"
      >
        <IconSparkles size={12} /> 变体
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => openOverlay('optimize')}
        title="AI 优化当前页面：层次、间距、一致性与规范符合度"
      >
        <IconWand size={12} /> 优化
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => openOverlay('autofill')}
        title="自动补全：检出缺失页面、补齐交互状态与页面跳转"
      >
        <IconLayers size={12} /> 补全
      </Button>
      <Button variant="ghost" size="sm" onClick={() => openOverlay('preview')} title="进入预览模式">
        <IconPlay size={12} /> 预览
      </Button>
    </div>
  )
}
