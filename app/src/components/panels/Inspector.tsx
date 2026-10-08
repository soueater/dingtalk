// src/components/panels/Inspector.tsx —— 属性面板（布局 / 外观 / 文字 / 内容 / 状态）
import { useMemo } from 'react'
import type { Layout, Node, Style } from '@shared/design'
import { useProjectStore } from '@/stores/project.store'
import { buildTokenMap, resolveColor } from '@/services/render/tokens'
import { tokensForPage, resolveSpecForPage } from '@/services/design/specs'
import { patchNode } from '@/components/canvas/Canvas'
import { IconPlus, IconTrash } from '@/components/ui/Icons'
import { Button } from '@/components/ui/Button'

/* -------------------------- 通用更新入口 -------------------------- */

function useNodeUpdate() {
  const commit = useProjectStore((s) => s.commit)
  return (nodeId: string, label: string, fn: (n: Node) => Node, coalesceKey?: string) => {
    commit(
      label,
      (d) => ({
        ...d,
        pages: d.pages.map((p) => ({ ...p, root: patchNode(p.root, nodeId, fn) })),
      }),
      { coalesceKey },
    )
  }
}

/* ------------------------------ 小组件 ------------------------------ */

function NumField({
  k,
  value,
  onChange,
  step = 1,
  min,
  placeholder,
}: {
  k: string
  value: number | undefined
  onChange: (v: number | undefined) => void
  step?: number
  min?: number
  placeholder?: string
}) {
  return (
    <label className="mini-field">
      <span className="k">{k}</span>
      <input
        type="number"
        value={value ?? ''}
        step={step}
        min={min}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value
          onChange(raw === '' ? undefined : Number(raw))
        }}
      />
    </label>
  )
}

