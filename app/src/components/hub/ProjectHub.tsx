// src/components/hub/ProjectHub.tsx —— 项目中心（F-PM-01/02/03）
//
// 定位：启动默认页 + 全局项目导航中枢。
// 数据来自 workspace.store（项目列表 + 组织元数据），本组件不直接读文件系统。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectMeta } from '@shared/design'
import { Button } from '@/components/ui/Button'
import {
  IconArchive,
  IconClock,
  IconClose,
  IconCopy,
  IconExport,
  IconFolder,
  IconGrid,
  IconGroup,
  IconHistory,
  IconList,
  IconMore,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconStar,
  IconScreen,
  IconTag,
  IconTrash,
  IconWindow,
} from '@/components/ui/Icons'
import { useWorkspaceStore, type HubSort, type HubView } from '@/stores/workspace.store'
import { useUiStore } from '@/stores/ui.store'
import { formatTime } from '@/lib/format'
import { APP_VERSION } from '@shared/version'
import {
  deleteProject,
  duplicateProject,
  forgetProject,
  importProjectFromDialog,
  lastProjectPath,
  moveToGroup,
  openProjectFromHub,
  openProjectInNewWindow,
  revealProject,
  setArchived,
  setProjectTags,
  toggleFavorite,
  togglePinned,
} from '@/services/project/hub-actions'
import { loadThumbnail } from '@/services/project/thumbnail'

const DEVICE_LABEL: Record<string, string> = {
  MOBILE: '移动端',
  TABLET: '平板',
  DESKTOP: '桌面端',
  RESPONSIVE: '响应式',
}

