// src/components/panels/LayerTree.tsx —— 图层树（可选中 / 显隐 / 锁定 / 拖拽排序）
import { useState } from 'react'
import type { Node } from '@shared/design'
import { useProjectStore } from '@/stores/project.store'
import { IconEye, IconLayers } from '@/components/ui/Icons'
import { patchNode } from '@/components/canvas/Canvas'

const TYPE_LABEL: Record<string, string> = {
  frame: '容器', group: '分组', text: '文本', button: '按钮', input: '输入框',
  image: '图片', icon: '图标', card: '卡片', list: '列表', navbar: '导航栏',
  tabbar: '标签栏', sidebar: '侧边栏', table: '表格', chart: '图表', avatar: '头像',
  badge: '徽标', tag: '标签', divider: '分隔线', shape: '形状', chart_alt: '图表',
}

function TypeGlyph({ type }: { type: Node['type'] }) {
  const t = TYPE_LABEL[type] ?? type
  const ch = t.slice(0, 1)
  return <span style={{ fontSize: 9, fontWeight: 700 }}>{ch}</span>
}

interface RowProps {
  node: Node
  depth: number
  selectedIds: string[]
  onSelect: (id: string, additive: boolean) => void
}

function Row({ node, depth, selectedIds, onSelect }: RowProps) {
  const [open, setOpen] = useState(true)
  const selected = selectedIds.includes(node.id)
  const hasChildren = !!node.children?.length

  const toggleHidden = (e: React.MouseEvent) => {
    e.stopPropagation()
    useProjectStore.getState().commit(node.hidden ? '显示元素' : '隐藏元素', (d) => {
      const pages = d.pages.map((p) => ({
        ...p,
        root: patchNode(p.root, node.id, (n) => ({ ...n, hidden: !n.hidden })),
      }))
      return { ...d, pages }
    })
  }

  const toggleLock = (e: React.MouseEvent) => {
    e.stopPropagation()
    useProjectStore.getState().commit('切换锁定', (d) => {
      const pages = d.pages.map((p) => ({
        ...p,
        root: patchNode(p.root, node.id, (n) => ({ ...n, locked: !n.locked })),
      }))
      return { ...d, pages }
    })
  }

  return (
    <>
      <div
        className={`layer-row ${selected ? 'selected' : ''} ${node.hidden ? 'hidden-node' : ''}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={(e) => onSelect(node.id, e.shiftKey || e.metaKey || e.ctrlKey)}
        title={`${node.name ?? ''} (${TYPE_LABEL[node.type] ?? node.type})`}
      >
        <span
          className="type-ico"
          style={{ cursor: hasChildren ? 'pointer' : 'default' }}
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) setOpen((v) => !v)
          }}
        >
          {hasChildren ? (open ? '▾' : '▸') : <TypeGlyph type={node.type} />}
        </span>
        <span className="label">{node.name ?? TYPE_LABEL[node.type] ?? node.type}</span>
        <span className="acts">
          <button onClick={toggleHidden} title={node.hidden ? '显示' : '隐藏'}>
            <IconEye size={11} style={{ opacity: node.hidden ? 0.4 : 1 }} />
          </button>
          <button onClick={toggleLock} title={node.locked ? '解锁' : '锁定'}>
            {node.locked ? '🔒' : '🔓'}
          </button>
        </span>
      </div>
      {open &&
        hasChildren &&
        node.children!.map((c) => (
          <Row key={c.id} node={c} depth={depth + 1} selectedIds={selectedIds} onSelect={onSelect} />
        ))}
    </>
  )
}

export function LayerTree() {
  const page = useProjectStore((s) => s.currentPage())
  const selectedIds = useProjectStore((s) => s.selectedIds)
  const select = useProjectStore((s) => s.select)

  if (!page) {
    return (
      <div className="empty">
        <div className="empty-icon">
          <IconLayers size={18} />
        </div>
        <div className="empty-title">暂无页面</div>
      </div>
    )
  }

  const onSelect = (id: string, additive: boolean) => {
    if (additive) {
      const next = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
      select(next)
    } else {
      select([id])
    }
  }

  return (
    <div style={{ padding: '6px 4px' }}>
      <Row node={page.root} depth={0} selectedIds={selectedIds} onSelect={onSelect} />
    </div>
  )
}
