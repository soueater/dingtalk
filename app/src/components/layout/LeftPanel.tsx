// src/components/layout/LeftPanel.tsx —— 左栏：AI / 图层 / 页面 / 组件
import { useState } from 'react'
import { IconSparkles, IconLayers, IconComponent, IconFolder } from '@/components/ui/Icons'
import { AiPanel } from '@/components/panels/AiPanel'
import { LayerTree } from '@/components/panels/LayerTree'
import { PageList } from '@/components/panels/PageList'
import { ComponentLibrary } from '@/components/panels/ComponentLibrary'
import { useProjectStore } from '@/stores/project.store'

type Tab = 'ai' | 'pages' | 'layers' | 'components'

const TABS: Array<{ id: Tab; label: string; icon: typeof IconSparkles }> = [
  { id: 'ai', label: 'AI 生成', icon: IconSparkles },
  { id: 'pages', label: '页面', icon: IconFolder },
  { id: 'layers', label: '图层', icon: IconLayers },
  { id: 'components', label: '组件', icon: IconComponent },
]

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>('ai')
  const pageCount = useProjectStore((s) => s.design.pages.length)

  return (
    <aside className="panel panel-left">
      <div className="panel-tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`panel-tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
            title={label}
          >
            <Icon size={12} />
            <span>{label}</span>
            {id === 'pages' && <span className="count">{pageCount}</span>}
          </button>
        ))}
      </div>

      {tab === 'ai' ? (
        <AiPanel />
      ) : (
        <div className="panel-body" style={tab === 'components' ? { padding: 0 } : undefined}>
          {tab === 'pages' && <PageList />}
          {tab === 'layers' && <LayerTree />}
          {tab === 'components' && <ComponentLibrary />}
        </div>
      )}
    </aside>
  )
}
