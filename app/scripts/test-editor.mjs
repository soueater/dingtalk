// scripts/test-editor.mjs
// 编辑内核测试：事务化提交 / 撤销重做 / 连续操作合并 / 节点增删改查。
// 这是可视化编辑的地基，任何回归都会直接破坏「拖拽 → 可撤销」的体验。
//
// 运行：node scripts/test-editor.mjs

import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { bestEffortRemove } from './_fsx.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const stubDir = path.join(root, 'scripts', '__editor_stub__')
fs.mkdirSync(stubDir, { recursive: true })

// 替身：mock/projects —— 提供确定性的最小项目，避免依赖真实 mock 数据
const stubProjects = path.join(stubDir, 'projects.js')
fs.writeFileSync(
  stubProjects,
  `function page(id, name) {
  return { id, name, order: 0, pos: { x: 0, y: 0 }, background: '#FFFFFF',
    root: { id: id + '_root', type: 'frame', children: [
      { id: id + '_title', type: 'text', text: name }
    ] } }
}
export function createDefaultProject() {
  return {
    schemaVersion: '1.0',
    meta: { id: 'proj_t', name: '测试项目', device: 'MOBILE', canvas: { width: 390, height: 844 },
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', source: 'blank' },
    tokens: { color: { primary: '#000000', bg: '#FFFFFF' } },
    assets: [],
    pages: [page('p1', '首页'), page('p2', '详情页')],
    flows: [],
  }
}
export const MOCK_PROJECTS = [{ id: 'demo', name: '示例', design: createDefaultProject() }]
`,
)

