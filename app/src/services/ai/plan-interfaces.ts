// src/services/ai/plan-interfaces.ts
// 界面规划器（F-PM-05 的「阶段 0」）：先让模型给出 N 个界面的清单，再逐个生成。
//
// 为什么必须单独有这个阶段：
//   原实现把"生成几个界面"完全交给模型的自由发挥（`generate.ts` 里还有 `slice(0, 8)`
//   的硬编码截断），导致 N 不可预期、也不可配置。拆出规划阶段后，N 变成**输入**
//   而不是**结果**，用户填 5 就得到 5 个界面的清单。
//
// 本文件只负责「提示词 + 结果规整」，实际逐页生成在 generate.ts 里（复用既有链路）。
import type { Device } from '@shared/design'

export interface InterfacePlanItem {
  id: string
  name: string
  purpose?: string
  keySections?: string[]
  /** 建议归属的模块名（用于自动建分组） */
  groupName?: string
}

export interface InterfacePlanShape {
  projectName?: string
  styleDirection?: string
  pages: InterfacePlanItem[]
}

/** 界面规划提示词：把 N 作为硬约束写进指令 */
export function buildInterfacePlanPrompt(args: {
  prompt: string
  count: number
  device: Device
  existingNames: string[]
  /** 已有界面的职责摘要，帮助模型"补差异"而不是"再抄一遍" */
  existingSummary?: string
}): string {
  const { prompt, count, device, existingNames, existingSummary } = args
  const existing = existingNames.length
    ? `\n【已有界面，禁止重复生成同名或同职责的界面】\n${existingNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n${
        existingSummary ? `已有界面的职责：\n${existingSummary}\n` : ''
      }`
    : ''

  return `请为下面的产品需求规划【恰好 ${count} 个】功能界面（屏幕）。

【产品需求】
${prompt}

【目标设备】
${device}
${existing}

【输出要求】
1. 只输出 JSON，不要任何解释、不要 markdown 代码围栏。
2. pages 数组长度必须严格等于 ${count}，多一个少一个都不行。
3. 每个界面的 name 必须唯一、简短（2–6 个汉字或 12 个字符内），能一眼看出职责。
4. purpose 用一句话说明这个界面解决什么问题。
5. keySections 列出该界面必须包含的 2–5 个内容区块。
6. groupName 给出该界面所属的功能模块名（相同模块的界面用同一个名字），便于自动分组。

【输出格式】
{
  "projectName": "项目名",
  "styleDirection": "整体风格方向，一句话",
  "pages": [
    { "id": "p1", "name": "首页", "purpose": "展示个性化推荐内容", "keySections": ["顶部搜索", "推荐列表"], "groupName": "内容模块" }
  ]
}`
}

/** 校验：只要 pages 是数组即视为结构可用，长度问题由规整阶段处理 */
export function validateInterfacePlanPayload(o: unknown): { ok: boolean; errors: string[] } {
  const p = o as { pages?: unknown } | null
  if (!p || typeof p !== 'object') return { ok: false, errors: ['不是对象'] }
  if (!Array.isArray(p.pages)) return { ok: false, errors: ['缺少 pages 数组'] }
  return { ok: true, errors: [] }
}

/**
 * 把模型产出的清单规整为「恰好 count 条」。
 *  - 多了 → 截断；
 *  - 少了 → 用名称模板补齐（并标注 purpose，提醒用户这是补位项）；
 *  - 重名 → 自动加序号后缀；
 *  - 空名 / 非法项 → 丢弃后计入补位。
 */
export function normalizePlanPages(
  raw: unknown,
  count: number,
  fallbackNames?: string[],
): InterfacePlanItem[] {
  const n = Math.max(1, Math.trunc(count))
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const out: InterfacePlanItem[] = []

  const uniqueName = (name: string, index: number): string => {
    const base = (name || `界面 ${index + 1}`).trim().slice(0, 24)
    let candidate = base
    let k = 2
    while (seen.has(candidate)) candidate = `${base} ${k++}`
    seen.add(candidate)
    return candidate
  }

  for (const item of list) {
    if (out.length >= n) break
    const it = item as Partial<InterfacePlanItem> | null
    if (!it || typeof it !== 'object') continue
    const name = typeof it.name === 'string' ? it.name.trim() : ''
    if (!name) continue
    out.push({
      id: typeof it.id === 'string' && it.id ? it.id : `p${out.length + 1}`,
      name: uniqueName(name, out.length),
      purpose: typeof it.purpose === 'string' ? it.purpose : undefined,
      keySections: Array.isArray(it.keySections)
        ? it.keySections.filter((s) => typeof s === 'string').slice(0, 8)
        : undefined,
      groupName: typeof it.groupName === 'string' && it.groupName.trim() ? it.groupName.trim() : undefined,
    })
  }

  // 补位：数量不足时用调用方给的名称模板，再退化为序号
  let pad = out.length
  while (out.length < n) {
    const suggested = fallbackNames?.[pad] ?? `界面 ${pad + 1}`
    out.push({
      id: `p${pad + 1}`,
      name: uniqueName(suggested, pad),
      purpose: '（规划数量不足，已自动补位，可修改或删除）',
    })
    pad += 1
  }

  return out
}

/**
 * 按 groupName 归拢，产出「分组名 → 界面名列表」。
 * 只对出现 2 次及以上的模块名建组 —— 单屏自成一组没有意义，反而让分组列表变啰嗦。
 */
export function groupPlanItems(items: InterfacePlanItem[]): Map<string, string[]> {
  const byGroup = new Map<string, string[]>()
  for (const it of items) {
    if (!it.groupName) continue
    byGroup.set(it.groupName, [...(byGroup.get(it.groupName) ?? []), it.name])
  }
  for (const [k, v] of [...byGroup.entries()]) {
    if (v.length < 2) byGroup.delete(k)
  }
  return byGroup
}
