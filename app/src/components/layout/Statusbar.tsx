// src/components/layout/Statusbar.tsx
import { useProjectStore } from '@/stores/project.store'
import { useConfigStore } from '@/stores/config.store'
import { useUiStore } from '@/stores/ui.store'
import { IconInfo } from '@/components/ui/Icons'

export function Statusbar() {
  const design = useProjectStore((s) => s.design)
  const dirty = useProjectStore((s) => s.dirty)
  const path = useProjectStore((s) => s.path)
  const selectedIds = useProjectStore((s) => s.selectedIds)
  const cfg = useConfigStore((s) => s.current())
  const encrypted = useConfigStore((s) => s.encrypted)
  const generating = useUiStore((s) => s.generating)
  const generatingStage = useUiStore((s) => s.generatingStage)
  const generatingProgress = useUiStore((s) => s.generatingProgress)

  const page = design.pages.find((p) => p.id === useProjectStore.getState().activePageId)
  const nodeCount = design.pages.reduce((s, p) => s + count(p.root), 0)

  return (
    <div className="statusbar">
      <span className="sb">
        <span className={`sb-dot ${generating ? 'busy' : cfg ? 'ok' : 'warn'}`} />
        {generating ? generatingStage : cfg ? `模型：${cfg.name}` : '未配置模型'}
      </span>

      {generating && generatingProgress.total > 0 && (
        <span className="sb mono">
          {generatingProgress.done}/{generatingProgress.total}
        </span>
      )}

      <span className="sb" title={path ?? '尚未保存'}>
        {dirty ? '● 未保存' : path ? '✓ 已保存' : '○ 新项目'}
      </span>

      {selectedIds.length > 0 && <span className="sb">已选中 {selectedIds.length}</span>}

      <span className="flex-1" />

      <span className="sb">
        {page ? `${design.pages.length} 页 · 当前「${page.name}」` : `${design.pages.length} 页`}
      </span>
      <span className="sb mono">
        {design.meta.canvas.width}×{design.meta.canvas.height}
      </span>
      <span className="sb">{nodeCount} 元素</span>
      <span className="sb" title={encrypted ? '密钥已加密存储' : '密钥以混淆方式存储'}>
        <IconInfo size={10} />
        {encrypted ? '密钥已加密' : '本地存储'}
      </span>
    </div>
  )
}

function count(node: import('@shared/design').Node): number {
  return 1 + (node.children?.reduce((s, c) => s + count(c), 0) ?? 0)
}