const tmp = path.join(root, 'dist', 'test', 'editor.cjs')
await build({
  entryPoints: [path.join(root, 'src', 'stores', 'project.store.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: tmp,
  logLevel: 'error',
  alias: {
    '@/services/mock/projects': stubProjects,
    '@shared/design': path.join(root, 'shared', 'design.ts'),
  },
})
// zustand 需要在 Node 下可用
const require = createRequire(import.meta.url)
const { useProjectStore } = require(tmp)

let pass = 0
let fail = 0
const failures = []
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const group = (t) => console.log(`\n${t}`)
const S = () => useProjectStore.getState()

/* ---------------- 1. 初始状态 ---------------- */

group('初始状态')
{
  const s = S()
  check('默认项目有 2 页', s.design.pages.length === 2, String(s.design.pages.length))
  check('activePageId 指向首页', s.activePageId === 'p1', s.activePageId)
  check('dirty 初始为 false', s.dirty === false)
  check('history 均为空', s.undoStack.length === 0 && s.redoStack.length === 0)
}

/* ---------------- 2. 事务化提交 ---------------- */

group('事务化提交')
{
  const before = S().design.meta.name
  S().commit('重命名', (d) => {
    d.meta.name = '新名字'
    return d
  })
  check('design 已更新', S().design.meta.name === '新名字')
  check('dirty 置为 true', S().dirty === true)
  check('入栈 1 条历史', S().undoStack.length === 1, String(S().undoStack.length))
  check('updatedAt 被刷新', S().design.meta.updatedAt !== '2024-01-01T00:00:00.000Z')
  check('原对象未被原地修改（不可变）', before === '测试项目')
}

/* ---------------- 3. 撤销 / 重做 ---------------- */

group('撤销与重做')
{
  S().undo()
  check('撤销后名称还原', S().design.meta.name === '测试项目', S().design.meta.name)
  check('undo 栈清空', S().undoStack.length === 0)
  check('redo 栈入 1 条', S().redoStack.length === 1, String(S().redoStack.length))

  S().redo()
  check('重做后名称恢复', S().design.meta.name === '新名字', S().design.meta.name)
  check('redo 栈清空', S().redoStack.length === 0)
  check('undo 栈回到 1', S().undoStack.length === 1)
}

/* ---------------- 4. 新提交清空 redo ---------------- */

group('新提交清空 redo 栈')
{
  S().undo() // 先制造一条 redo
  check('redo 栈有 1 条', S().redoStack.length === 1, String(S().redoStack.length))
  S().commit('再改', (d) => {
    d.meta.name = '第三次'
    return d
  })
  check('新提交后 redo 被清空', S().redoStack.length === 0, String(S().redoStack.length))
}

/* ---------------- 5. 连续操作合并（拖拽核心） ---------------- */

group('连续同类操作合并')
{
  const base = S().undoStack.length
  const key = 'drag:node_x'
  for (let i = 1; i <= 10; i++) {
    S().commit('拖动', (d) => {
      const n = d.pages[0].root.children[0]
      n.layout = { ...(n.layout ?? {}), margin: { top: i, right: 0, bottom: 0, left: 0 } }
      return d
    }, { coalesceKey: key })
  }
  const added = S().undoStack.length - base
  check('10 次拖动合并为 1 条历史', added === 1, `实际新增 ${added}`)

  // 一次撤销即回到拖动前
  const valBefore = S().design.pages[0].root.children[0].layout?.margin?.top ?? 0
  S().undo()
  const valAfter = S().design.pages[0].root.children[0].layout?.margin?.top ?? 0
  check('一次撤销回退整段拖动', valAfter !== valBefore, `${valBefore} → ${valAfter}`)
  check('回退到起点（无 layout）', !S().design.pages[0].root.children[0].layout)
}

/* ---------------- 6. 不同 key 不合并 ---------------- */

group('不同合并键互不干扰')
{
  const base = S().undoStack.length
  S().commit('拖A', (d) => d, { coalesceKey: 'drag:a' })
  S().commit('拖B', (d) => d, { coalesceKey: 'drag:b' })
  S().commit('拖A2', (d) => d, { coalesceKey: 'drag:a' })
  check('交替不同键 → 3 条独立历史', S().undoStack.length - base === 3, String(S().undoStack.length - base))
}

/* ---------------- 7. 历史上限 ---------------- */

group('历史上限（MAX_HISTORY=100）')
{
  S().loadMock('demo')
  const start = S().undoStack.length
  for (let i = 0; i < 130; i++) {
    S().commit(`第${i}次`, (d) => {
      d.meta.name = `n${i}`
      return d
    })
  }
  check('历史被截断到 100', S().undoStack.length === 100, String(S().undoStack.length))
  check('起点为 0（重置后）', start === 0)
}

/* ---------------- 8. 节点增删改查 ---------------- */

group('节点增删改查')
{
  // 新增：往首页根节点追加一个 button
  S().commit('添加按钮', (d) => {
    d.pages[0].root.children.push({ id: 'btn1', type: 'button', text: '确定' })
    return d
  })
  const found = S().findNode('btn1')
  check('findNode 能找到新增节点', !!found && found.node.type === 'button')
  check('findNode 返回父节点', found?.parent?.id === 'p1_root', found?.parent?.id)
  check('findNode 返回所属页面', found?.page?.id === 'p1', found?.page?.id)

  // 修改：改文案
  S().commit('改文案', (d) => {
    const n = findIn(d, 'btn1')
    n.text = '提交'
    return d
  })
  check('节点属性已更新', S().findNode('btn1')?.node.text === '提交', S().findNode('btn1')?.node.text)

  // 删除
  S().commit('删除按钮', (d) => {
    d.pages[0].root.children = d.pages[0].root.children.filter((c) => c.id !== 'btn1')
    return d
  })
  check('节点已被删除', S().findNode('btn1') === null)

  // 撤销删除
  S().undo()
  check('撤销后节点恢复', S().findNode('btn1') !== null)
  check('恢复的节点内容正确', S().findNode('btn1')?.node.text === '提交')
}

/* ---------------- 9. 选择与页面切换 ---------------- */

group('选择状态与页面切换')
{
  S().select(['n1', 'n2'])
  check('select 生效', S().selectedIds.join(',') === 'n1,n2')
  S().toggleSelect('n1')
  check('toggleSelect 取消选中', S().selectedIds.join(',') === 'n2', S().selectedIds.join(','))
  S().toggleSelect('n3')
  check('toggleSelect 追加选中', S().selectedIds.includes('n3'))

  S().select(['x'])
  S().setActivePage('p2')
  check('切页后清空选中', S().selectedIds.length === 0, S().selectedIds.join(','))
  check('activePageId 已切换', S().activePageId === 'p2')
  check('currentPage 返回对应页', S().currentPage()?.id === 'p2', S().currentPage()?.id)
}

/* ---------------- 10. 保存标记 ---------------- */

group('保存状态')
{
  S().markSaved('/tmp/a.dsproj.json')
  check('path 已记录', S().path === '/tmp/a.dsproj.json', String(S().path))
  check('dirty 复位为 false', S().dirty === false)
}

/* ---------------- 11. 载入项目重置历史 ---------------- */

group('载入项目重置历史')
{
  S().commit('制造脏数据', (d) => {
    d.meta.name = 'dirty'
    return d
  })
  S().loadProject('/tmp/b.json', { fileVersion: '1.0', design: S().design })
  check('loadProject 清空 undo', S().undoStack.length === 0)
  check('loadProject 清空 redo', S().redoStack.length === 0)
  check('loadProject 复位 dirty', S().dirty === false)
  check('activePageId 指向首页', S().activePageId === 'p1')
}

/* ------------------------------ 汇总 ------------------------------ */

function findIn(d, id) {
  let out = null
  const walk = (n) => {
    if (n.id === id) out = n
    ;(n.children ?? []).forEach(walk)
  }
  d.pages.forEach((p) => walk(p.root))
  return out
}

console.log('\n' + '─'.repeat(48))
console.log(`通过 ${pass} · 失败 ${fail}`)
if (fail) {
  console.log('\n失败项：')
  failures.forEach((f) => console.log(`  · ${f}`))
  console.log('存在失败 ✗')
  process.exit(1)
}
console.log('全部通过 ✓')
bestEffortRemove(stubDir)
