// src/components/overlays/BranchesModal.tsx —— 方案分支（F-PM-07）
//
// 与「设计变体」的区别（这是本面板存在的理由）：
//   变体 = 单个界面的几种画法，挑完直接替换根节点；
//   分支 = 整个项目的另一套走法（界面数量、导航结构、信息密度都可能不同），
//          必须能并存、能对比、能事后采纳，才谈得上"探索方案"。
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ProjectBranchSummary } from '@shared/design'
import { useUiStore } from '@/stores/ui.store'
import { useProjectStore } from '@/stores/project.store'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { IconBranch, IconPlus, IconTrash, IconCheck, IconEdit, IconInfo } from '@/components/ui/Icons'
import { formatFullTime } from '@/lib/format'
import {
  adoptBranch,
  listBranches,
  removeBranch,
  renameBranch,
  saveCurrentAsBranch,
} from '@/services/project/branches'

/** 常用的差异维度，点一下即可填进 aspect，省去打字 */
const ASPECT_PRESETS = ['布局更紧凑', '信息密度更高', '配色更暖', '导航改为底部标签', '增加引导流程', '精简到核心路径']

export function BranchesModal() {
  const overlay = useUiStore((s) => s.overlay)
  const open = overlay === 'project-branches'
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const toast = useUiStore((s) => s.toast)

  const design = useProjectStore((s) => s.design)
  const projectId = design.meta.id

  const [branches, setBranches] = useState<ProjectBranchSummary[]>([])
  const [name, setName] = useState('')
  const [aspect, setAspect] = useState('')
  const [busy, setBusy] = useState(false)

  const currentStats = useMemo(() => {
    const count = (n: { children?: unknown[] }): number =>
      1 + ((n.children ?? []) as Array<{ children?: unknown[] }>).reduce((s, c) => s + count(c), 0)
    return {
      pages: design.pages.length,
      flows: design.flows.length,
      nodes: design.pages.reduce((s, p) => s + count(p.root), 0),
    }
  }, [design])

  const refresh = useCallback(async () => {
    setBranches(await listBranches(projectId))
  }, [projectId])

  useEffect(() => {
    if (!open) return
    setName(`方案 ${String.fromCharCode(65 + Math.min(25, branches.length))}`)
    setAspect('')
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId])

  const onCreate = async () => {
    const n = name.trim()
    if (!n) {
      toast('warn', '请给这条分支起个名字')
      return
    }
    setBusy(true)
    try {
      const r = await saveCurrentAsBranch(n, aspect.trim() || undefined)
      if (r) {
        await refresh()
        setName(`方案 ${String.fromCharCode(65 + Math.min(25, branches.length + 1))}`)
        setAspect('')
      }
    } finally {
      setBusy(false)
    }
  }

  const onAdopt = async (b: ProjectBranchSummary) => {
    if (
      !window.confirm(
        `采纳「${b.name}」会用它的 ${b.pageCount} 个界面覆盖当前项目的 ${currentStats.pages} 个界面。\n` +
          `当前内容会进入撤销栈，可用 Ctrl+Z 撤回。\n\n确定采纳？`,
      )
    ) {
      return
    }
    setBusy(true)
    try {
      if (await adoptBranch(projectId, b.id, b.name)) await refresh()
    } finally {
      setBusy(false)
    }
  }

  const onRename = async (b: ProjectBranchSummary) => {
    const next = window.prompt('分支名称', b.name)
    if (!next?.trim()) return
    const nextAspect = window.prompt('差异说明（可留空）', b.aspect ?? '')
    if (nextAspect === null) return
    setBranches(await renameBranch(projectId, b.id, next.trim(), nextAspect.trim() || undefined))
  }

  const onDelete = async (b: ProjectBranchSummary) => {
    if (!window.confirm(`删除方案分支「${b.name}」？该操作不可撤销。`)) return
    setBranches(await removeBranch(projectId, b.id))
  }

  const delta = (b: ProjectBranchSummary) => {
    const dp = b.pageCount - currentStats.pages
    const dn = b.nodeCount - currentStats.nodes
    const sign = (v: number) => (v > 0 ? `+${v}` : String(v))
    return `界面 ${sign(dp)} · 节点 ${sign(dn)}`
  }

  return (
    <Modal
      open={open}
      title="方案分支"
      subtitle="把当前整套方案存下来，或采纳之前存下的另一套走法"
      width={780}
      onClose={closeOverlay}
      footer={
        <>
          <span className="dim">
            当前项目：{currentStats.pages} 个界面 · {currentStats.flows} 条跳转 · {currentStats.nodes} 个节点
          </span>
          <div className="flex-1" />
          <Button onClick={closeOverlay}>关闭</Button>
        </>
      }
    >
      <div className="modal-body">
        {/* ---------------- 保存当前为分支 ---------------- */}
        <div className="ps-sec">
          <div className="ps-sec-title">
            <IconPlus size={12} /> 把当前方案存为分支
          </div>
          <div className="row" style={{ gap: 'var(--sp-3)' }}>
            <Field label="分支名称" required>
              <input
                className="input"
                placeholder="例如：方案 B · 底部标签导航"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </Field>
            <Field label="差异说明（可选）" hint="一句话说清这套方案和别处有什么不同">
              <input
                className="input"
                placeholder="例如：导航改为底部标签，信息密度更高"
                value={aspect}
                onChange={(e) => setAspect(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </Field>
          </div>
          <div className="row-wrap">
            {ASPECT_PRESETS.map((p) => (
              <button key={p} className={`ifc-btn ${aspect === p ? 'on' : ''}`} onClick={() => setAspect(p)}>
                {p}
              </button>
            ))}
          </div>
          <div className="row">
            <Button variant="primary" size="sm" disabled={busy || !name.trim()} onClick={() => void onCreate()}>
              <IconBranch size={12} /> 保存为分支
            </Button>
            <span className="dim">分支是快照，不会随后续编辑变化</span>
          </div>
        </div>

        {/* ---------------- 分支列表 ---------------- */}
        <div className="ps-sec">
          <div className="ps-sec-title">
            <IconBranch size={12} /> 已保存的分支
            <span className="dim">（{branches.length} 条 · 上限 20 条）</span>
          </div>

          {branches.length === 0 ? (
            <p className="dim">
              还没有分支。在想探索另一套结构之前，先把当前方案存一条，之后就能随时回退对比。
            </p>
          ) : (
            <div className="br-list">
              {branches.map((b) => (
                <div key={b.id} className={`br-item ${b.adopted ? 'adopted' : ''}`}>
                  <div className="br-main">
                    <div className="br-name">
                      {b.name}
                      {b.adopted && (
                        <span className="br-badge">
                          <IconCheck size={9} /> 已采纳
                        </span>
                      )}
                    </div>
                    <div className="br-meta">
                      {b.pageCount} 个界面 · {b.flowCount} 条跳转 · {b.nodeCount} 个节点
                    </div>
                    {b.aspect && <div className="br-aspect">{b.aspect}</div>}
                    <div className="br-time">
                      {formatFullTime(b.createdAt)} · 与当前相比 {delta(b)}
                    </div>
                  </div>
                  <div className="br-ops">
                    <Button variant="ghost" size="sm" onClick={() => void onAdopt(b)} disabled={busy}>
                      采纳
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      title="重命名"
                      onClick={() => void onRename(b)}
                    >
                      <IconEdit size={12} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      title="删除分支"
                      onClick={() => void onDelete(b)}
                    >
                      <IconTrash size={12} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="ps-token-desc dim">
            <IconInfo size={11} /> 分支存在本机 userData 目录，不写进 .dsproj ——
            这样交付出去的项目文件不会混入未采纳的草稿。
          </div>
        </div>
      </div>
    </Modal>
  )
}
