// src/components/panels/PageList.tsx —— 界面列表（F-PM-04/05）
//
// 相比旧版「页面列表」的变化：
//   1. 按 PageGroup 分桶展示，分组可折叠、可改名、可删除；
//   2. 所有增删都走 store 的界面动作，配额判定与不变量校验集中在 store 里；
//   3. 新增「界面数量 N」控制条（计划 / 软上限 / 硬上限 + 批量追加）；
//   4. 右键菜单提供移入分组、批量操作，避免为每个动作都放一个按钮。
import { useEffect, useMemo, useState } from 'react'
import type { Page, PageGroup } from '@shared/design'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'
import { Button } from '@/components/ui/Button'
import {
  IconPlus,
  IconTrash,
  IconCopy,
  IconMore,
  IconGroup,
  IconChevronDown,
  IconScreen,
} from '@/components/ui/Icons'
import type { GroupBucket } from '@/services/project/pages'
import { InterfaceCountControl } from './InterfaceCountControl'

export function PageList() {
  const design = useProjectStore((s) => s.design)
  const activePageId = useProjectStore((s) => s.activePageId)
  const setActivePage = useProjectStore((s) => s.setActivePage)
  const addInterfaces = useProjectStore((s) => s.addInterfaces)
  const copyInterface = useProjectStore((s) => s.copyInterface)
  const removeInterface = useProjectStore((s) => s.removeInterface)
  const renameInterface = useProjectStore((s) => s.renameInterface)
  const moveInterface = useProjectStore((s) => s.moveInterface)
  const addGroup = useProjectStore((s) => s.addGroup)
  const renameGroup = useProjectStore((s) => s.renameGroup)
  const removeGroup = useProjectStore((s) => s.removeGroup)
  const setGroupCollapsed = useProjectStore((s) => s.setGroupCollapsed)
  const assignToGroup = useProjectStore((s) => s.assignToGroup)
  const toast = useUiStore((s) => s.toast)

  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; page: Page } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  const buckets: GroupBucket[] = useMemo(() => useProjectStore.getState().groupBuckets(), [design])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  /* 逐条命令式的提示：配额判定结果由 store 返回，这里只负责说给用户听 */
  const report = (r: { ok: boolean; message?: string }) => {
    if (r.ok) {
      if (r.message) toast('warn', r.message)
    } else {
      toast('error', r.message ?? '操作未被允许')
    }
  }

  const doCopy = (pageId: string) => report(copyInterface(pageId))

  const doDelete = (page: Page) => {
    if (design.pages.length <= 1) {
      toast('warn', '项目至少需要保留 1 个界面，无法删除。')
      return
    }
    if (!window.confirm(`确定删除界面「${page.name}」？该操作可以用 Ctrl+Z 撤销。`)) return
    report(removeInterface(page.id))
  }

  const startRename = (page: Page) => {
    setRenaming(page.id)
    setDraft(page.name)
  }

  const commitRename = (id: string) => {
    const v = draft.trim()
    if (v) renameInterface(id, v)
    setRenaming(null)
  }

  const newGroupFromSelection = () => {
    const ids = useProjectStore.getState().selectedIds.length
      ? undefined
      : [activePageId]
    const name = window.prompt('新分组名称')
    if (!name?.trim()) return
    addGroup(name.trim(), ids)
  }

  /** 拖拽排序：把 drag 界面移动到 target 界面的位置 */
  const onDropPage = (target: Page) => {
    if (!dragId || dragId === target.id) return
    const order = design.pages.map((p) => p.id)
    const to = order.indexOf(target.id)
    if (to >= 0) moveInterface(dragId, to)
    setDragId(null)
  }

  const total = design.pages.length

  return (
    <div className="pagelist">
      <div className="pagelist-toolbar">
        <span className="pl-total">
          <IconScreen size={11} /> 共 {total} 个界面
        </span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" iconOnly title="新建分组" onClick={newGroupFromSelection}>
          <IconGroup size={13} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          title="新增 1 个界面"
          onClick={() => report(addInterfaces(1))}
        >
          <IconPlus size={13} />
        </Button>
      </div>

      <div className="pagelist-body">
        {buckets.map((b) => (
          <GroupSection
            key={b.group?.id ?? '__ungrouped__'}
            bucket={b}
            activePageId={activePageId}
            renaming={renaming}
            draft={draft}
            setDraft={setDraft}
            onCommitRename={commitRename}
            onCancelRename={() => setRenaming(null)}
            onSelect={setActivePage}
            onStartRename={startRename}
            onCopy={doCopy}
            onDelete={doDelete}
            onMenu={(e, page) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, page })
            }}
            onToggleCollapse={(id, collapsed) => setGroupCollapsed(id, collapsed)}
            onRenameGroup={(g) => {
              const name = window.prompt('分组名称', g.name)
              if (name?.trim()) renameGroup(g.id, name.trim())
            }}
            onRemoveGroup={(g) => {
              if (window.confirm(`删除分组「${g.name}」？组内界面会回到「未分组」，界面本身不受影响。`)) {
                removeGroup(g.id)
              }
            }}
            onAddInGroup={(g) => report(addInterfaces(1, { groupId: g.id, namePrefix: g.name }))}
            dragId={dragId}
            onDragStart={setDragId}
            onDropPage={onDropPage}
          />
        ))}
      </div>

      <InterfaceCountControl />

      {menu && (
        <PageContextMenu
          x={menu.x}
          y={menu.y}
          page={menu.page}
          groups={design.pageGroups ?? []}
          onClose={() => setMenu(null)}
          onRename={() => {
            startRename(menu.page)
            setMenu(null)
          }}
          onCopy={() => {
            doCopy(menu.page.id)
            setMenu(null)
          }}
          onDelete={() => {
            setMenu(null)
            doDelete(menu.page)
          }}
          onAssign={(groupId) => {
            assignToGroup([menu.page.id], groupId)
            setMenu(null)
          }}
          onCreateGroup={() => {
            const name = window.prompt('新分组名称')
            if (name?.trim()) addGroup(name.trim(), [menu.page.id])
            setMenu(null)
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------ 分组区段 ------------------------------ */

function GroupSection({
  bucket,
  activePageId,
  renaming,
  draft,
  setDraft,
  onCommitRename,
  onCancelRename,
  onSelect,
  onStartRename,
  onCopy,
  onDelete,
  onMenu,
  onToggleCollapse,
  onRenameGroup,
  onRemoveGroup,
  onAddInGroup,
  dragId,
  onDragStart,
  onDropPage,
}: {
  bucket: GroupBucket
  activePageId: string
  renaming: string | null
  draft: string
  setDraft: (v: string) => void
  onCommitRename: (id: string) => void
  onCancelRename: () => void
  onSelect: (id: string) => void
  onStartRename: (p: Page) => void
  onCopy: (id: string) => void
  onDelete: (p: Page) => void
  onMenu: (e: React.MouseEvent, p: Page) => void
  onToggleCollapse: (id: string, collapsed: boolean) => void
  onRenameGroup: (g: PageGroup) => void
  onRemoveGroup: (g: PageGroup) => void
  onAddInGroup: (g: PageGroup) => void
  dragId: string | null
  onDragStart: (id: string | null) => void
  onDropPage: (p: Page) => void
}) {
  const g = bucket.group
  const collapsed = !!g?.collapsed
  const index = useMemo(() => {
    const order = bucket.pages.map((p) => p.id)
    return (id: string) => order.indexOf(id) + 1
  }, [bucket.pages])

  return (
    <section className="pl-group">
      <header
        className="pl-group-head"
        onDoubleClick={() => g && onRenameGroup(g)}
        title={g ? '双击重命名分组' : '未分组的界面'}
      >
        {g ? (
          <button
            className={`pl-caret ${collapsed ? 'closed' : ''}`}
            onClick={() => onToggleCollapse(g.id, !collapsed)}
            title={collapsed ? '展开' : '折叠'}
          >
            <IconChevronDown size={11} />
          </button>
        ) : (
          <span className="pl-caret-placeholder" />
        )}
        <span
          className="pl-group-dot"
          style={{ background: g?.color ?? 'var(--text-3)' }}
        />
        <span className="pl-group-name">{g?.name ?? '未分组'}</span>
        <span className="pl-group-count">{bucket.pages.length}</span>
        <div className="flex-1" />
        {g && (
          <>
            <button
              className="pl-group-btn"
              title="在此分组新增界面"
              onClick={(e) => {
                e.stopPropagation()
                onAddInGroup(g)
              }}
            >
              <IconPlus size={11} />
            </button>
            <button
              className="pl-group-btn"
              title="删除分组"
              onClick={(e) => {
                e.stopPropagation()
                onRemoveGroup(g)
              }}
            >
              <IconTrash size={11} />
            </button>
          </>
        )}
      </header>

      {!collapsed && (
        <div className="pl-items">
          {bucket.pages.map((p) => (
            <div
              key={p.id}
              className={`list-item ${p.id === activePageId ? 'selected' : ''} ${
                dragId === p.id ? 'dragging' : ''
              }`}
              draggable
              onDragStart={() => onDragStart(p.id)}
              onDragEnd={() => onDragStart(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDropPage(p)}
              onClick={() => onSelect(p.id)}
              onDoubleClick={() => onStartRename(p)}
              onContextMenu={(e) => onMenu(e, p)}
            >
              <span className="pl-idx">{index(p.id)}</span>
              <div className="flex-1" style={{ minWidth: 0 }}>
                {renaming === p.id ? (
                  <input
                    className="input"
                    autoFocus
                    style={{ height: 22, fontSize: 11 }}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => onCommitRename(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') onCancelRename()
                      e.stopPropagation()
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <div className="title">{p.name}</div>
                    <div className="sub">
                      {countNodes(p.root)} 个元素 ·{' '}
                      {useProjectStore.getState().design.flows.filter((f) => f.fromPage === p.id).length} 条跳转
                    </div>
                  </>
                )}
              </div>
              <div className="pl-item-ops">
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  title="复制界面"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCopy(p.id)
                  }}
                >
                  <IconCopy size={11} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  title="删除界面"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(p)
                  }}
                >
                  <IconTrash size={11} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  title="更多"
                  onClick={(e) => {
                    e.stopPropagation()
                    onMenu(e, p)
                  }}
                >
                  <IconMore size={11} />
                </Button>
              </div>
            </div>
          ))}
          {bucket.pages.length === 0 && <div className="pl-empty">该分组暂无界面</div>}
        </div>
      )}
    </section>
  )
}

/* ------------------------------ 右键菜单 ------------------------------ */

function PageContextMenu({
  x,
  y,
  page,
  groups,
  onClose,
  onRename,
  onCopy,
  onDelete,
  onAssign,
  onCreateGroup,
}: {
  x: number
  y: number
  page: Page
  groups: PageGroup[]
  onClose: () => void
  onRename: () => void
  onCopy: () => void
  onDelete: () => void
  onAssign: (groupId: string | undefined) => void
  onCreateGroup: () => void
}) {
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, Math.max(8, window.innerWidth - 220)),
    top: Math.min(y, Math.max(8, window.innerHeight - 300)),
    zIndex: 'var(--z-toast)',
  }
  const item = (label: string, action: () => void, danger = false) => (
    <button
      className={`hub-menu-item ${danger ? 'danger' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        action()
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="hub-menu" style={style} onClick={(e) => e.stopPropagation()}>
      <div className="hub-menu-head">{page.name}</div>
      {item('重命名', onRename)}
      {item('创建副本', onCopy)}
      <div className="hub-menu-sep" />
      <div className="hub-menu-label">移入分组</div>
      {item('未分组', () => onAssign(undefined))}
      {groups.map((g) => (
        <button
          key={g.id}
          className="hub-menu-item"
          onClick={(e) => {
            e.stopPropagation()
            onAssign(g.id)
          }}
        >
          <span className="hub-dot" style={{ background: g.color ?? 'var(--brand)' }} />
          {g.name}
        </button>
      ))}
      {item('新建分组并移入…', onCreateGroup)}
      <div className="hub-menu-sep" />
      {item('删除界面', onDelete, true)}
      <div className="hub-menu-sep" />
      <button className="hub-menu-item" onClick={onClose}>
        关闭
      </button>
    </div>
  )
}

function countNodes(node: import('@shared/design').Node): number {
  return 1 + (node.children?.reduce((sum, c) => sum + countNodes(c), 0) ?? 0)
}