function TextField({
  k,
  value,
  onChange,
  placeholder,
}: {
  k?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="mini-field">
      {k && <span className="k">{k}</span>}
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function ColorField({
  label,
  value,
  onChange,
  tokens,
}: {
  label: string
  value: string | undefined
  onChange: (v: string) => void
  tokens: Array<{ key: string; color: string }>
}) {
  const isToken = typeof value === 'string' && value.startsWith('$')
  const plain = typeof value === 'string' && !isToken ? value : '#ffffff'

  return (
    <div className="field" style={{ marginBottom: 'var(--sp-2)' }}>
      <div className="field-label">
        <span>{label}</span>
        {isToken && <span className="badge badge-brand">{value}</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span className="color-swatch" style={{ background: isToken ? tokenColor(value, tokens) : plain }}>
          <input type="color" value={plain} onChange={(e) => onChange(e.target.value)} />
        </span>
        <input
          className="input"
          style={{ height: 26, fontSize: 11 }}
          value={value ?? ''}
          placeholder="#RRGGBB 或 $color.x"
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="token-chips">
        {tokens.slice(0, 10).map((t) => (
          <button
            key={t.key}
            className="token-chip"
            onClick={() => onChange(t.key)}
            title={`引用 ${t.key}`}
          >
            <i style={{ background: t.color }} />
            {t.key.replace('$color.', '')}
          </button>
        ))}
      </div>
    </div>
  )
}

function tokenColor(ref: string, tokens: Array<{ key: string; color: string }>): string {
  return tokens.find((t) => t.key === ref)?.color ?? 'transparent'
}

/* ------------------------------ 主面板 ------------------------------ */

export function Inspector() {
  const design = useProjectStore((s) => s.design)
  const selectedIds = useProjectStore((s) => s.selectedIds)
  const update = useNodeUpdate()
  const activePageId = useProjectStore((s) => s.activePageId)

  // F-ST-01：属性面板的候选 Token 与取值都必须来自「该元素所在页生效的规范」，
  // 否则页面级覆盖后，面板会显示项目级颜色，与画布实际渲染不一致。
  const found = selectedIds.length === 1 ? useProjectStore.getState().findNode(selectedIds[0]) : null
  const pageForNode = found?.page ?? design.pages.find((p) => p.id === activePageId)
  const pageTokens = useMemo(
    () => tokensForPage(design, pageForNode),
    [design, pageForNode?.specId, pageForNode?.id],
  )
  const map = useMemo(() => buildTokenMap(pageTokens), [pageTokens])

  const colorTokens = useMemo(
    () => Object.entries(pageTokens.color ?? {}).map(([k, v]) => ({ key: `$color.${k}`, color: v })),
    [pageTokens.color],
  )
  const radiusTokens = useMemo(() => Object.entries(pageTokens.radius ?? {}), [pageTokens.radius])

  if (selectedIds.length === 0) {
    return <ProjectInfo />
  }
  if (selectedIds.length > 1) {
    return (
      <div className="empty">
        <div className="empty-title">已选中 {selectedIds.length} 个元素</div>
        <div className="empty-desc">多选状态下暂不支持批量编辑属性</div>
      </div>
    )
  }
  if (!found) {
    return <div className="empty"><div className="empty-title">元素不存在</div></div>
  }

  const node = found.node
  const l: Layout = node.layout ?? {}
  const s: Style = node.style ?? {}

  const setLayout = (patch: Partial<Layout>, key: string) =>
    update(node.id, '调整布局', (n) => ({ ...n, layout: { ...(n.layout ?? {}), ...patch } }), `layout:${node.id}:${key}`)

  const setStyle = (patch: Partial<Style>, key: string) =>
    update(node.id, '调整样式', (n) => ({ ...n, style: { ...(n.style ?? {}), ...patch } }), `style:${node.id}:${key}`)

  const setProp = (key: string, value: unknown, label = '修改内容') =>
    update(node.id, label, (n) => ({ ...n, props: { ...(n.props ?? {}), [key]: value } }), `prop:${node.id}:${key}`)

  const setFont = (patch: NonNullable<Style['font']>, key: string) =>
    update(
      node.id,
      '调整文字',
      (n) => ({ ...n, style: { ...(n.style ?? {}), font: { ...(n.style?.font ?? {}), ...patch } } }),
      `font:${node.id}:${key}`,
    )

  const isFlex = l.mode === 'flex' || l.mode === 'grid'

  return (
    <div>
      {/* ------- 元素标识 ------- */}
      <div className="block">
        <div className="field">
          <div className="field-label">
            <span>名称</span>
            <span className="flex-1" />
            <span className="badge">{node.type}</span>
          </div>
          <input
            className="input"
            style={{ height: 26, fontSize: 11 }}
            value={node.name ?? ''}
            placeholder={node.type}
            onChange={(e) => update(node.id, '重命名元素', (n) => ({ ...n, name: e.target.value }), `name:${node.id}`)}
          />
        </div>
      </div>

      {/* ------- 布局 ------- */}
      <div className="block">
        <div className="block-title">布局</div>

        <div className="seg-row" style={{ marginBottom: 'var(--sp-2)' }}>
          {(['absolute', 'flex', 'grid'] as const).map((m) => (
            <button
              key={m}
              className={l.mode === m || (!l.mode && m === 'absolute') ? 'active' : ''}
              onClick={() => setLayout({ mode: m }, 'mode')}
            >
              {m === 'absolute' ? '自由' : m === 'flex' ? '弹性' : '网格'}
            </button>
          ))}
        </div>

        <div className="prop-grid" style={{ marginBottom: 'var(--sp-2)' }}>
          <NumField k="X" value={l.x} onChange={(v) => setLayout({ x: v }, 'x')} />
          <NumField k="Y" value={l.y} onChange={(v) => setLayout({ y: v }, 'y')} />
        </div>

        <div className="prop-grid" style={{ marginBottom: 'var(--sp-2)' }}>
          <div className="mini-field">
            <span className="k">W</span>
            <input
              value={typeof l.width === 'number' ? l.width : ''}
              placeholder="fill"
              onChange={(e) => {
                const v = e.target.value
                setLayout({ width: v === '' ? undefined : /^\d+$/.test(v) ? Number(v) : (v as never) }, 'w')
              }}
            />
          </div>
          <div className="mini-field">
            <span className="k">H</span>
            <input
              value={typeof l.height === 'number' ? l.height : ''}
              placeholder="fit"
              onChange={(e) => {
                const v = e.target.value
                setLayout({ height: v === '' ? undefined : /^\d+$/.test(v) ? Number(v) : (v as never) }, 'h')
              }}
            />
          </div>
        </div>

        <div className="seg-row" style={{ marginBottom: 'var(--sp-2)' }}>
          {(['fill', 'fit', 'auto'] as const).map((w) => (
            <button key={w} className={l.width === w ? 'active' : ''} onClick={() => setLayout({ width: w }, 'wq')}>
              {w === 'fill' ? '撑满' : w === 'fit' ? '适应' : '自动'}
            </button>
          ))}
        </div>

        {isFlex && (
          <>
            <div className="seg-row" style={{ marginBottom: 'var(--sp-2)' }}>
              {(['row', 'column'] as const).map((d) => (
                <button key={d} className={l.direction === d ? 'active' : ''} onClick={() => setLayout({ direction: d }, 'dir')}>
                  {d === 'row' ? '横向' : '纵向'}
                </button>
              ))}
            </div>
            <div className="seg-row" style={{ marginBottom: 'var(--sp-2)' }}>
              {(['start', 'center', 'end', 'between'] as const).map((j) => (
                <button key={j} className={l.justify === j ? 'active' : ''} onClick={() => setLayout({ justify: j }, 'jc')} title={`主轴 ${j}`}>
                  {j === 'start' ? '⇤' : j === 'center' ? '⇔' : j === 'end' ? '⇥' : '↔'}
                </button>
              ))}
            </div>
            <div className="seg-row" style={{ marginBottom: 'var(--sp-2)' }}>
              {(['start', 'center', 'end', 'stretch'] as const).map((a) => (
                <button key={a} className={l.align === a ? 'active' : ''} onClick={() => setLayout({ align: a }, 'ai')} title={`交叉轴 ${a}`}>
                  {a === 'start' ? '⇡' : a === 'center' ? '⇕' : a === 'end' ? '⇣' : '⇱'}
                </button>
              ))}
            </div>
            <NumField k="GAP" value={l.gap} onChange={(v) => setLayout({ gap: v }, 'gap')} />
          </>
        )}

        <div className="block-title" style={{ marginTop: 'var(--sp-3)' }}>
          内边距
        </div>
        <div className="prop-grid">
          <NumField k="T" value={l.padding?.t} onChange={(v) => setLayout({ padding: { ...(l.padding ?? {}), t: v } }, 'pt')} />
          <NumField k="B" value={l.padding?.b} onChange={(v) => setLayout({ padding: { ...(l.padding ?? {}), b: v } }, 'pb')} />
          <NumField k="L" value={l.padding?.l} onChange={(v) => setLayout({ padding: { ...(l.padding ?? {}), l: v } }, 'pl')} />
          <NumField k="R" value={l.padding?.r} onChange={(v) => setLayout({ padding: { ...(l.padding ?? {}), r: v } }, 'pr')} />
        </div>
      </div>

      {/* ------- 外观 ------- */}
      <div className="block">
        <div className="block-title">外观</div>
        <ColorField
          label="填充"
          value={typeof s.fill === 'string' ? s.fill : undefined}
          onChange={(v) => setStyle({ fill: v }, 'fill')}
          tokens={colorTokens}
        />
        <ColorField
          label="描边颜色"
          value={typeof s.stroke?.color === 'string' ? s.stroke.color : undefined}
          onChange={(v) => setStyle({ stroke: { ...(s.stroke ?? { width: 1 }), color: v } }, 'stroke')}
          tokens={colorTokens}
        />
        <div className="prop-grid" style={{ marginBottom: 'var(--sp-2)' }}>
          <NumField
            k="BW"
            value={s.stroke?.width}
            onChange={(v) => setStyle({ stroke: { ...(s.stroke ?? {}), width: v } }, 'bw')}
          />
          <NumField k="OP%" value={s.opacity != null ? Math.round(s.opacity * 100) : undefined} onChange={(v) => setStyle({ opacity: v != null ? v / 100 : undefined }, 'op')} />
        </div>

        <div className="field-label" style={{ marginBottom: 5 }}>
          <span>圆角</span>
        </div>
        <div className="mini-field" style={{ marginBottom: 6 }}>
          <span className="k">R</span>
          <input
            value={typeof s.radius === 'number' ? s.radius : typeof s.radius === 'string' ? s.radius : ''}
            placeholder="8 或 $radius.md"
            onChange={(e) => {
              const v = e.target.value
              setStyle({ radius: v === '' ? undefined : /^\d+$/.test(v) ? Number(v) : (v as never) }, 'radius')
            }}
          />
        </div>
        <div className="token-chips">
          {radiusTokens.map(([k]) => (
            <button key={k} className="token-chip" onClick={() => setStyle({ radius: `$radius.${k}` }, 'radius')}>
              {k} · {typeof pageTokens.radius?.[k] === 'number' ? `${pageTokens.radius[k]}px` : ''}
            </button>
          ))}
        </div>
      </div>

      {/* ------- 文字 ------- */}
      {(node.type === 'text' || (node.style?.font && Object.keys(node.style.font).length > 0)) && (
        <div className="block">
          <div className="block-title">文字</div>
          <div className="prop-grid" style={{ marginBottom: 'var(--sp-2)' }}>
            <NumField k="SZ" value={s.font?.size} onChange={(v) => setFont({ size: v }, 'size')} />
            <NumField k="WT" value={s.font?.weight} step={100} onChange={(v) => setFont({ weight: v }, 'weight')} />
            <NumField k="LH" value={s.font?.lineHeight} onChange={(v) => setFont({ lineHeight: v }, 'lh')} />
            <NumField k="LS" value={s.font?.letterSpacing} step={0.1} onChange={(v) => setFont({ letterSpacing: v }, 'ls')} />
          </div>
          <div className="seg-row" style={{ marginBottom: 'var(--sp-2)' }}>
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} className={s.textAlign === a ? 'active' : ''} onClick={() => setStyle({ textAlign: a }, 'ta')}>
                {a === 'left' ? '左' : a === 'center' ? '中' : '右'}
              </button>
            ))}
          </div>
          <ColorField
            label="文字颜色"
            value={typeof s.textColor === 'string' ? s.textColor : undefined}
            onChange={(v) => setStyle({ textColor: v }, 'tc')}
            tokens={colorTokens}
          />
        </div>
      )}

      {/* ------- 内容 ------- */}
      <ContentProps node={node} setProp={setProp} />

      {/* ------- 页面跳转 ------- */}
      <Interaction node={node} />
    </div>
  )
}

