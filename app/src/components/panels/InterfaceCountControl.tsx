// src/components/panels/InterfaceCountControl.tsx —— 界面数量 N 控制条（F-PM-05）
//
// 把「N 的三档语义」直接摊在列表底部，让用户随时看清：
//   当前 / 计划 / 软上限 / 硬上限 各是多少，还能再加几个。
// 批量追加是这里的主入口（+1 / +3 / +5 / 自定义），所有判定都交给 store。
import { useState } from 'react'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'
import { Button } from '@/components/ui/Button'
import { IconPlus, IconSettings } from '@/components/ui/Icons'
import { effectiveHardLimit, effectiveSoftLimit, resolveQuota } from '@/services/project/quota'

const PRESETS = [1, 3, 5]

export function InterfaceCountControl() {
  const design = useProjectStore((s) => s.design)
  const addInterfaces = useProjectStore((s) => s.addInterfaces)
  const openOverlay = useUiStore((s) => s.openOverlay)
  const toast = useUiStore((s) => s.toast)
  const [custom, setCustom] = useState('')

  const quota = resolveQuota(design.meta)
  const total = design.pages.length
  const soft = effectiveSoftLimit(quota)
  const hard = effectiveHardLimit(quota)
  const remaining = Math.max(0, hard - total)

  /** 进度条口径：以硬上限为满格；hard 极大（不限）时用 soft*2 兜底避免除零 */
  const scale = hard > 0 && hard < 100000 ? hard : Math.max(1, soft * 2)
  const pctPlanned = Math.min(100, (quota.planned / scale) * 100)
  const pctActual = Math.min(100, (total / scale) * 100)
  const overSoft = total > soft
  const overPlanned = total > quota.planned

  const add = (n: number) => {
    if (n <= 0) return
    const r = addInterfaces(n)
    if (!r.ok) toast('error', r.message ?? '未能新增界面')
    else if (r.message) toast('warn', r.message)
  }

  const addCustom = () => {
    const n = Math.trunc(Number(custom))
    if (!Number.isFinite(n) || n <= 0) {
      toast('warn', '请输入大于 0 的整数')
      return
    }
    add(n)
    setCustom('')
  }

  return (
    <div className="ifc-ctl">
      <div className="ifc-head">
        <span className="ifc-title">界面数量 N</span>
        <div className="flex-1" />
        <button className="ifc-gear" title="项目设置：调整上限" onClick={() => openOverlay('project-settings')}>
          <IconSettings size={12} />
        </button>
      </div>

      <div className="ifc-meter" title={`已用 ${total} / 硬上限 ${hard}`}>
        <div className="ifc-meter-planned" style={{ width: `${pctPlanned}%` }} />
        <div className={`ifc-meter-fill ${overSoft ? 'over' : ''}`} style={{ width: `${pctActual}%` }} />
      </div>

      <div className="ifc-kv">
        <span>
          当前 <b>{total}</b>
        </span>
        <span className={overPlanned ? 'warn' : ''}>
          计划 <b>{quota.planned}</b>
        </span>
        <span className={overSoft ? 'warn' : ''}>
          软上限 <b>{soft}</b>
        </span>
        <span>
          硬上限 <b>{quota.hardLimit === 0 ? '不限' : hard}</b>
        </span>
      </div>

      <div className="ifc-hint">
        {remaining <= 0
          ? '已达上限，可在项目设置中提高硬上限。'
          : overSoft
            ? `已超过建议上限 ${soft}，建议拆分为多个项目或使用分组管理。`
            : overPlanned
              ? `比计划多 ${total - quota.planned} 个界面，可在项目设置里「对齐计划数」。`
              : `还可以再加 ${remaining} 个。`}
      </div>

      <div className="ifc-actions">
        {PRESETS.map((n) => (
          <button
            key={n}
            className="ifc-btn"
            disabled={n > remaining || remaining <= 0}
            onClick={() => add(n)}
            title={`新增 ${n} 个界面`}
          >
            <IconPlus size={10} /> {n}
          </button>
        ))}
        <input
          className="input ifc-input"
          placeholder="N"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addCustom()
            e.stopPropagation()
          }}
        />
        <Button variant="ghost" size="sm" onClick={addCustom} disabled={!custom.trim()}>
          追加
        </Button>
      </div>
    </div>
  )
}
