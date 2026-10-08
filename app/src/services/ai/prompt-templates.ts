// src/services/ai/prompt-templates.ts
// Prompt 编排：三阶段流水线（A 规划 / B Token 定稿 / C 逐页生成）
// 严格对应 docs/S2-5-LLM接入与Prompt方案.md
import type { AdapterId } from '@shared/design'

export const TEMP = {
  plan: 0.4,
  tokens: 0.3,
  page: 0.6,
  enhance: 0.25,
  edit: 0.2,
  variant: 0.85,
  repair: 0.1,
} as const

/** 设计 JSON 的精简说明（喂给模型，控制上下文长度） */
export const SCHEMA_BRIEF = `你输出的 JSON 必须符合以下结构（只输出 JSON，不要任何解释、不要 Markdown 代码围栏）：

{
  "schemaVersion": "1.1",
  "meta": { "id": "proj_x", "name": "项目名", "device": "MOBILE|TABLET|DESKTOP", "canvas": { "width": 390, "height": 844 }, "createdAt": "ISO", "updatedAt": "ISO", "source": "ai", "prompt": "原始需求" },
  "tokens": {
    "color": { "primary": "#3B82F6", "onPrimary": "#FFFFFF", "bg": "#FFFFFF", "surface": "#F9FAFB", "surfaceAlt": "#F3F4F6", "border": "#E5E7EB", "text": "#111827", "textSecondary": "#6B7280", "textMuted": "#9CA3AF", "success": "#10B981", "warning": "#F59E0B", "danger": "#EF4444" },
    "font": { "h1": { "family": "Inter", "size": 28, "weight": 700, "lineHeight": 36 }, "h2": { "family": "Inter", "size": 22, "weight": 600, "lineHeight": 30 }, "body": { "family": "Inter", "size": 15, "weight": 400, "lineHeight": 22 }, "caption": { "family": "Inter", "size": 13, "weight": 400, "lineHeight": 18 } },
    "space": { "xs": 4, "sm": 8, "md": 16, "lg": 24, "xl": 32 },
    "radius": { "sm": 6, "md": 10, "lg": 16, "full": 999 }
  },
  "assets": [],
  "pages": [ { "id": "page_home", "name": "首页", "order": 0, "pos": { "x": 0, "y": 0 }, "background": "$color.bg", "root": NODE } ],
  "flows": [ { "id": "flow_1", "from": "节点id", "fromPage": "page_home", "to": "page_detail", "trigger": "click", "transition": "slide-left" } ]
}

NODE 结构：
{
  "id": "唯一id（英文小写下划线）",
  "type": "frame|text|button|input|image|icon|card|list|listItem|navbar|tabbar|badge|tag|avatar|divider|progress|chart|searchbar|checkbox|radio|switch|select|shape",
  "name": "中文可读名称",
  "layout": { "mode": "flex|absolute|grid", "direction": "row|column", "width": "fill|fit|数字", "height": "fill|fit|数字", "gap": 数字, "justify": "start|center|end|between", "align": "start|center|end|stretch", "padding": { "t": 0, "r": 0, "b": 0, "l": 0 }, "grow": 数字, "x": 数字, "y": 数字 },
  "style": { "fill": "#HEX 或 $color.xxx", "stroke": { "color": "#HEX", "width": 1 }, "radius": 数字或 "$radius.md", "font": { "size": 15, "weight": 400, "lineHeight": 22 }, "textColor": "#HEX 或 $color.xxx", "textAlign": "left|center|right", "opacity": 1, "shadow": [{ "x": 0, "y": 4, "blur": 16, "color": "rgba(0,0,0,0.08)" }] },
  "props": { },
  "children": [ NODE ]
}

各 type 的 props：
- text: { "content": "文本" }
- button: { "label": "按钮文字", "variant": "primary|ghost" }
- input: { "placeholder": "占位文字" }
- image: { "src": "可留空" }
- badge/tag: { "label": "标签文字" }
- avatar: { "initials": "李" }
- progress: { "value": 60 }
- chart: { "dataset": [12,18,24] }
- navbar: { "title": "标题" }
- tabbar: { "items": ["首页","发现","我的"] }

硬性规则：
1. 颜色尽量使用 "$color.xxx" 引用 Token，半径使用 "$radius.xxx"，保持一致性与可全局换肤。
2. 根节点必须是 frame，layout.mode 用 "flex"，direction "column"，width/height "fill"。
3. 页面高度固定为画布高度，内容用 flex 纵向排布，不要试图用绝对坐标堆叠。
4. 每个元素的 id 在文档内唯一。
5. 所有 children 必须嵌套在正确的父节点内。
6. 只输出一个 JSON 对象。`

