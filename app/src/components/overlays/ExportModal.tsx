// src/components/overlays/ExportModal.tsx —— 导出面板
import { useState } from 'react'
import type { ExportFormat } from '@shared/design'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, CheckRow } from '@/components/ui/Field'
import { IconExport, IconCheck } from '@/components/ui/Icons'
import { useUiStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { exportProject } from '@/services/project/actions'

interface FormatDef {
  id: ExportFormat
  label: string
  desc: string
  dir: boolean
}

const FORMATS: FormatDef[] = [
  {
    id: 'html-single',
    label: 'HTML 单文件',
    desc: '所有页面打包为一个 .html，双击即可在浏览器查看，带页面切换标签',
    dir: false,
  },
  {
    id: 'html-multi',
    label: 'HTML 工程（多文件）',
    desc: '每页一个 .html + index.html 导航 + design.json 源文件，适合交给开发',
    dir: true,
  },
  {
    id: 'png',
    label: 'PNG 图片',
    desc: '每个页面导出为 2 倍分辨率图片，适合放入文档或设计评审',
    dir: true,
  },
  {
    id: 'svg',
    label: 'SVG 矢量图',
    desc: '首个页面的矢量图，可无损缩放，适合进一步编辑',
    dir: false,
  },
  {
    id: 'json',
    label: 'Design JSON',
    desc: '完整设计源文件，可在本工具重新导入继续编辑',
    dir: false,
  },
]

export function ExportModal() {
  const overlay = useUiStore((s) => s.overlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const design = useProjectStore((s) => s.design)
  const [selected, setSelected] = useState<ExportFormat>('html-single')
  const [busy, setBusy] = useState(false)

  const open = overlay === 'export'
  if (!open) return null

  const onExport = async () => {
    setBusy(true)
    try {
      await exportProject(selected)
      closeOverlay()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="导出"
      subtitle={`${design.pages.length} 个页面 · ${design.meta.canvas.width}×${design.meta.canvas.height}`}
      width={620}
      onClose={closeOverlay}
      footer={
        <>
          <span className="field-hint">导出后会自动打开所在文件夹</span>
          <div className="flex-1" />
          <Button onClick={closeOverlay}>取消</Button>
          <Button variant="primary" onClick={onExport} disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" /> 导出中…
              </>
            ) : (
              <>
                <IconExport size={13} /> 导出
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="modal-body">
        <Field label="导出格式">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {FORMATS.map((f) => (
              <div
                key={f.id}
                className={`card card-hover ${selected === f.id ? '' : ''}`}
                style={{
                  borderColor: selected === f.id ? 'var(--brand)' : undefined,
                  background: selected === f.id ? 'var(--brand-soft)' : undefined,
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  padding: 'var(--sp-3)',
                }}
                onClick={() => setSelected(f.id)}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    border: `1.5px solid ${selected === f.id ? 'var(--brand)' : 'var(--border-strong)'}`,
                    display: 'grid',
                    placeItems: 'center',
                    flex: '0 0 auto',
                    marginTop: 1,
                    color: 'var(--on-brand)',
                    background: selected === f.id ? 'var(--brand)' : 'transparent',
                  }}
                >
                  {selected === f.id && <IconCheck size={10} />}
                </span>
                <div className="flex-1">
                  <div style={{ fontSize: 12, color: 'var(--text-1)', fontWeight: 500 }}>
                    {f.label}
                    {f.dir && <span className="badge" style={{ marginLeft: 6 }}>导出为文件夹</span>}
                  </div>
                  <div className="field-hint" style={{ marginTop: 3 }}>
                    {f.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Field>

        <div className="alert alert-info" style={{ marginTop: 'var(--sp-4)' }}>
          <span className="flex-1">
            导出的 HTML 完全自包含，无需本工具即可打开；所有样式已内联，不依赖外部资源。
          </span>
        </div>
      </div>
    </Modal>
  )
}
