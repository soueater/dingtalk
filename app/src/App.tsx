// src/App.tsx —— 应用外壳：路由分流（项目中心 / 编辑器）+ 各类浮层
//
// 两个「路由」：
//   hub    —— 项目中心（F-PM-01/02），启动默认落地页
//   editor —— 既有三段式编辑器
// 两者共享同一套浮层（新建项目 / 项目设置 / 应用设置 / 导出 / 预览 …），
// 这样从项目中心就能直接「新建项目」或「导出」，不必先切进编辑器。
import { useEffect } from 'react'
import { Titlebar } from '@/components/layout/Titlebar'
import { LeftPanel } from '@/components/layout/LeftPanel'
import { RightPanel } from '@/components/layout/RightPanel'
import { Statusbar } from '@/components/layout/Statusbar'
import { Canvas } from '@/components/canvas/Canvas'
import { ProjectHub } from '@/components/hub/ProjectHub'
import { CreateProjectModal } from '@/components/hub/CreateProjectModal'
import { ProjectSettingsModal } from '@/components/hub/ProjectSettingsModal'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { PreviewModal } from '@/components/overlays/PreviewModal'
import { ExportModal } from '@/components/overlays/ExportModal'
import { VariantModal } from '@/components/overlays/VariantModal'
import { OptimizeModal } from '@/components/overlays/OptimizeModal'
import { AutofillModal } from '@/components/overlays/AutofillModal'
import { BranchesModal } from '@/components/overlays/BranchesModal'
import { HelpModal } from '@/components/overlays/HelpModal'
import { ToastHost } from '@/components/overlays/ToastHost'
import { useUiStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { useKeyboard } from '@/hooks/useKeyboard'
import { useAutoSave } from '@/hooks/useAutoSave'
import { bootstrapApp } from '@/services/project/bootstrap'
import { newProject, openProject, saveProject, saveProjectAs } from '@/services/project/actions'
import { importProjectFromDialog, goHub } from '@/services/project/hub-actions'
import { installCloseGuard } from '@/services/project/close-guard'

import './styles/tokens.css'
import './styles/global.css'
import './styles/layout.css'
import './styles/controls.css'
import './styles/overlay.css'
import './styles/panels.css'
import './styles/canvas.css'
import './styles/hub.css'
import './styles/a11y.css'

export default function App() {
  const openOverlay = useUiStore((s) => s.openOverlay)
  const route = useUiStore((s) => s.route)

  useKeyboard()
  /* 自动保存只在编辑器里跑：项目中心没有可变设计数据 */
  useAutoSave(route === 'editor')

  useEffect(() => {
    void bootstrapApp()
  }, [])

  /* 主进程菜单 → 渲染层动作（两个路由下的语义略有差异） */
  useEffect(() => {
    if (!window.dsa) return
    const onMenu = (action: string) => {
      const inHub = useUiStore.getState().route === 'hub'
      switch (action) {
        case 'new-project':
          /* 项目中心里"新建"应走向导，而不是直接盖掉当前状态 */
          if (inHub) openOverlay('create-project')
          else void newProject()
          break
        case 'open-project':
          if (inHub) void importProjectFromDialog()
          else void openProject()
          break
        case 'save':
          if (!inHub) void saveProject()
          break
        case 'save-as':
          if (!inHub) void saveProjectAs()
          break
        case 'project-settings':
          if (!inHub) openOverlay('project-settings')
          break
        case 'project-hub':
          void goHub()
          break
        case 'export':
          if (!inHub) openOverlay('export')
          break
        case 'undo':
          if (!inHub) useProjectStore.getState().undo()
          break
        case 'redo':
          if (!inHub) useProjectStore.getState().redo()
          break
        case 'zoom-fit':
          window.dispatchEvent(new CustomEvent('app:zoom-fit'))
          break
        case 'zoom-100':
          window.dispatchEvent(new CustomEvent('app:zoom-100'))
          break
        case 'settings':
          openOverlay('settings')
          break
        case 'help':
          openOverlay('help')
          break
      }
    }
    // preload 未暴露 onMenuAction 时静默跳过
    const api = window.dsa as unknown as { app?: { onMenuAction?: (cb: (a: string) => void) => () => void } }
    return api.app?.onMenuAction?.(onMenu)
  }, [openOverlay])

  /**
   * 关闭流程。
   * 桌面客户端：决策权在主进程（原生三选项对话框），本处只负责同步 dirty 与按需保存。
   * 浏览器调试环境：退回 beforeunload 兜底，不会出现「窗口关不掉」。
   */
  useEffect(() => installCloseGuard(), [])

  return (
    <>
      {route === 'hub' ? (
        <ProjectHub />
      ) : (
        <div className="app-shell">
          <Titlebar />
          <div className="workspace">
            <LeftPanel />
            <Canvas />
            <RightPanel />
          </div>
          <Statusbar />
        </div>
      )}

      {/* 浮层在两个路由下都可用 */}
      <CreateProjectModal />
      <ProjectSettingsModal />
      <SettingsModal />
      <ExportModal />
      <PreviewModal />
      <VariantModal />
      <OptimizeModal />
      <AutofillModal />
      <BranchesModal />
      <HelpModal />
      <ToastHost />
    </>
  )
}
