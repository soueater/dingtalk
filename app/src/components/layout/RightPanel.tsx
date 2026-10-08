// src/components/layout/RightPanel.tsx —— 右栏：属性 / 跳转 / 规范 / 变更记录
import { useState } from 'react'
import { IconSliders, IconLink, IconPalette } from '@/components/ui/Icons'
import { Inspector } from '@/components/panels/Inspector'
import { FlowList } from '@/components/panels/FlowList'
import { SpecPanel } from '@/components/panels/SpecPanel'
import { useProjectStore } from '@/stores/project.store'

type Tab = 'props' | 'flows' | 'spec'

export function RightPanel() {
  const [tab, setTab] = useState<Tab>('props')
  const selectedIds = useProjectStore((s) => s.selectedIds)
  const flowCount = useProjectStore((s) => s.design.flows.length)
  const specBound = useProjectStore((s) => Boolean(s.design.meta.specId))

  return (
    <aside className="panel panel-right">
      <div className="panel-tabs">
        <button className={`panel-tab ${tab === 'props' ? 'active' : ''}`} onClick={() => setTab('props')}>
          <IconSliders size={13} />
          <span style={{ fontSize: 11 }}>属性</span>
          {selectedIds.length > 0 && <span className="count">{selectedIds.length}</span>}
        </button>
        <button className={`panel-tab ${tab === 'flows' ? 'active' : ''}`} onClick={() => setTab('flows')}>
          <IconLink size={13} />
          <span style={{ fontSize: 11 }}>跳转</span>
          {flowCount > 0 && <span className="count">{flowCount}</span>}
        </button>
        <button className={`panel-tab ${tab === 'spec' ? 'active' : ''}`} onClick={() => setTab('spec')}>
          <IconPalette size={13} />
          <span style={{ fontSize: 11 }}>规范</span>
          {specBound && <span className="count">·</span>}
        </button>
      </div>

      <div className="panel-body">
        {tab === 'props' ? <Inspector /> : tab === 'flows' ? <FlowList /> : <SpecPanel />}
      </div>
    </aside>
  )
}
