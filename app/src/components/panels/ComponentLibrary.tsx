// src/components/panels/ComponentLibrary.tsx —— 组件库（点击即插入到当前容器）
import type { Node, NodeType } from '@shared/design'
import { useProjectStore } from '@/stores/project.store'
import { Button } from '@/components/ui/Button'
import { IconPlus } from '@/components/ui/Icons'
import { uid } from '@/lib/id'
import { patchNode } from '@/components/canvas/Canvas'

interface CompDef {
  type: NodeType
  label: string
  glyph: string
  make: () => Node
}

const t = (content: string, size = 15, weight = 400, color = '$color.text'): Node => ({
  id: `txt_${uid()}`,
  type: 'text',
  name: content.slice(0, 12),
  props: { content },
  layout: { mode: 'flex', width: 'fill', height: 'fit' },
  style: { font: { size, weight }, textColor: color },
})

const COMPONENTS: CompDef[] = [
  {
    type: 'text',
    label: '文本',
    glyph: 'T',
    make: () => t('这是一段文本'),
  },
  {
    type: 'button',
    label: '按钮',
    glyph: '▭',
    make: () => ({
      id: `btn_${uid()}`,
      type: 'button',
      name: '按钮',
      props: { label: '按钮', variant: 'primary' },
      layout: { mode: 'flex', width: 'fill', height: 44, justify: 'center', align: 'center' },
      style: { fill: '$color.primary', radius: '$radius.md', font: { size: 15, weight: 600 }, textColor: '$color.onPrimary', cursor: 'pointer' },
    }),
  },
  {
    type: 'input',
    label: '输入框',
    glyph: '▤',
    make: () => ({
      id: `inp_${uid()}`,
      type: 'input',
      name: '输入框',
      props: { placeholder: '请输入内容' },
      layout: { mode: 'flex', width: 'fill', height: 44, align: 'center' },
      style: { fill: '$color.surface', radius: '$radius.md', stroke: { color: '$color.border', width: 1, position: 'inside' } },
    }),
  },
  {
    type: 'image',
    label: '图片',
    glyph: '▨',
    make: () => ({
      id: `img_${uid()}`,
      type: 'image',
      name: '图片',
      props: {},
      layout: { width: 'fill', height: 160 },
      style: { radius: '$radius.md' },
    }),
  },
  {
    type: 'card',
    label: '卡片',
    glyph: '▢',
    make: () => ({
      id: `card_${uid()}`,
      type: 'card',
      name: '卡片',
      layout: { mode: 'flex', direction: 'column', width: 'fill', height: 'fit', gap: 8, padding: { t: 16, r: 16, b: 16, l: 16 } },
      style: { fill: '$color.bg', radius: '$radius.lg', stroke: { color: '$color.border', width: 1, position: 'inside' } },
      children: [
        t('卡片标题', 17, 600),
        t('这里是卡片的描述内容', 14, 400, '$color.textSecondary'),
      ],
    }),
  },
  {
    type: 'divider',
    label: '分隔线',
    glyph: '─',
    make: () => ({
      id: `div_${uid()}`,
      type: 'divider',
      name: '分隔线',
      layout: { width: 'fill', height: 1 },
      style: { fill: '$color.border' },
    }),
  },
  {
    type: 'badge',
    label: '标签',
    glyph: '⬤',
    make: () => ({
      id: `tag_${uid()}`,
      type: 'badge',
      name: '标签',
      props: { label: '标签' },
      layout: { width: 'fit', height: 22 },
      style: { fill: '$color.primarySoft', textColor: '$color.primary', radius: '$radius.full', font: { size: 12, weight: 600 } },
    }),
  },
  {
    type: 'avatar',
    label: '头像',
    glyph: '◉',
    make: () => ({
      id: `avt_${uid()}`,
      type: 'avatar',
      name: '头像',
      props: { initials: '李' },
      layout: { width: 48, height: 48 },
      style: { fill: '$color.surfaceAlt', radius: '$radius.full', textColor: '$color.textSecondary' },
    }),
  },
  {
    type: 'navbar',
    label: '导航栏',
    glyph: '☰',
    make: () => ({
      id: `nav_${uid()}`,
      type: 'navbar',
      name: '导航栏',
      props: { title: '页面标题' },
      layout: { width: 'fill', height: 48, padding: { l: 16, r: 16 } },
      style: { fill: '$color.bg', stroke: { color: '$color.border', width: 1, position: 'inside' } },
    }),
  },
  {
    type: 'list',
    label: '列表',
    glyph: '≡',
    make: () => ({
      id: `list_${uid()}`,
      type: 'list',
      name: '列表',
      layout: { mode: 'flex', direction: 'column', width: 'fill', height: 'fit', gap: 10 },
      style: {},
      children: [1, 2, 3].map((i) => ({
        id: `li_${uid()}`,
        type: 'listItem' as NodeType,
        name: `条目 ${i}`,
        layout: { mode: 'flex', direction: 'row', width: 'fill', height: 'fit', gap: 12, align: 'center', padding: { t: 12, r: 12, b: 12, l: 12 } },
        style: { fill: '$color.bg', radius: '$radius.md', stroke: { color: '$color.border', width: 1, position: 'inside' } },
        children: [
          { id: `li_av_${uid()}`, type: 'avatar' as NodeType, name: '头像', props: { initials: String(i) }, layout: { width: 36, height: 36 }, style: { fill: '$color.surfaceAlt', radius: '$radius.full', textColor: '$color.textSecondary' } },
          { id: `li_tx_${uid()}`, type: 'text' as NodeType, name: `条目 ${i}`, props: { content: `列表项 ${i}` }, layout: { width: 'fill', height: 'fit' }, style: { font: { size: 14 }, textColor: '$color.text' } },
        ],
      })),
    }),
  },
  {
    type: 'chart',
    label: '图表',
    glyph: '◫',
    make: () => ({
      id: `chart_${uid()}`,
      type: 'chart',
      name: '图表',
      props: { dataset: [12, 18, 15, 24, 30, 28, 36] },
      layout: { width: 'fill', height: 200 },
      style: { fill: '$color.surface', radius: '$radius.md' },
    }),
  },
  {
    type: 'progress',
    label: '进度条',
    glyph: '▬',
    make: () => ({
      id: `prg_${uid()}`,
      type: 'progress',
      name: '进度条',
      props: { value: 60 },
      layout: { width: 'fill', height: 6 },
      style: { fill: '$color.surfaceAlt', radius: '$radius.full' },
    }),
  },
  {
    type: 'frame',
    label: '容器',
    glyph: '▣',
    make: () => ({
      id: `frm_${uid()}`,
      type: 'frame',
      name: '容器',
      layout: { mode: 'flex', direction: 'column', width: 'fill', height: 'fit', gap: 10, padding: { t: 12, r: 12, b: 12, l: 12 } },
      style: { radius: '$radius.md' },
      children: [],
    }),
  },
]