/* ------------------------- 阶段 A：信息架构规划 ------------------------- */

export function buildPlanPrompt(userPrompt: string, deviceHint?: string): string {
  return `你是一名资深产品设计师。请为下面的产品需求规划页面信息架构。

需求：
"""
${userPrompt}
"""
${deviceHint ? `\n设备倾向：${deviceHint}` : ''}

请输出严格的 JSON（不要任何解释、不要代码围栏），结构如下：
{
  "projectName": "简短项目名（不超过 12 字）",
  "device": "MOBILE 或 TABLET 或 DESKTOP",
  "canvas": { "width": 数字, "height": 数字 },
  "styleDirection": "用一句话说明视觉风格（色彩倾向、气质）",
  "pages": [
    { "id": "英文小写下划线", "name": "中文页面名", "purpose": "这个页面解决什么问题", "keySections": ["区块1", "区块2", "区块3"] }
  ],
  "flows": [ { "from": "源页面id", "to": "目标页面id", "trigger": "什么操作触发" } ]
}

要求：
- 页面数量控制在 2 ~ 6 个，覆盖需求中的核心场景。
- 每个页面列出 3 ~ 6 个关键区块，自上而下排列。
- device 与 canvas 匹配：MOBILE 390×844，TABLET 834×1112，DESKTOP 1440×900。`
}

/* ---------------------- 阶段 B：设计 Token 定稿 ---------------------- */

export function buildTokensPrompt(plan: unknown, userPrompt: string): string {
  return `你是一名资深 UI 设计师。下面是产品的信息架构规划，请为它定稿一套完整的设计 Token。

原始需求：
"""
${userPrompt}
"""

信息架构：
${JSON.stringify(plan, null, 2)}

请输出严格的 JSON（不要解释、不要代码围栏）：
{
  "color": { "primary": "#HEX", "primaryHover": "#HEX", "primarySoft": "#HEX", "onPrimary": "#HEX", "bg": "#HEX", "surface": "#HEX", "surfaceAlt": "#HEX", "border": "#HEX", "text": "#HEX", "textSecondary": "#HEX", "textMuted": "#HEX", "success": "#HEX", "warning": "#HEX", "danger": "#HEX" },
  "font": { "h1": {...}, "h2": {...}, "body": {...}, "caption": {...} },
  "space": { "xs": 4, "sm": 8, "md": 16, "lg": 24, "xl": 32 },
  "radius": { "sm": 6, "md": 10, "lg": 16, "full": 999 }
}

要求：
- 颜色必须是合法的 6 位 HEX（如 #3B82F6），确保文字与背景对比度 ≥ 4.5:1。
- 只输出这一套 Token，后续所有页面都会引用它，保证跨页一致。`
}

/* ------------------------ 阶段 C：逐页生成 ------------------------ */

export function buildPagePrompt(args: {
  userPrompt: string
  plan: unknown
  tokens: unknown
  page: { id: string; name: string; purpose?: string; keySections?: string[] }
  canvas: { width: number; height: number }
  device: string
  /** 已生成页面的骨架摘要，帮助模型判断跳转目标 */
  existingPages: Array<{ id: string; name: string }>
  /**
   * F-ST-01：绑定设计规范时注入的约束段落（禁止项/应当项）。
   * 由 specConstraintsForPrompt(spec) 生成；未绑定规范时为空字符串。
   */
  specConstraints?: string
}): string {
  const { userPrompt, plan, tokens, page, canvas, device, existingPages, specConstraints } = args

  return `你是一名资深 UI 设计工程师。请严格依据已定稿的设计 Token，生成**单个页面**的 Design JSON。

原始需求：
"""
${userPrompt}
"""

设计 Token（必须复用这些值，不要自创颜色）：
${JSON.stringify(tokens, null, 2)}
${specConstraints ? `\n${specConstraints}\n` : ''}
页面规划：
${JSON.stringify(page, null, 2)}

画布：${device}，${canvas.width} × ${canvas.height}
其它页面（用于配置跳转目标）：${JSON.stringify(existingPages)}

${SCHEMA_BRIEF}

本次只需生成一个页面，输出结构为：
{
  "page": { "id": "${page.id}", "name": "${page.name}", "order": ${0}, "pos": { "x": 0, "y": 0 }, "background": "$color.bg", "root": NODE },
  "flows": [ { "from": "本页内某个可点击元素的id", "to": "目标页面id", "trigger": "click", "transition": "slide-left" } ]
}

页面内容要求：
- keySections 里的每个区块都要在 root.children 中有对应的 frame 节点。
- 自上而下按区块顺序排列，间距使用 Token 中的 space 值。
- 至少包含 1 个可点击元素（button 或 listItem），用于配置页面跳转。
- 文本内容要贴合需求，写具体的中文文案，不要用 lorem ipsum。
- 只输出 JSON。`
}