/* ---------------------------- 内容属性 ---------------------------- */

function ContentProps({ node, setProp }: { node: Node; setProp: (k: string, v: unknown, label?: string) => void }) {
  const p = (node.props ?? {}) as Record<string, unknown>
  const str = (k: string) => (p[k] == null ? '' : String(p[k]))

  switch (node.type) {
    case 'text':
      return (
        <div className="block">
          <div className="block-title">内容</div>
          <textarea
            className="textarea"
            style={{ minHeight: 70, fontSize: 11 }}
            value={str('content')}
            onChange={(e) => setProp('content', e.target.value)}
            placeholder="输入文本内容"
          />
        </div>
      )
    case 'button':
      return (
        <div className="block">
          <div className="block-title">内容</div>
          <TextField k="文字" value={str('label')} onChange={(v) => setProp('label', v)} />
          <div className="seg-row" style={{ marginTop: 6 }}>
            {(['primary', 'ghost'] as const).map((v) => (
              <button key={v} className={p.variant === v ? 'active' : ''} onClick={() => setProp('variant', v)}>
                {v === 'primary' ? '主按钮' : '次要'}
              </button>
            ))}
          </div>
        </div>
      )
    case 'input':
    case 'textarea':
      return (
        <div className="block">
          <div className="block-title">内容</div>
          <div className="field" style={{ marginBottom: 8 }}>
            <div className="field-label"><span>占位提示</span></div>
            <input
              className="input"
              style={{ height: 26, fontSize: 11 }}
              value={str('placeholder')}
              onChange={(e) => setProp('placeholder', e.target.value)}
            />
          </div>
          <div className="field">
            <div className="field-label"><span>已填值</span></div>
            <input
              className="input"
              style={{ height: 26, fontSize: 11 }}
              value={str('value')}
              onChange={(e) => setProp('value', e.target.value)}
            />
          </div>
        </div>
      )
    case 'image':
      return (
        <div className="block">
          <div className="block-title">图片</div>
          <div className="field">
            <div className="field-label"><span>图片地址</span></div>
            <input
              className="input"
              style={{ height: 26, fontSize: 11 }}
              value={str('src')}
              placeholder="https://… 或本地路径"
              onChange={(e) => setProp('src', e.target.value)}
            />
          </div>
          <div className="field-hint">留空时显示占位图。支持 http(s) 与 data URI</div>
        </div>
      )
    case 'badge':
    case 'tag':
    case 'chip':
      return (
        <div className="block">
          <div className="block-title">内容</div>
          <TextField k="标签" value={str('label')} onChange={(v) => setProp('label', v)} />
        </div>
      )
    case 'avatar':
      return (
        <div className="block">
          <div className="block-title">内容</div>
          <TextField k="文字" value={str('initials')} onChange={(v) => setProp('initials', v)} placeholder="如：李" />
        </div>
      )
    case 'progress':
      return (
        <div className="block">
          <div className="block-title">进度</div>
          <NumField k="%" value={Number(p.value ?? 60)} onChange={(v) => setProp('value', v ?? 0)} />
        </div>
      )
    case 'checkbox':
    case 'radio':
    case 'switch':
      return (
        <div className="block">
          <div className="block-title">状态</div>
          <label className="check-row">
            <input type="checkbox" checked={!!p.checked} onChange={(e) => setProp('checked', e.target.checked)} />
            <span>选中状态</span>
          </label>
        </div>
      )
    case 'chart':
      return (
        <div className="block">
          <div className="block-title">数据</div>
          <TextField
            k="数值"
            value={((p.dataset as number[]) ?? []).join(',')}
            onChange={(v) =>
              setProp(
                'dataset',
                v
                  .split(',')
                  .map((x) => Number(x.trim()))
                  .filter((x) => !Number.isNaN(x)),
              )
            }
            placeholder="12,18,15,24"
          />
          <div className="field-hint" style={{ marginTop: 4 }}>逗号分隔的数字序列</div>
        </div>
      )
    case 'navbar':
      return (
        <div className="block">
          <div className="block-title">标题</div>
          <TextField k="标题" value={str('title')} onChange={(v) => setProp('title', v)} />
        </div>
      )
    default:
      return null
  }
}

