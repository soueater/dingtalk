/**
 * 短 id 生成 —— 主进程与渲染进程共用的唯一实现。
 *
 * 为何不用 `crypto.randomUUID()`：打包后以 `file://` 协议加载的渲染层里它不可用，
 * 而主进程侧又需要生成同一风格的 id（复制项目时重排页面/节点 id），
 * 故统一到此模块，由 `src/lib/id.ts` 转发给渲染层既有引用。
 *
 * 形态：`<前缀>_<时间戳36进制><自增计数><6位随机>`，如 `page_m1x2k3a7f9q2z`。
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

let counter = 0

export function uid(prefix = ''): string {
  counter = (counter + 1) % 100000
  const t = Date.now().toString(36)
  let r = ''
  for (let i = 0; i < 6; i++) r += ALPHABET[(Math.random() * ALPHABET.length) | 0]
  const raw = `${t}${counter.toString(36)}${r}`
  return prefix ? `${prefix}_${raw}` : raw
}

/** 语义化 id：`page_home` 这种，便于阅读导出的 JSON */
export function slugId(text: string, fallback = 'item'): string {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || fallback
}

/**
 * 生成一个在本批次内不重复的 id。
 * 单纯 `uid()` 依赖时间戳+随机，理论上存在极小概率碰撞；
 * 跨进程（主进程复制项目）时更需显式去重，故提供带占用集的版本。
 */
export function uniqueId(prefix: string, taken: Set<string>): string {
  let id = `${prefix}_${uid()}`
  let guard = 0
  while (taken.has(id) && guard++ < 1000) id = `${prefix}_${uid()}`
  taken.add(id)
  return id
}