/* ------------------------ 修复 Prompt ------------------------ */

export function buildRepairPrompt(rawOutput: string, error: string, schemaBrief = SCHEMA_BRIEF): string {
  return `你上一次输出的 JSON 存在错误，需要修复。

错误信息：
${error}

你上次的输出（可能被截断或格式错误）：
"""
${rawOutput.slice(0, 6000)}
"""

请修正上述错误，重新输出**修正后的完整 JSON**。只输出 JSON，不要任何解释、不要代码围栏。

${schemaBrief}`
}

/* ------------------------ 提示词增强器 ------------------------ */

export const ENHANCER_SYSTEM = `你是一名「需求转译专家」。用户会用口语化、碎片化的方式描述他想要的产品界面，你的任务是在**完全保留原始意图**的前提下，把它改写为结构化、专业、无歧义的设计需求描述，供后续 AI 生成界面使用。

【改写规则】
1. 补全上下文：明确产品类型、目标用户、使用场景。
2. 规范表述：把口语转成设计术语（"好看点" → "视觉层级清晰、留白充足"）。
3. 消除歧义：把模糊量词具体化（"几个" → "3 个"），但不要凭空添加用户没提的核心功能。
4. 保留原意：不得改变、删除或增加用户的核心诉求；不确定的地方标注 [推断]。
5. 冲突标注：如果需求内部有矛盾，用 [冲突] 标出并给出建议。
6. 结构化：严格按下面的 8 个区块输出。

【输出格式】
## 1. 产品概述
一句话说明这是什么产品。

## 2. 目标用户与场景
谁会用它、在什么情况下用。

## 3. 页面结构
按顺序列出需要的页面，每行一个，格式：「页面名」— 该页面的作用。

## 4. 各页面关键区块
每个页面下列出 3~6 个自上而下的区块。

## 5. 核心交互
用户的关键操作路径与页面跳转关系。

## 6. 视觉风格
色彩倾向、气质、圆角与间距偏好（如用户未指定，标注 [推断] 并给出合理默认）。

## 7. 设备与尺寸
手机端 / 平板 / 桌面端，以及理由（未指定则 [推断]）。

## 8. 待确认事项
用户描述中不明确、需要进一步确认的点；若无则写"无"。

【要求】
- 直接输出上述 Markdown，不要任何额外说明、不要代码围栏包裹整体。
- 语言与用户输入一致（中文输入用中文输出）。
- 不发明用户没提的核心业务功能。`

export function buildEnhanceUserPrompt(raw: string): string {
  return `请把下面的需求改写为结构化的设计需求描述：

"""
${raw}
"""`
}

/* ------------------------ 对话式编辑 ------------------------ */

export function buildEditPrompt(design: unknown, instruction: string, selectedIds: string[]): string {
  return `你是 Design JSON 编辑助手。用户想修改当前设计。

当前设计（完整 JSON）：
${JSON.stringify(design)}

用户选中的元素 id：${JSON.stringify(selectedIds)}
用户指令："""
${instruction}
"""

请输出一个 JSON 补丁（JSON Patch 风格，但用简化语义）：
{
  "ops": [
    { "op": "update", "id": "节点id", "style": { ...仅需修改的字段 }, "layout": { ... }, "props": { ... } },
    { "op": "add", "parent": "父节点id", "index": 0, "node": NODE },
    { "op": "remove", "id": "节点id" },
    { "op": "replaceContent", "id": "节点id", "content": "新文本" }
  ],
  "explanation": "一句话说明你做了什么"
}

只输出 JSON。只做用户要求的最小修改，不要顺手改动其它内容。
${SCHEMA_BRIEF}`
}