/* ---------------------------- 交互跳转 ---------------------------- */

function Interaction({ node }: { node: Node }) {
  const design = useProjectStore((s) => s.design)
  const commit = useProjectStore((s) => s.commit)

  const flows = design.flows.filter((f) => f.from === node.id)

  const addFlow = (toPage: string) => {
    commit('添加页面跳转', (d) => {
      d.flows = [
        ...d.flows,
        {
          id: `flow_${Date.now().toString(36)}`,
          from: node.id,
          fromPage: d.pages.find((p) => patchContains(p.root, node.id))?.id ?? d.pages[0].id,
          to: toPage,
          trigger: 'click',
          transition: 'slide-left',
        },
      ]
      return d
    })
  }

  const removeFlow = (id: string) => {
    commit('删除页面跳转', (d) => {
      d.flows = d.flows.filter((f) => f.id !== id)
      return d
    })
  }

  return (
    <div className="block">
      <div className="block-title">
        <span>点击跳转</span>
        <span className="flex-1" />
      </div>

      {flows.length === 0 && <div className="field-hint">点击该元素时跳转到指定页面</div>}

      {flows.map((f) => (
        <div key={f.id} className="list-item" style={{ padding: '5px 6px' }}>
          <span className="badge badge-brand">→</span>
          <span className="flex-1 title">{design.pages.find((p) => p.id === f.to)?.name ?? '未知页面'}</span>
          <Button variant="ghost" size="sm" iconOnly onClick={() => removeFlow(f.id)} title="删除跳转">
            <IconTrash size={11} />
          </Button>
        </div>
      ))}

      <div style={{ marginTop: 6 }}>
        <select
          className="select"
          style={{ height: 26, fontSize: 11 }}
          value=""
          onChange={(e) => e.target.value && addFlow(e.target.value)}
        >
          <option value="">+ 添加跳转目标…</option>
          {design.pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function patchContains(root: Node, id: string): boolean {
  if (root.id === id) return true
  return root.children?.some((c) => patchContains(c, id)) ?? false
}

/* ---------------------------- 无选中：项目信息 ---------------------------- */

function ProjectInfo() {
  const design = useProjectStore((s) => s.design)
  const renameProject = useProjectStore((s) => s.renameProject)
  const commit = useProjectStore((s) => s.commit)

  // F-ST-01：项目信息面板展示「项目级生效规范」的 Token（未绑定时即 design.tokens）
  const projTokens = useMemo(
    () => tokensForPage(design, null),
    [design, design.meta.specId, design.specs, design.tokens],
  )
  const map = useMemo(() => buildTokenMap(projTokens), [projTokens])
  const boundSpec = useMemo(() => resolveSpecForPage(design, null), [design, design.meta.specId, design.specs])

  const totalNodes = design.pages.reduce((sum, p) => sum + countNodes(p.root), 0)
  const colorCount = Object.keys(projTokens.color ?? {}).length

  return (
    <div>
      <div className="block">
        <div className="block-title">项目</div>
        <div className="field">
          <div className="field-label"><span>名称</span></div>
          <input
            className="input"
            style={{ height: 26, fontSize: 11 }}
            value={design.meta.name}
            onChange={(e) =>
              commit('重命名项目', (d) => {
                d.meta.name = e.target.value
                return d
              }, { coalesceKey: 'rename-project' })
            }
          />
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <div className="field-label"><span>描述 / 生成提示词</span></div>
          <textarea
            className="textarea"
            style={{ minHeight: 56, fontSize: 11 }}
            value={design.meta.prompt ?? ''}
            placeholder="记录该项目要表达什么"
            onChange={(e) =>
              commit('修改项目描述', (d) => {
                d.meta.prompt = e.target.value
                return d
              }, { coalesceKey: 'edit-prompt' })
            }
          />
        </div>
      </div>

      <div className="block">
        <div className="block-title">统计</div>
        <Line k="页面数" v={String(design.pages.length)} />
        <Line k="元素总数" v={String(totalNodes)} />
        <Line k="跳转关系" v={String(design.flows.length)} />
        <Line k="颜色 Token" v={String(colorCount)} />
        <Line k="画布尺寸" v={`${design.meta.canvas.width} × ${design.meta.canvas.height}`} />
        <Line k="设备" v={design.meta.device} />
      </div>

      <div className="block">
        <div className="block-title">设计规范</div>
        <Line k="当前规范" v={boundSpec ? boundSpec.name : '未绑定'} />
        <Line k="来源" v={boundSpec ? (boundSpec.source === 'builtin' ? '内置' : boundSpec.source === 'derived' ? '派生' : '导入') : '项目自带 Token'} />
      </div>

      <div className="block">
        <div className="block-title">设计 Token</div>
        <div className="token-chips">
          {Object.entries(projTokens.color ?? {}).map(([k, v]) => (
            <span key={k} className="token-chip" title={`$color.${k} = ${v}`}>
              <i style={{ background: v }} />
              {k}
            </span>
          ))}
        </div>
        <div className="field-hint" style={{ marginTop: 8 }}>
          {boundSpec
            ? '该规范已绑定到项目：改 Token 会写入项目 Token，规范本身不受影响'
            : '修改 Token 会同步影响所有引用它的元素'}
        </div>
        <div style={{ marginTop: 8 }}>
          <div className="field-label"><span>主色</span></div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
            <span
              className="color-swatch"
              style={{ background: map.color.primary ?? '#3b82f6' }}
            >
              <input
                type="color"
                value={map.color.primary ?? '#3b82f6'}
                onChange={(e) =>
                  commit('修改主色', (d) => {
                    d.tokens.color = { ...(d.tokens.color ?? {}), primary: e.target.value }
                    return d
                  }, { coalesceKey: 'token-primary' })
                }
              />
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>
              {map.color.primary ?? '#3b82f6'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
      <span style={{ color: 'var(--text-3)' }}>{k}</span>
      <span className="mono" style={{ color: 'var(--text-2)' }}>{v}</span>
    </div>
  )
}

function countNodes(node: Node): number {
  return 1 + (node.children?.reduce((s, c) => s + countNodes(c), 0) ?? 0)
}