export function ProjectHub() {
  const store = useWorkspaceStore()
  const { projects, workspace, loading, loaded, defaultDir, query, sort, view, filter } = store
  const openOverlay = useUiStore((s) => s.openOverlay)
  const toast = useUiStore((s) => s.toast)

  const [menu, setMenu] = useState<{ x: number; y: number; meta: ProjectMeta } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  useEffect(() => {
    if (!loaded) void store.load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const visible = useMemo(
    () => store.visible(),
    // store.visible 读的是 store 内部状态，依赖这些字段即可重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, query, sort, filter, workspace],
  )

  const stats = useMemo(() => {
    const totalInterfaces = projects.reduce((s, p) => s + p.pageCount, 0)
    return {
      projects: projects.length,
      groups: workspace.groups.length,
      favorites: projects.filter((p) => p.workspace?.favorite).length,
      totalInterfaces,
    }
  }, [projects, workspace.groups.length])

  const continuePath = lastProjectPath()
  const continueMeta = continuePath
    ? projects.find((p) => p.path === continuePath) ?? null
    : null

  const onOpen = async (meta: ProjectMeta) => {
    if (meta.path && meta.path !== continuePath) {
      /* 正常打开 */
    }
    await openProjectFromHub(meta)
  }

  return (
    <div className="hub">
      {/* ------------------------------ 顶栏 ------------------------------ */}
      <header className="hub-top">
        <div className="brand" title={`望舒 · 本地 AI 设计工具 v${APP_VERSION}`}>
          <span className="brand-mark">望</span>
          <span className="hub-brand-text">
            望舒
            <em>v{APP_VERSION}</em>
          </span>
        </div>

        <div className="sep" />

        <Button variant="primary" size="sm" onClick={() => openOverlay('create-project')}>
          <IconPlus size={13} /> 新建项目
        </Button>
        <Button variant="ghost" size="sm" onClick={() => openOverlay('create-project')} title="AI 生成项目">
          <IconSparkles size={13} /> AI 生成
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void importProjectFromDialog()} title="打开本地 .dsproj">
          <IconFolder size={13} /> 打开文件
        </Button>

        <div className="hub-search">
          <IconSearch size={13} />
          <input
            className="input hub-search-input"
            placeholder="搜索项目名或路径…"
            value={query}
            onChange={(e) => store.setQuery(e.target.value)}
          />
          {query && (
            <button className="hub-search-clear" onClick={() => store.setQuery('')} aria-label="清空">
              <IconClose size={12} />
            </button>
          )}
        </div>

        <div className="flex-1" />

        <select
          className="input hub-sort"
          value={sort}
          onChange={(e) => store.setSort(e.target.value as HubSort)}
          title="排序方式"
        >
          <option value="updated">最近修改</option>
          <option value="created">创建时间</option>
          <option value="name">名称</option>
          <option value="interfaces">界面数</option>
        </select>

        <div className="hub-viewtoggle">
          <button
            className={view === 'grid' ? 'active' : ''}
            onClick={() => store.setView('grid' as HubView)}
            title="网格视图"
          >
            <IconGrid size={14} />
          </button>
          <button
            className={view === 'list' ? 'active' : ''}
            onClick={() => store.setView('list' as HubView)}
            title="列表视图"
          >
            <IconList size={14} />
          </button>
        </div>

        <Button variant="ghost" size="sm" iconOnly onClick={() => void store.load()} title="刷新列表">
          <IconHistory size={14} />
        </Button>
        <Button variant="ghost" size="sm" iconOnly onClick={() => openOverlay('settings')} title="设置">
          <IconSettings size={14} />
        </Button>
      </header>

      <div className="hub-body">
        {/* ------------------------------ 侧栏 ------------------------------ */}
        <aside className="hub-side">
          <div className="hub-side-section">
            <div className="hub-side-title">视图</div>
            <SideItem
              active={filter === 'all'}
              icon={<IconFolder size={13} />}
              label="全部项目"
              count={projects.filter((p) => !p.workspace?.archived).length}
              onClick={() => store.setFilter('all')}
            />
            <SideItem
              active={filter === 'favorite'}
              icon={<IconStar size={13} />}
              label="收藏"
              count={projects.filter((p) => p.workspace?.favorite).length}
              onClick={() => store.setFilter('favorite')}
            />
            <SideItem
              active={filter === 'recent'}
              icon={<IconClock size={13} />}
              label="最近打开"
              count={projects.filter((p) => p.workspace?.lastOpenedAt).length}
              onClick={() => store.setFilter('recent')}
            />
            <SideItem
              active={filter === 'archived'}
              icon={<IconArchive size={13} />}
              label="已归档"
              count={projects.filter((p) => p.workspace?.archived).length}
              onClick={() => store.setFilter('archived')}
            />
          </div>

          <div className="hub-side-section">
            <div className="hub-side-title">
              分组
              <button
                className="hub-side-add"
                title="新建分组"
                onClick={() => {
                  const name = window.prompt('新分组名称')
                  if (name?.trim()) void store.addGroup(name.trim())
                }}
              >
                <IconPlus size={11} />
              </button>
            </div>
            {workspace.groups.length === 0 && <div className="hub-side-empty">暂无分组</div>}
            {[...workspace.groups]
              .sort((a, b) => a.order - b.order)
              .map((g) => (
                <SideItem
                  key={g.id}
                  active={filter === g.id}
                  icon={<span className="hub-dot" style={{ background: g.color ?? 'var(--brand)' }} />}
                  label={g.name}
                  count={projects.filter((p) => p.workspace?.groupId === g.id).length}
                  onClick={() => store.setFilter(g.id)}
                  onRemove={async () => {
                    if (window.confirm(`删除分组「${g.name}」？组内项目会回到「未分组」，文件不受影响。`)) {
                      await store.removeGroup(g.id)
                    }
                  }}
                />
              ))}
          </div>

          {workspace.tags.length > 0 && (
            <div className="hub-side-section">
              <div className="hub-side-title">标签</div>
              <div className="hub-tags">
                {workspace.tags.map((t) => (
                  <button
                    key={t}
                    className={`hub-tag ${filter === `tag:${t}` ? 'active' : ''}`}
                    onClick={() => store.setFilter(filter === `tag:${t}` ? 'all' : `tag:${t}`)}
                  >
                    <IconTag size={11} /> {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex-1" />
          <div className="hub-side-foot" title={defaultDir}>
            <div>项目目录</div>
            <div className="path">{defaultDir || '（桌面客户端中可用）'}</div>
          </div>
        </aside>

        {/* ------------------------------ 主区 ------------------------------ */}
        <main className="hub-main">
          {/* 继续上次编辑 */}
          {continueMeta && filter === 'all' && !query && (
            <div className="hub-continue">
              <div className="hub-continue-info">
                <div className="k">继续上次编辑</div>
                <div className="n">{continueMeta.name}</div>
                <div className="m">
                  {continueMeta.pageCount} 个界面 · {DEVICE_LABEL[continueMeta.device] ?? continueMeta.device} ·{' '}
                  {formatTime(continueMeta.updatedAt)}
                </div>
              </div>
              <Button variant="primary" size="sm" onClick={() => void onOpen(continueMeta)}>
                打开
              </Button>
            </div>
          )}

          {loading && !loaded && <div className="hub-hint">正在读取项目列表…</div>}

          {loaded && visible.length === 0 && (
            <div className="hub-empty">
              <div className="hub-empty-mark">
                <IconScreen size={30} />
              </div>
              <div className="hub-empty-title">
                {projects.length === 0 ? '还没有任何项目' : '没有匹配的项目'}
              </div>
              <div className="hub-empty-desc">
                {projects.length === 0
                  ? '新建一个项目，或用模板 / 导入快速开始。所有数据都保存在你自己的电脑上。'
                  : '换一个关键词，或切换左侧的筛选条件试试。'}
              </div>
              {projects.length === 0 && (
                <Button variant="primary" onClick={() => openOverlay('create-project')}>
                  <IconPlus size={13} /> 新建项目
                </Button>
              )}
            </div>
          )}

          {view === 'grid' ? (
            <div className="hub-grid">
              {visible.map((m) => (
                <GridCard
                  key={m.id}
                  meta={m}
                  renaming={renamingId === m.id}
                  renameDraft={renameDraft}
                  setRenameDraft={setRenameDraft}
                  onRenameCommit={async () => {
                    const v = renameDraft.trim()
                    setRenamingId(null)
                    if (v && v !== m.name) await store.patchEntry(m.id, { name: v })
                  }}
                  onRenameCancel={() => setRenamingId(null)}
                  onOpen={() => void onOpen(m)}
                  onMenu={(e) => {
                    e.preventDefault()
                    setMenu({ x: e.clientX, y: e.clientY, meta: m })
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="hub-listview">
              <div className="hub-list-head">
                <span className="c-name">名称</span>
                <span className="c-num">界面</span>
                <span className="c-dev">设备</span>
                <span className="c-time">最近修改</span>
                <span className="c-op" />
              </div>
              {visible.map((m) => (
                <div
                  key={m.id}
                  className="hub-list-row"
                  onDoubleClick={() => void onOpen(m)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ x: e.clientX, y: e.clientY, meta: m })
                  }}
                >
                  <span className="c-name">
                    {m.workspace?.favorite && <IconStar size={11} filled />}
                    {m.workspace?.pinned && <span className="hub-pin">置顶</span>}
                    <button className="hub-link" onClick={() => void onOpen(m)}>
                      {m.name}
                    </button>
                    {!m.path && <span className="hub-badge-missing">已失效</span>}
                    {(m.workspace?.tags ?? []).map((t) => (
                      <span key={t} className="hub-minitag">
                        {t}
                      </span>
                    ))}
                  </span>
                  <span className="c-num">{m.pageCount}</span>
                  <span className="c-dev">{DEVICE_LABEL[m.device] ?? m.device}</span>
                  <span className="c-time">{formatTime(m.updatedAt)}</span>
                  <span className="c-op">
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenu({ x: e.clientX, y: e.clientY, meta: m })
                      }}
                    >
                      <IconMore size={14} />
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* ------------------------------ 底栏 ------------------------------ */}
      <footer className="hub-foot">
        <span>
          共 <b>{stats.projects}</b> 个项目 · <b>{stats.totalInterfaces}</b> 个界面 · {stats.groups} 个分组 ·{' '}
          {stats.favorites} 个收藏
        </span>
        <div className="flex-1" />
        <span className="dim">提示：右键项目卡片可重命名 / 复制 / 归档 / 删除</span>
      </footer>

      {/* ------------------------------ 右键菜单 ------------------------------ */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          meta={menu.meta}
          onClose={() => setMenu(null)}
          onRename={() => {
            setRenameDraft(menu.meta.name)
            setRenamingId(menu.meta.id)
            setMenu(null)
          }}
          onOpenNewWindow={async () => {
            if (menu.meta.path) await openProjectInNewWindow(menu.meta.path)
            else toast('warn', '该项目尚未保存到磁盘')
          }}
          groups={workspace.groups}
        />
      )}
    </div>
  )
}

/* --------------------------------- 子组件 --------------------------------- */

function SideItem({
  active,
  icon,
  label,
  count,
  onClick,
  onRemove,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  count: number
  onClick: () => void
  onRemove?: () => void
}) {
  return (
    <div className={`hub-side-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="hub-side-icon">{icon}</span>
      <span className="hub-side-label">{label}</span>
      {onRemove && (
        <button
          className="hub-side-remove"
          title="删除分组"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <IconClose size={10} />
        </button>
      )}
      <span className="hub-side-count">{count}</span>
    </div>
  )
}

/** 缩略图懒加载：只在卡片进入视图后请求一次，避免一次读几十张 PNG */
function Thumb({ projectId, has }: { projectId: string; has: boolean }) {
  const [src, setSrc] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || shown) return
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin: '120px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shown])

  useEffect(() => {
    if (!shown || !has) return
    let alive = true
    void loadThumbnail(projectId).then((d) => {
      if (alive) setSrc(d)
    })
    return () => {
      alive = false
    }
  }, [shown, has, projectId])

  return (
    <div className="hub-thumb" ref={ref}>
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <div className="hub-thumb-placeholder">
          <IconScreen size={20} />
          <span>{has ? '' : '暂无预览'}</span>
        </div>
      )}
    </div>
  )
}

function GridCard({
  meta,
  renaming,
  renameDraft,
  setRenameDraft,
  onRenameCommit,
  onRenameCancel,
  onOpen,
  onMenu,
}: {
  meta: ProjectMeta
  renaming: boolean
  renameDraft: string
  setRenameDraft: (v: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  onOpen: () => void
  onMenu: (e: React.MouseEvent) => void
}) {
  const ws = meta.workspace
  return (
    <div
      className={`hub-card ${ws?.pinned ? 'pinned' : ''} ${meta.path ? '' : 'missing'}`}
      onDoubleClick={onOpen}
      onContextMenu={onMenu}
      title={meta.path || '尚未保存到磁盘'}
    >
      <Thumb projectId={meta.id} has={!!meta.thumbnail} />

      <div className="hub-card-body">
        {renaming ? (
          <input
            className="input"
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameCommit()
              if (e.key === 'Escape') onRenameCancel()
              e.stopPropagation()
            }}
          />
        ) : (
          <button className="hub-card-name" onClick={onOpen} title={meta.name}>
            {meta.name}
          </button>
        )}

        <div className="hub-card-meta">
          <span className="chip-mini">
            <IconScreen size={10} /> {meta.pageCount} 个界面
          </span>
          <span className="chip-mini">{DEVICE_LABEL[meta.device] ?? meta.device}</span>
          {!meta.path && <span className="chip-mini danger">已失效</span>}
        </div>

        {(ws?.tags?.length ?? 0) > 0 && (
          <div className="hub-card-tags">
            {ws!.tags!.map((t) => (
              <span key={t} className="hub-minitag">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="hub-card-foot">
        <span className="t">{formatTime(meta.updatedAt)}</span>
        <div className="flex-1" />
        <button
          className={`hub-icon-btn ${ws?.favorite ? 'on' : ''}`}
          title={ws?.favorite ? '取消收藏' : '收藏'}
          onClick={(e) => {
            e.stopPropagation()
            void toggleFavorite(meta)
          }}
        >
          <IconStar size={13} filled={!!ws?.favorite} />
        </button>
        <button
          className={`hub-icon-btn ${ws?.pinned ? 'on' : ''}`}
          title={ws?.pinned ? '取消置顶' : '置顶'}
          onClick={(e) => {
            e.stopPropagation()
            void togglePinned(meta)
          }}
        >
          <IconGroup size={13} />
        </button>
        <button
          className="hub-icon-btn"
          title="更多操作"
          onClick={(e) => {
            e.stopPropagation()
            onMenu(e)
          }}
        >
          <IconMore size={13} />
        </button>
      </div>
    </div>
  )
}

function ContextMenu({
  x,
  y,
  meta,
  onClose,
  onRename,
  onOpenNewWindow,
  groups,
}: {
  x: number
  y: number
  meta: ProjectMeta
  onClose: () => void
  onRename: () => void
  onOpenNewWindow: () => void
  groups: Array<{ id: string; name: string }>
}) {
  const [subGroup, setSubGroup] = useState(false)
  const ws = meta.workspace
  const item = (label: string, icon: React.ReactNode, action: () => void, danger = false, disabled = false) => (
    <button
      className={`hub-menu-item ${danger ? 'danger' : ''}`}
      disabled={disabled}
      onClick={() => {
        if (disabled) return
        action()
        onClose()
      }}
    >
      <span className="ic">{icon}</span>
      {label}
    </button>
  )

  // 防止菜单溢出视口
  const style: React.CSSProperties = {
    left: Math.min(x, Math.max(8, window.innerWidth - 240)),
    top: Math.min(y, Math.max(8, window.innerHeight - 420)),
  }

  return (
    <div className="hub-menu" style={style} onClick={(e) => e.stopPropagation()}>
      {item('打开', <IconFolder size={13} />, () => void openProjectFromHub(meta), false, !meta.path)}
      {item('在新窗口打开', <IconWindow size={13} />, () => void onOpenNewWindow(), false, !meta.path)}
      <div className="hub-menu-sep" />
      {item('重命名', <IconSparkles size={13} />, onRename)}
      {item('创建副本', <IconCopy size={13} />, () => void duplicateProject(meta), false, !meta.path)}
      {item(ws?.favorite ? '取消收藏' : '加入收藏', <IconStar size={13} />, () => void toggleFavorite(meta))}
      {item(ws?.pinned ? '取消置顶' : '置顶', <IconGroup size={13} />, () => void togglePinned(meta))}
      {item(ws?.archived ? '取消归档' : '归档', <IconArchive size={13} />, () => void setArchived(meta, !ws?.archived))}

      <div className="hub-menu-sep" />
      <div
        className="hub-menu-item has-sub"
        onMouseEnter={() => setSubGroup(true)}
        onMouseLeave={() => setSubGroup(false)}
      >
        <span className="ic">
          <IconGroup size={13} />
        </span>
        移入分组
        <span className="arrow">›</span>
        {subGroup && (
          <div className="hub-menu-sub">
            <button
              className="hub-menu-item"
              onClick={() => {
                void moveToGroup(meta, undefined)
                onClose()
              }}
            >
              未分组
            </button>
            {groups.map((g) => (
              <button
                key={g.id}
                className="hub-menu-item"
                onClick={() => {
                  void moveToGroup(meta, g.id)
                  onClose()
                }}
              >
                {g.name}
              </button>
            ))}
            {groups.length === 0 && (
              <button className="hub-menu-item" disabled>
                （左侧可新建分组）
              </button>
            )}
          </div>
        )}
      </div>

      {item('编辑标签…', <IconTag size={13} />, () => {
        const cur = (ws?.tags ?? []).join(', ')
        const next = window.prompt('标签（用逗号分隔）', cur)
        if (next === null) return
        void setProjectTags(meta, next.split(/[,，]/))
      })}

      <div className="hub-menu-sep" />
      {item('在文件夹中显示', <IconFolder size={13} />, () => void revealProject(meta.path), false, !meta.path)}
      {item('导出…', <IconExport size={13} />, () => {
        void openProjectFromHub(meta).then(() => useUiStore.getState().openOverlay('export'))
      }, false, !meta.path)}
      {item('项目设置…', <IconSettings size={13} />, () => {
        void openProjectFromHub(meta).then(() => useUiStore.getState().openOverlay('project-settings'))
      }, false, !meta.path)}

      <div className="hub-menu-sep" />
      {item('从列表移除', <IconClose size={13} />, () => void forgetProject(meta))}
      {item('删除项目…', <IconTrash size={13} />, () => void deleteProject(meta), true)}
    </div>
  )
}
