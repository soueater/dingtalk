// src/components/hub/ProjectSettingsModal.tsx
// 项目设置（F-PM-03 快照 / F-PM-05 配额 / F-PM-06 规范导出）
import { useEffect, useState } from 'react'
import type { InterfaceQuota, SnapshotEntry } from '@shared/design'
import { DEFAULT_QUOTA, GLOBAL_MAX_PAGES, SCHEMA_VERSION } from '@shared/design'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { IconHistory, IconTrash, IconExport, IconPalette } from '@/components/ui/Icons'
import { useUiStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { describeTokens } from '@/services/design/style-extract'
import { findSpec } from '@/services/design/specs'
import { serializeDesignMd } from '@shared/design-md'
import { effectiveHardLimit, effectiveSoftLimit, resolveQuota } from '@/services/project/quota'
import {
  createSnapshot,
  deleteProject,
  listSnapshots,
  restoreSnapshot,
} from '@/services/project/hub-actions'
import { saveSpecToLibrary } from '@/services/design/spec-library'
import { formatFullTime } from '@/lib/format'

export function ProjectSettingsModal() {
  const overlay = useUiStore((s) => s.overlay)
  const open = overlay === 'project-settings'
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const toast = useUiStore((s) => s.toast)

  const design = useProjectStore((s) => s.design)
  const path = useProjectStore((s) => s.path)
  const setQuota = useProjectStore((s) => s.setQuota)
  const stats = useProjectStore((s) => s.stats)
  const violations = useProjectStore((s) => s.violations)

  const [snaps, setSnaps] = useState<SnapshotEntry[]>([])
  const [nameDraft, setNameDraft] = useState(design.meta.name)

  const quota = resolveQuota(design.meta)
  const stat = stats()
  const problems = violations()

  const refreshSnaps = async () => {
    if (!design.meta.id) return
    setSnaps(await listSnapshots(design.meta.id))
  }

  useEffect(() => {
    if (!open) return
    setNameDraft(useProjectStore.getState().design.meta.name)
    void refreshSnaps()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, design.meta.id])

  const patchQuota = (patch: Partial<InterfaceQuota>) => setQuota(patch)

  const boundSpec = design.meta.specId ? findSpec(design, design.meta.specId) : undefined

  const onExportDesignMd = async () => {
    const spec = boundSpec ?? {
      id: 'current',
      name: design.meta.name,
      desc: '由望舒从当前项目导出',
      source: 'derived' as const,
      tokens: design.tokens,
      createdAt: new Date().toISOString(),
    }
    const md = serializeDesignMd(spec)
    if (!window.dsa?.exporter) {
      toast('error', '导出仅在桌面客户端中可用')
      return
    }
    const r = await window.dsa.exporter.saveText(`${spec.name}-DESIGN.md`, md, [
      { name: 'Markdown', extensions: ['md'] },
    ])
    if (r.ok && r.data.ok) toast('success', `已导出 DESIGN.md：${r.data.path}`)
  }

  const onSaveSpecToLibrary = async () => {
    const spec = boundSpec ?? {
      id: `spec_${Date.now().toString(36)}`,
      name: `${design.meta.name} 规范`,
      desc: describeTokens(design.tokens).join(' · '),
      source: 'derived' as const,
      tokens: design.tokens,
      createdAt: new Date().toISOString(),
    }
    await saveSpecToLibrary(spec)
  }

  return (
    <Modal
      open={open}
      title="项目设置"
      subtitle={path || '尚未保存到磁盘'}
      width={720}
      onClose={closeOverlay}
      footer={
        <>
          <span className="dim">
            数据格式 v{SCHEMA_VERSION} · {stat.total} 个界面 · {stat.flowCount} 条跳转
          </span>
          <div className="flex-1" />
          <Button onClick={closeOverlay}>关闭</Button>
        </>
      }
    >
      <div className="modal-body">
        {/* ---------------- 基本信息 ---------------- */}
        <section className="ps-sec">
          <div className="ps-sec-title">基本信息</div>
          <Field label="项目名称">
            <div className="row">
              <input
                className="input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  const v = nameDraft.trim()
                  if (v && v !== useProjectStore.getState().design.meta.name) {
                    useProjectStore.getState().renameProject(v)
                    // 同步进工作区索引，让项目中心卡片立即更新
                    if (design.meta.id) void useWorkspaceStore.getState().patchEntry(design.meta.id, { name: v })
                  }
                }}
              />
              <Button
                variant="ghost"
                onClick={() =>
                  setQuota({ ...quota, planned: Math.max(1, useProjectStore.getState().design.pages.length) })
                }
                title="把计划数对齐到当前实际界面数"
              >
                对齐计划数
              </Button>
            </div>
          </Field>
          <div className="ps-kv">
            <span>设备</span>
            <b>{design.meta.device}</b>
            <span>画布</span>
            <b>
              {design.meta.canvas.width} × {design.meta.canvas.height}
            </b>
            <span>创建</span>
            <b>{formatFullTime(design.meta.createdAt)}</b>
            <span>更新</span>
            <b>{formatFullTime(design.meta.updatedAt)}</b>
          </div>
        </section>

        {/* ---------------- 界面数量 N ---------------- */}
        <section className="ps-sec">
          <div className="ps-sec-title">
            界面数量 N
            <span className="dim">（当前 {stat.total} 个 · 已分组 {stat.grouped} · 未分组 {stat.ungrouped}）</span>
          </div>

          <div className="row">
            <Field label="计划（生成目标）" hint="AI 生成界面时的目标数量">
              <input
                className="input"
                type="number"
                min={1}
                max={999}
                value={quota.planned}
                onChange={(e) => patchQuota({ planned: Number(e.target.value) })}
              />
            </Field>
            <Field label="软上限" hint={`超过会提示但允许（当前生效 ${effectiveSoftLimit(quota)}）`}>
              <input
                className="input"
                type="number"
                min={1}
                max={999}
                value={quota.softLimit}
                onChange={(e) => patchQuota({ softLimit: Number(e.target.value) })}
              />
            </Field>
            <Field label="硬上限" hint={`0 = 不限；全局兜底 ${GLOBAL_MAX_PAGES}（当前生效 ${effectiveHardLimit(quota)}）`}>
              <input
                className="input"
                type="number"
                min={0}
                max={999}
                value={quota.hardLimit}
                onChange={(e) => patchQuota({ hardLimit: Number(e.target.value) })}
              />
            </Field>
          </div>

          <Field label="组织方式">
            <select
              className="input"
              value={quota.strategy}
              onChange={(e) => patchQuota({ strategy: e.target.value as InterfaceQuota['strategy'] })}
            >
              <option value="single">单屏为主</option>
              <option value="flow">以流程为主</option>
              <option value="batch">批量铺开</option>
            </select>
          </Field>

          <div className="row">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => patchQuota({ ...DEFAULT_QUOTA })}
            >
              恢复默认（{DEFAULT_QUOTA.softLimit}/{DEFAULT_QUOTA.hardLimit}）
            </Button>
            {problems.length > 0 && (
              <span className="ps-warn">检测到 {problems.length} 处数据一致性问题，已记录日志</span>
            )}
          </div>
        </section>

        {/* ---------------- 设计规范 ---------------- */}
        <section className="ps-sec">
          <div className="ps-sec-title">
            <IconPalette size={12} /> 设计规范
          </div>
          {boundSpec ? (
            <>
              <div className="ps-kv">
                <span>当前规范</span>
                <b>{boundSpec.name}</b>
                <span>来源</span>
                <b>{boundSpec.source === 'builtin' ? '内置' : boundSpec.source === 'imported' ? '导入' : '派生'}</b>
              </div>
              <div className="row">
                <Button variant="ghost" size="sm" onClick={() => void onExportDesignMd()}>
                  <IconExport size={12} /> 导出 DESIGN.md
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void onSaveSpecToLibrary()}>
                  存入规范库
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="dim">
                当前项目未绑定规范，Token 由生成时自由定稿。可以在这里把当前风格固化成一份规范，供后续复用。
              </p>
              <div className="row">
                <Button variant="ghost" size="sm" onClick={() => void onSaveSpecToLibrary()}>
                  把当前风格存入规范库
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void onExportDesignMd()}>
                  <IconExport size={12} /> 导出 DESIGN.md
                </Button>
              </div>
            </>
          )}
          <div className="ps-token-desc dim">{describeTokens(design.tokens).join(' · ')}</div>
        </section>

        {/* ---------------- 快照 ---------------- */}
        <section className="ps-sec">
          <div className="ps-sec-title">
            <IconHistory size={12} /> 历史快照
            <span className="dim">（最多保留 10 个）</span>
          </div>
          <div className="row">
            <Button
              variant="default"
              size="sm"
              onClick={async () => {
                const label = `手动快照 ${new Date().toLocaleString('zh-CN')}`
                await createSnapshot(design.meta.id, useProjectStore.getState().design, label)
                await refreshSnaps()
              }}
            >
              创建快照
            </Button>
          </div>
          {snaps.length === 0 ? (
            <p className="dim">暂无快照。创建快照后可在误操作时一键回退。</p>
          ) : (
            <div className="ps-snaps">
              {snaps.map((s) => (
                <div key={s.id} className="ps-snap">
                  <div className="m">
                    <div className="n">{s.name}</div>
                    <div className="t">{formatFullTime(s.at)}</div>
                  </div>
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await restoreSnapshot(design.meta.id, s.id, s.name)
                      closeOverlay()
                    }}
                  >
                    恢复
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    title="删除该快照"
                    onClick={async () => {
                      if (!window.confirm(`删除快照「${s.name}」？`)) return
                      await window.dsa.snapshot.remove(design.meta.id, s.id)
                      await refreshSnaps()
                    }}
                  >
                    <IconTrash size={13} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---------------- 危险操作 ---------------- */}
        <section className="ps-sec danger">
          <div className="ps-sec-title">危险操作</div>
          <p className="dim">
            删除项目会把 .dsproj 文件移入**系统回收站**（可恢复），而不是永久删除。
          </p>
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              const meta = useWorkspaceStore
                .getState()
                .projects.find((p) => p.id === design.meta.id)
              if (!meta) {
                toast('warn', '该项目尚未保存到磁盘')
                return
              }
              closeOverlay()
              await deleteProject(meta)
            }}
          >
            <IconTrash size={13} /> 删除项目…
          </Button>
        </section>
      </div>
    </Modal>
  )
}