export function ComponentLibrary() {
  const selectedIds = useProjectStore((s) => s.selectedIds)
  const activePageId = useProjectStore((s) => s.activePageId)
  const commit = useProjectStore((s) => s.commit)
  const select = useProjectStore((s) => s.select)

  const insert = (def: CompDef) => {
    const node = def.make()
    const st = useProjectStore.getState()
    const page = st.design.pages.find((p) => p.id === activePageId)
    if (!page) return

    // 目标容器：优先选中节点，否则页面根
    let targetId = page.root.id
    if (selectedIds.length === 1) {
      const f = st.findNode(selectedIds[0])
      if (f && isContainerLike(f.node)) targetId = f.node.id
      else if (f?.parent) targetId = f.parent.id
    }

    commit(`插入${def.label}`, (d) => ({
      ...d,
      pages: d.pages.map((p) =>
        p.id === activePageId
          ? { ...p, root: patchNode(p.root, targetId, (n) => ({ ...n, children: [...(n.children ?? []), node] })) }
          : p,
      ),
    }))
    select([node.id])
  }

  return (
    <div>
      <div className="block">
        <div className="block-title">基础组件</div>
        <div className="comp-grid">
          {COMPONENTS.map((c) => (
            <button key={c.type + c.label} className="comp-card" onClick={() => insert(c)} title={`插入${c.label}`}>
              <span className="glyph" style={{ fontSize: 11 }}>
                {c.glyph}
              </span>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="block">
        <div className="field-hint">
          点击组件插入到当前选中的容器内；未选中时插入到页面根容器。
        </div>
      </div>
    </div>
  )
}

function isContainerLike(node: Node): boolean {
  return ['frame', 'group', 'card', 'list', 'modal', 'drawer', 'tabs', 'accordion', 'listItem', 'table', 'tableRow', 'tableCell'].includes(
    node.type,
  )
}
