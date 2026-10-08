// src/components/layout/Titlebar.tsx
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import {
  IconPlus,
  IconFolder,
  IconSave,
  IconExport,
  IconSettings,
  IconUndo,
  IconRedo,
  IconEye,
  IconSparkles,
  IconGrid,
  IconChevronDown,
  IconSliders,
  IconBranch,
} from '@/components/ui/Icons'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'
import { useConfigStore } from '@/stores/config.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { configService } from '@/services/config'
import { openProject, newProject, saveProject, exportProject } from '@/services/project/actions'
import { goHub, openProjectFromHub, openProjectInNewWindow } from '@/services/project/hub-actions'
import { formatTime } from '@/lib/format'
import { ThemeMenu } from './ThemeMenu'

/* --------------------------- 项目切换器（F-PM-02） --------------------------- */
//
// 编辑器里不切回项目中心也能换项目：列出最近项目，双击/单击即切换。
// 数据复用 workspace.store（与项目中心同源），避免两处各维护一份列表。
function ProjectSwitcher() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const projects = useWorkspaceStore((s) => s.projects)
  const loaded = useWorkspaceStore((s) => s.loaded)
  const load = useWorkspaceStore((s) => s.load)
  const currentPath = useProjectStore((s) => s.path)

  useEffect(() => {
    if (open && !loaded) void load()
  }, [open, loaded, load])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const recent = [...projects]
    .filter((p) => !!p.path)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, 12)

  return (
    <div className="proj-switch" ref={ref}>
      <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} title="切换项目">
        <IconGrid size={13} /> 项目
        <IconChevronDown size={11} />
      </Button>
      {open && (
        <div className="proj-switch-menu">
          <div className="proj-switch-head">最近项目</div>
          {recent.length === 0 && <div className="proj-switch-empty">暂无其他项目</div>}
          {recent.map((p) => (
            <button
              key={p.id}
              className={`proj-switch-item ${p.path === currentPath ? 'active' : ''}`}
              onClick={() => {
                setOpen(false)
                if (p.path === currentPath) return
                void openProjectFromHub(p)
              }}
              title={p.path ?? ''}
            >
              <span className="n">{p.name}</span>
              <span className="m">
                {p.pageCount} 界面 · {formatTime(p.updatedAt)}
              </span>
            </button>
          ))}
          <div className="proj-switch-sep" />
          <button
            className="proj-switch-item"
            onClick={() => {
              setOpen(false)
              void goHub()
            }}
          >
            <span className="n">打开项目中心…</span>
          </button>
          <button
            className="proj-switch-item"
            onClick={() => {
              setOpen(false)
              if (currentPath) void openProjectInNewWindow(currentPath)
            }}
          >
            <span className="n">在新窗口打开当前项目</span>
          </button>
        </div>
      )}
    </div>
  )
}

export function Titlebar() {
  const { design, path, dirty, undo, redo, undoStack, redoStack, renameProject } = useProjectStore()
  const { openOverlay, toast } = useUiStore()
  const current = useConfigStore((s) => s.current)
  const loadConfig = useConfigStore((s) => s.load)

  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState(design.meta.name)
  const platform = typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent) ? 'win' : 'mac'

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  const cfg = current()

  return (
    <div className={`titlebar ${platform === 'win' ? 'platform-win' : ''}`}>
      <button
        className="brand brand-btn"
        title="返回项目中心"
        onClick={() => void goHub()}
      >
        <span className="brand-mark">望</span>
        望舒
      </button>
      <div className="sep" />

      <Button variant="ghost" size="sm" onClick={() => void goHub()} title="项目中心">
        <IconGrid size={13} /> 项目中心
      </Button>
      <ProjectSwitcher />

      <div className="sep" />

      <Button variant="ghost" size="sm" onClick={() => void newProject()} title="新建项目 (Ctrl+N)">
        <IconPlus size={13} /> 新建
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void openProject()} title="打开项目 (Ctrl+O)">
        <IconFolder size={13} /> 打开
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={!dirty && !!path}
        onClick={() => void saveProject()}
        title="保存 (Ctrl+S)"
      >
        <IconSave size={13} /> 保存
      </Button>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        onClick={() => openOverlay('project-settings')}
        title="项目设置"
      >
        <IconSliders size={14} />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        onClick={() => openOverlay('project-branches')}
        title="方案分支（F-PM-07）"
      >
        <IconBranch size={14} />
      </Button>

      <div className="sep" />

      <Button variant="ghost" size="sm" iconOnly disabled={!undoStack.length} onClick={undo} title="撤销 (Ctrl+Z)">
        <IconUndo size={13} />
      </Button>
      <Button variant="ghost" size="sm" iconOnly disabled={!redoStack.length} onClick={redo} title="重做 (Ctrl+Shift+Z)">
        <IconRedo size={13} />
      </Button>

      <div className="sep" />

      {editing ? (
        <input
          className="input"
          autoFocus
          style={{ width: 220, height: 26 }}
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            const v = nameDraft.trim()
            if (v && v !== design.meta.name) renameProject(v)
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setNameDraft(design.meta.name)
              setEditing(false)
            }
          }}
        />
      ) : (
        <button
          className="proj-name-btn"
          onClick={() => {
            setNameDraft(design.meta.name)
            setEditing(true)
          }}
          title={path ?? '尚未保存到磁盘'}
        >
          <span className={`dirty-dot ${dirty ? '' : 'saved'}`} />
          <span className="name">{design.meta.name}</span>
        </button>
      )}

      <div className="flex-1" />

      <button
        className="proj-name-btn"
        onClick={() => openOverlay('settings')}
        title="模型配置 (Ctrl+,)"
        style={{ maxWidth: 200 }}
      >
        <span className={`dirty-dot ${cfg ? 'saved' : ''}`} style={cfg ? { background: 'var(--success)' } : { background: 'var(--warning)' }} />
        <span className="name">
          <IconSparkles size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
          {cfg ? `${cfg.name}` : '未配置模型'}
        </span>
      </button>

      <Button variant="ghost" size="sm" iconOnly onClick={() => openOverlay('preview')} title="预览 (空格长按/F5)">
        <IconEye size={14} />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void exportProject()}
        title="导出 (Ctrl+E)"
      >
        <IconExport size={13} /> 导出
      </Button>
      <ThemeMenu />
      <Button variant="ghost" size="sm" iconOnly onClick={() => openOverlay('settings')} title="设置">
        <IconSettings size={14} />
      </Button>
    </div>
  )
}
