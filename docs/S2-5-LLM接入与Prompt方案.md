# S2-5 LLM 接入与 Prompt 工程方案

> 项目：本地客户端「望舒」
> 阶段：S2 方案设计　|　版本：v1.0　|　日期：2026-09-29
> 上游依据：`docs/S2-2-Design-JSON-Schema.md`、`docs/S2-3-组件体系与设计Token.md`、`docs/功能设计-提示词增强.md`、`analysis/S1-6-可复用性研究.md` §4.2

---

## 1. 设计目标

| 目标 | 说明 | 对应风险 |
|---|---|---|
| **多厂商可切换** | 用户自配任意模型，切换无感 | R5 厂商接口差异 |
| **输出稳定可解析** | 把「官方调优」的缺失用工程手段补回 | **R1 LLM 输出格式不稳** |
| **密钥零泄漏** | 明文只存在于主进程内存 | 安全红线 |
| **可观测** | 每次调用的耗时、token、失败原因可查 | 便于用户自助排查 |
| **增强器可独立验证** | 不依赖生成逻辑，可单独测试 | S3-3B 并行开发 |

---

## 2. 多厂商适配层

### 2.1 统一接口

```ts
// src/services/llm/types.ts
export interface ChatRequest {
  configRef: string              // 指向配置项（含 keyRef）
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean             // 要求返回 JSON（支持则开启厂商原生 JSON 模式）
  schema?: object                // 传入 JSON Schema（支持则用原生结构化输出）
  timeoutMs?: number
  stream?: boolean
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  content: string
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  model: string
  ms: number
}

// 所有适配器实现此接口
export interface LlmAdapter {
  id: string                     // 'openai' | 'anthropic' | 'gemini' | 'ollama'
  displayName: string
  /** 该适配器的预置配置模板 */
  preset: AdapterPreset
  chat(req: ChatRequest, apiKey: string): Promise<ChatResult>
  chatStream(req: ChatRequest, apiKey: string, onChunk: (d: string) => void, signal: AbortSignal): Promise<ChatResult>
  test(config: ConfigInput, apiKey: string): Promise<TestResult>
}
```

### 2.2 四种适配器

| 适配器 | 覆盖 | 接口特征 | JSON 模式 |
|---|---|---|---|
| **openai**（首选） | OpenAI / DeepSeek / 通义 / Kimi / 智谱 / 硅基流动 / 本地 vLLM 等一切 OpenAI 兼容服务 | `POST {base}/chat/completions`，`Authorization: Bearer` | `response_format: { type: 'json_object' }` |
| **anthropic** | Claude 系列 | `POST {base}/v1/messages`，`x-api-key` + `anthropic-version` | 无原生，靠 Prompt + 预填充 `{` |
| **gemini** | Google Gemini | `POST {base}/v1beta/models/{model}:generateContent`，`?key=` | `generationConfig.responseMimeType: application/json` |
| **ollama** | 本地模型 | `POST {base}/api/chat`，无鉴权 | `format: 'json'` |

### 2.3 请求体差异抹平（示例：jsonMode）

```ts
// openai 适配器
const body = {
  model: cfg.model,
  messages: req.messages,
  temperature: req.temperature ?? 0.4,
  max_tokens: req.maxTokens,
  stream: !!req.stream,
  ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
}

// anthropic 适配器 —— 无原生 JSON 模式，靠「预填充 assistant 消息」诱导
const body = {
  model: cfg.model,
  max_tokens: req.maxTokens ?? 8192,
  temperature: req.temperature ?? 0.4,
  system: systemMsg,
  messages: [
    ...userMessages,
    ...(req.jsonMode ? [{ role: 'assistant', content: '{' }] : []),  // 预填充
  ],
}
// 注意：anthropic 返回内容需在前面补回被预填充的 '{'

// ollama 适配器
const body = {
  model: cfg.model,
  messages: req.messages,
  stream: !!req.stream,
  ...(req.jsonMode ? { format: 'json' } : {}),
  options: { temperature: req.temperature ?? 0.4, num_predict: req.maxTokens },
}
```

> **关键点**：`jsonMode` 是「尽力而为」而非「强保证」。**即使厂商声称支持 JSON 模式，输出仍必须经过本地校验与修复链路**（§5）。这是 R1 风险的核心应对——不信任任何厂商的格式承诺。

### 2.4 配置面板的分步引导

对应 S2-1 §9 的 A-4 与 `docs/项目工作计划.md` S3-3A：配置面板需引导用户完成 4 步。

```
步骤 1｜选择服务商
   卡片式选择：OpenAI 兼容 / Anthropic / Gemini / Ollama / 自定义
   （选中后自动填入该服务商的默认 baseURL 与常见模型名列表）

步骤 2｜填写连接信息
   ┌ 服务商地址:  https://api.deepseek.com/v1        [恢复默认]
   ┌ API 密钥:    ••••••••••••••••  [显示] [粘贴]
   ┌ 模型名称:    deepseek-chat  ▾（可手输，下拉为常见模型）
   └ [测试连接]   → 返回：✓ 连接成功（模型: deepseek-chat，延迟 820ms）

步骤 3｜参数配置（可折叠，有默认值）
   temperature  [0.4]   ← 生成偏高（0.6-0.9），增强偏低（0.2-0.4）
   max_tokens   [8192]
   超时         [60s]
   [□] 使用流式输出

步骤 4｜保存
   配置名称: [DeepSeek 主力]      [□ 设为默认]
   → 保存（密钥经 safeStorage 加密，不落明文）
```

### 2.5 常见"接入失败"的引导文案

| 现象 | 可能原因 | 提示 |
|---|---|---|
| 401 | 密钥错误 | 「密钥无效，请检查是否复制完整（常见：多余空格、复制了两次）」 |
| 404 | baseURL 缺少 `/v1` 或多了路径 | 「地址可能不完整，多数服务需以 /v1 结尾」 |
| 403 | 无权限访问该模型 | 「当前密钥无权访问 xx 模型，请更换模型名」 |
| `model not found` | 模型名拼写错误 | 「模型名不存在，可从下拉列表选择」 |
| CORS / 连接超时 | 本地网络或代理 | 「无法连通，请检查网络或代理设置」 |
| 返回很慢 | 模型大或网络慢 | 「首次调用可能较慢，可调大超时时间」 |

---

## 3. 参数预设（生成 vs 增强）

| 场景 | temperature | max_tokens | jsonMode | 说明 |
|---|---|---|---|---|
| **原型生成（单页）** | 0.6 | 8192 | ✅ | 需要一定创造性让设计有新意 |
| **原型生成（规划）** | 0.4 | 2048 | ✅ | 规划信息架构需稳定 |
| **提示词增强** | **0.25** | 2048 | ❌（Markdown） | 低温度抑制发散，保证多次增强稳定 |
| **对话式编辑** | 0.2 | 4096 | ✅ | 改 JSON 需高精度，不能自由发挥 |
| **变体生成** | 0.85 | 8192 | ✅ | 变体就是要差异化，温度拉高 |
| **Schema 修复重试** | 0.1 | 8192 | ✅ | 修复要严格遵循，不能自由发挥 |

> **温度分层是本方案的关键工程手段**：同一份输入在不同任务下用不同温度，把「创造」与「精确」分离。这是压缩「用户任意模型」波动的重要一环。

---

## 4. 原型生成 Prompt 编排流水线

### 4.1 三阶段流水线

一次生成请求拆为三个阶段，每阶段一次独立调用（而非一次大调用生成全部）。理由：**单次调用生成多页会导致上下文过长、格式漂移概率指数上升**。

```
输入：结构化需求描述（增强后）
   │
   ▼
┌──────────────────────────────────────────────┐
│ 阶段 A｜信息架构规划                            │
│  输入：需求描述 + 令牌化 Token 基线              │
│  输出：{ pages: [{name, purpose, keyComponents}] }│
│  参数：temp 0.4, max 2048, json               │
└───────────────────┬──────────────────────────┘
                    ▼
┌──────────────────────────────────────────────┐
│ 阶段 B｜设计 Token 定稿                         │
│  输入：需求描述 + 阶段A结果 + 风格预设            │
│  输出：完整 tokens 对象（色彩/字阶/间距/圆角/阴影）│
│  参数：temp 0.3, max 2048, json               │
│  ★ 关键：Token 先定稿，后续所有页面引用它        │
└───────────────────┬──────────────────────────┘
                    ▼
┌──────────────────────────────────────────────┐
│ 阶段 C｜逐页生成（N 次调用，可并行/串行）        │
│  输入：单页规划 + tokens + NodeType 清单 + Schema│
│  输出：单个 page 节点树                         │
│  参数：temp 0.6, max 8192, json               │
│  ★ 每页生成后立即校验，失败即修复，不阻塞其他页    │
└───────────────────┬──────────────────────────┘
                    ▼
          组装为完整 Design JSON
                    ▼
           校验 → 修复 → 落盘 → 上屏
```

### 4.2 为什么「Token 先定稿」

这是解决 P-3「跨屏一致性弱」的**架构层手段**：

| 做法 | 结果 |
|---|---|
| 让模型每页自由决定配色 | 第一页电光蓝、第二页靛蓝（Stitch 现状） |
| **先定 Token，再逐页生成并强制引用** | 所有页面结构上不可能不一致——它们引用的是同一份 Token |

阶段 C 的 Prompt 里会显式注入 `tokens` 全文，并要求「样式只允许使用 `$color.*` / `$font.*` / `$space.*` / `$radius.*` / `$shadow.*` 引用或明确色值，**优先使用 Token 引用**」。生成后校验器会统计硬编码色值比例，超阈值则告警。

### 4.3 阶段 A Prompt 模板

```
【角色】
你是资深产品设计师与信息架构师。

【任务】
根据用户需求，规划这个产品应该包含哪几个页面。**只输出页面规划，不输出页面细节**。

【用户需求】
{{enhancedPrompt}}

【输出要求】
严格输出以下 JSON，不要任何解释文字、不要 Markdown 代码围栏：
{
  "productType": "产品类型（如 电商/社交/工具/金融/内容）",
  "platform": "MOBILE | TABLET | DESKTOP | RESPONSIVE",
  "canvas": { "width": 数字, "height": 数字 },
  "styleDirection": "一句话风格方向",
  "pages": [
    {
      "name": "页面名（中文，≤8字）",
      "purpose": "该页面用途（一句话）",
      "keyComponents": ["该页必需的关键组件 type 列表"]
    }
  ]
}

【约束】
- 页面数量 2~6 个，按产品复杂度决定，不要凑数
- 页面名必须具体（"订单详情" 而非 "页面2"）
- keyComponents 必须从以下合法清单中选择：
  {{nodeTypeList}}
- 移动端画布默认 390×844，桌面端 1440×900
```

### 4.4 阶段 B Prompt 模板

```
【任务】
为以下产品确定一套设计 Token。这将成为所有页面的统一视觉基准。

【产品信息】
产品类型：{{productType}}
风格方向：{{styleDirection}}
平台：{{platform}}

【可选风格预设】
{{stylePresetList}}   // 清透蓝 / 墨韵 / 暖橙 / 青碧

【输出要求】
严格输出 JSON（无围栏、无解释）：
{
  "presetName": "选用的预设名，或 'custom'",
  "tokens": {
    "color": { "primary": "#RRGGBB", "primaryHover": "...", "primaryActive": "...",
               "primarySoft": "...", "onPrimary": "...",
               "bg": "...", "surface": "...", "surfaceAlt": "...",
               "border": "...", "borderStrong": "...",
               "text": "...", "textSecondary": "...", "textMuted": "...",
               "success": "...", "warning": "...", "danger": "...", "info": "..." },
    "font": { "display": {"family":"...","size":34,"weight":700,"lineHeight":42}, ... 共8阶 },
    "space": { "xxs":2,"xs":4,"sm":8,"md":16,"lg":24,"xl":32,"xxl":48,"huge":64 },
    "radius": { "sm":6,"md":10,"lg":16,"xl":24,"full":999 },
    "shadow": { "xs":{...},"sm":{...},"md":{...},"lg":{...} }
  }
}

【约束】
- 色彩必须保证文字与背景对比度 ≥ 4.5:1
- 若用户指定了色值，必须原样保留
- 字阶行高必须大于字号
```

### 4.5 阶段 C Prompt 模板（逐页）

```
【角色】
你是精通 {{platform}} 端 UI 设计的设计师。

【任务】
生成「{{pageName}}」页面的完整设计结构。此页用途：{{pagePurpose}}。

【统一设计基准（必须遵守）】
{{tokensJSON}}

【全局设计约束】
- 平台：{{platform}}，画布 {{canvas.width}}×{{canvas.height}}
- 所有颜色优先引用 Token：如 "$color.primary"，不要写死色值
- 所有间距圆角优先引用 Token："$space.md" / "$radius.md"（也可写数字）
- 布局优先使用 flex，避免随意绝对定位
- 尺寸语义：撑满父容器用 "fill"，包裹内容用 "fit"

【合法节点类型清单】
{{nodeTypeList}}

【各类型关键 props 说明】
{{componentPropsDigest}}   // 从 S2-3 propsSchema 自动生成的摘要

【输出要求】
严格输出**单个页面对象的 root 节点** JSON（不含 pages 数组包装），无围栏无解释。
每个节点必须含：id（全局唯一字符串）、type、layout；有内容则含 props；有子元素则含 children。

【本页必须包含的关键组件】
{{pageKeyComponents}}
```

### 4.6 上下文控制策略

| 手段 | 说明 |
|---|---|
| 只注入相关组件摘要 | 不注入全部 44 个组件的完整 props，按 `keyComponents` 过滤 + 常用组件精简 |
| Schema 只注入约束片段 | 注入「字段名 + 类型 + 必填」的紧凑版，不注入完整 JSON Schema |
| 逐页独立调用 | 每页只带自己的规划 + tokens，不带其他页的节点 |
| 长需求截断 | 增强结果超长时，注入「产品目标 + 页面结构 + 风格 + 组件」四块，省略 §8 |

**目的**：控制单次请求在模型有效上下文内，避免「后文遗忘前文」导致的格式崩坏。

---

## 5. 结构化输出与容错链路

### 5.1 五级容错

```
LLM 原始文本
 ① 抽取：剥离代码围栏，定位最外层 JSON 边界（配对括号扫描，非贪心正则）
 ② 宽松解析：JSON.parse → 失败则尝试修复常见语法（尾逗号、单引号、中文引号、注释）
 ③ 结构校验（宽松档）：必需字段 + 类型 + 枚举
 ④ 语义修补：
      - 缺 id → 按 type + 序号生成稳定 id
      - 缺 layout → 按 type 默认布局补
      - 枚举越界 → 映射到最近合法值
      - Token 引用失效 → 回退到同语义默认值
      - 硬编码色值比例过高 → 记录 warning（不阻塞）
 ⑤ 通过 → 应用；未通过 → 进入修复重试
```

### 5.2 修复重试策略

```ts
async function generateWithRepair(prompt: string, schema: object, maxRetry = 2) {
  let lastRaw = ''
  let lastErr = ''
  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    const messages = attempt === 0
      ? [{ role: 'user', content: prompt }]
      : [
          { role: 'user', content: prompt },
          { role: 'assistant', content: lastRaw },      // 模型上次的错误输出
          { role: 'user', content: buildRepairPrompt(lastErr) },  // 精确指出错在哪
        ]
    const res = await adapter.chat({
      messages, temperature: attempt === 0 ? 0.6 : 0.1,
      jsonMode: true, schema,
    })
    const parsed = tolerantParse(res.content)
    if (parsed.ok) {
      const validated = validateAgainstSchema(parsed.value, schema)
      if (validated.ok) return { ok: true, data: validated.value, attempts: attempt + 1 }
      lastErr = validated.reason
    } else {
      lastErr = parsed.reason
    }
    lastRaw = res.content
  }
  return { ok: false, error: lastErr, raw: lastRaw }  // 降级：保留原文供用户查看
}
```

**`buildRepairPrompt` 的设计**：不是简单说「你错了，重来」，而是**精确指出**：

```
你上一次的输出存在以下问题：
- 字段路径 pages[0].root.children[2].style.fill 的值 "#GGGGGG" 不是合法颜色
- 字段路径 pages[0].root.children[5] 缺少必需字段 "id"

请重新输出**完整**的 JSON，修正以上问题。只输出 JSON，不要解释。
```

**为什么把错误输出回传**：让模型看到自己的错误，修复成功率显著高于「盲重试」。

### 5.3 降级策略（重试仍失败）

| 情况 | 降级行为 |
|---|---|
| 阶段 A 失败 | 用内置默认信息架构（首页 + 详情 + 我的），标注「AI 规划失败，已用默认结构」 |
| 阶段 B 失败 | 用用户选定的风格预设 Token（或默认清透蓝） |
| 阶段 C 单页失败 | 该页显示骨架屏占位 + 「此页生成失败，点击重试」；其余页正常显示 |
| 全部失败 | 保留失败原文（可查看/复制），提示：改用更强模型 / 拆小需求重试 / 检查配置 |

> **原则**：**局部失败不导致整体失败**。10 页里 1 页失败，另外 9 页照常交付。

---

## 6. 提示词增强器专项设计（F-PE-01）

> 上游：`docs/功能设计-提示词增强.md`。本节省略产品层面论证，聚焦工程实现。

### 6.1 模块结构

```
src/services/prompt-enhancer/
├─ index.ts              # 主入口：enhance(rawInput, options) → EnhanceResult
├─ classifier.ts         # L0-L3 输入分级判定（纯本地）
├─ suggestor.ts          # 「智能建议」启发式判定（纯本地）
├─ term-map.ts           # 术语映射表（可扩展）
├─ prompts.ts            # system / user prompt 模板
├─ validator.ts          # 后置意图保全校验（纯本地）
└─ types.ts
```

**关键**：`classifier` / `suggestor` / `validator` / `term-map` **全部是纯本地的纯函数**，不依赖模型。只有 `prompts.ts` 驱动的那一次调用依赖 LLM。这让增强器大部分逻辑可脱离模型做单元测试。

### 6.2 输入分级判定算法（classifier.ts）

```ts
export type InputLevel = 'L0' | 'L1' | 'L2' | 'L3'

interface ClassifyResult {
  level: InputLevel
  reasons: string[]
  score: number
}

export function classify(raw: string): ClassifyResult {
  const t = raw.trim()
  const reasons: string[] = []

  // L3 判定：已含结构化特征（区块标题 / 编号列表 / 明确色值+平台）
  const hasSectionMarkers = /(^|\n)\s*(##|#|\d+[.、)]|[-*]\s)/.test(t)
  const hasExplicitColor = /#[0-9a-fA-F]{6}|rgba?\(/.test(t)
  const hasExplicitPlatform = /(移动端|桌面端|Web|小程序|App)/.test(t)
  const structuredHits = [hasSectionMarkers, hasExplicitColor, hasExplicitPlatform].filter(Boolean).length
  if (structuredHits >= 2 && t.length > 60) {
    return { level: 'L3', reasons: ['已含区块/编号结构', '已含显式色值或平台'], score: structuredHits }
  }

  // L0 判定：极短
  if (t.length <= 10) {
    return { level: 'L0', reasons: [`长度 ${t.length} ≤ 10`], score: 0 }
  }

  // L1 vs L2：口语词命中数 + 要素完整度
  const colloquial = countColloquialHits(t)
  const elementScore = countElements(t)   // 平台/页面/风格/组件 四要素命中数
  if (colloquial >= 1 || elementScore <= 1) {
    return { level: 'L1', reasons: [`口语词命中 ${colloquial}`, `要素命中 ${elementScore}/4`], score: elementScore }
  }
  return { level: 'L2', reasons: [`要素命中 ${elementScore}/4，结构松散`], score: elementScore }
}

/** 四要素识别：平台 / 页面 / 风格 / 组件 */
function countElements(t: string): number {
  let n = 0
  if (/(移动端|桌面|Web|App|小程序|平板)/.test(t)) n++
  if (/(页|界面|页面|首页|详情|列表|我的|个人中心)/.test(t)) n++
  if (/(简约|现代|可爱|商务|高级|清新|科技|复古|温暖)/.test(t)) n++
  if (/(按钮|表单|列表|卡片|图表|导航|弹窗|输入框|头像)/.test(t)) n++
  return n
}

const COLLOQUIAL_RE = /帮我|搞个|弄个|来个|那种|好看|好看点|差不多|随便|大概|好像|嗯|就是|要那种|感觉|有点|稍微|会不会|能不能/g
function countColloquialHits(t: string): number {
  return (t.match(COLLOQUIAL_RE) || []).length
}
```

### 6.3 智能建议判定（suggestor.ts）

对应 `功能设计-提示词增强.md` §2.3 的四项判定，**≥2 条命中**才提示：

```ts
export function shouldSuggest(raw: string, level: InputLevel): boolean {
  if (level === 'L3') return false          // 已结构化，不提示
  const t = raw.trim()
  const hits: boolean[] = [
    t.length < 15,                                           // ① 过短
    countColloquialHits(t) >= 1,                             // ② 高口语化
    countElements(t) < 3,                                    // ③ 缺关键要素
    !/[。！？，；\n]/.test(t) && t.length > 25,               // ④ 结构松散（无标点长串）
  ]
  return hits.filter(Boolean).length >= 2
}
```

### 6.4 System Prompt（增强器）

> 严格落地 `功能设计-提示词增强.md` §4 的 R-1~R-15。

```
【角色】
你是产品需求描述优化专家。你的唯一职责是：把用户口语化、碎片化的描述，改写为结构化、术语规范、无歧义的提示词。

【最重要的四条红线（任何情况都不得违反）】
R-1 意图保全：用户明确表达的需求，一个字都不能删、不能弱化、不能替换。
    用户说"微信支付"，就必须是"微信支付"，不能改成"在线支付"。
R-2 显式约束不可篡改：用户明确给出的色值、平台、页面名、字段名，原样保留。
R-3 不新增业务事实：绝不虚构品牌名、具体价格、真实商品名、公司信息。
    业务事实只能来自用户输入。设计层面的补全（如"卡片式布局"）是允许的。
R-4 不做需求变更：只优化"怎么说"，不改变"要什么"。
    任何你补充的、超出用户表达的内容，必须列入最后一节"待确认"，并标 [推断]。

【优化规则，按优先级适用】
第一层 保留类（R-1~R-4，见上，不可违背）
第二层 补全类（在用户未明确的地方做合理补全，且必须标注）：
  - 补全产品类型隐含的行业上下文
  - 按行业惯例补全标准页面流
  - 由页面用途推导必需组件
  - 把模糊审美词转为可执行的设计语言
第三层 规范化类：
  - 口语表述 → 设计术语
  - 散乱表达 → 固定的 8 区块结构
  - "它""这个"等指代 → 还原为具体对象
第四层 消歧类：
  - 一词多义：取最主流解释作为主方案，其余列入"待确认"
  - 检测到矛盾（如"极简"+"信息密度高"）：两者都保留，列入"待确认"标 [冲突]，绝不自行取舍
  - 无法推断的信息：列入"待确认"，不填充默认值冒充用户意图

【输出格式（必须严格遵循，不得增删区块）】
# 产品需求描述

## 1. 产品目标
（一句话：做什么、给谁用）

## 2. 目标平台
（Mobile App / Web 应用 / Tablet / 响应式，可推断则给尺寸）

## 3. 页面结构
1. 页面名 —— 用途
（逐条列出）

## 4. 核心功能
- 功能点

## 5. 视觉风格
- 风格：
- 主色：
- 气质：

## 6. 关键组件
（组件清单）

## 7. 约束与偏好
- （用户明确提到的技术/体验约束；没有则留空，不要编造）

## 8. 待确认（AI 推断项）
- [推断] 具体内容 —— 如与预期不符请修正
- [冲突] 矛盾点A 与 矛盾点B —— 请确认优先级

【增强强度】
当前档位：{{intensity}}   // 简洁 / 标准 / 详尽
- 简洁：只做规范化与消歧，最少补全
- 标准：补全 + 规范化 + 消歧，平衡
- 详尽：最大化补全信息架构与组件清单

【术语参考（用于统一表述，不代表一定要全部使用）】
{{termMapDigest}}

【硬性要求】
1. 只输出上述 Markdown，不要任何前言、解释、总结
2. 第 8 区块必须存在；若无推断项与冲突，写"（无）"
3. 用户原话中出现的具体对象（如"微信支付""蓝色""详情页"）必须出现在输出中
```

### 6.5 术语映射表结构（term-map.ts）

```ts
export interface TermMap {
  version: string
  /** 产品类型 → 标准页面流 */
  productFlows: Record<string, string[]>
  /** 口语表达 → 设计术语 */
  colloquialToTerm: Record<string, string>
  /** 审美词 → 具体设计参数描述 */
  aestheticToSpec: Record<string, string>
  /** 组件别名 → 标准 nodeType */
  componentAlias: Record<string, string>
}
```

```ts
export const TERM_MAP: TermMap = {
  version: '1.0',
  productFlows: {
    '电商': ['首页', '商品列表', '商品详情', '购物车', '订单'],
    '社交': ['动态流', '发布', '消息', '个人主页'],
    '工具': ['首页', '功能页', '历史记录', '设置'],
    '金融': ['总览', '资产', '交易', '我的'],
    '内容': ['首页', '内容详情', '搜索', '个人中心'],
    '外卖/点餐': ['首页', '商家详情', '购物车', '支付', '订单'],
    '教育': ['课程列表', '课程详情', '学习页', '我的'],
    '医疗': ['首页', '预约挂号', '问诊', '个人中心'],
  },
  colloquialToTerm: {
    '好看点': '现代简约，留白充足，低饱和配色',
    '高级感': '低饱和配色，大字号对比，精致细节',
    '那种卡片样的': '卡片式布局',
    '圆圆的按钮': '圆角按钮',
    '干净': '大留白，单色系为主，弱化装饰',
    '别太花': '控制色彩数量在 2-3 种，降低装饰权重',
  },
  aestheticToSpec: {
    '简约': '大留白 + 少装饰 + 单色系为主',
    '现代': '无衬线字体 + 几何感 + 层次分明',
    '活泼': '高饱和点缀色 + 圆角 + 动感图标',
    '专业': '中性色为主 + 数据密度适中 + 克制留白',
    '温暖': '暖色系 + 大圆角 + 柔和阴影',
  },
  componentAlias: {
    '按钮': 'button', '输入框': 'input', '搜索栏': 'searchbar',
    '头像': 'avatar', '标签': 'tag', '卡片': 'card',
    '导航栏': 'navbar', '底部标签栏': 'tabbar', '列表': 'list',
    '表格': 'table', '弹窗': 'modal', '抽屉': 'drawer',
  },
}
```

**扩展方式**：新增行业只需在 `productFlows` 加一条，不改增强逻辑。映射表在 S3-3B 中落地为可编辑 JSON（用户自定义扩展位，对应 D8）。

### 6.6 后置意图保全校验（validator.ts）

> 对应 `功能设计-提示词增强.md` §7.2，这是 R-1 红线的**最后技术防线**。

```ts
export interface IntentCheckResult {
  passed: boolean
  missing: string[]      // 原文中有、增强结果中未出现的实体
  conflicts: string[]
}

/** 从原文抽取关键实体（本地规则，不调模型） */
export function extractEntities(raw: string): string[] {
  const out = new Set<string>()

  // ① 引号包裹的内容（用户特意强调的）
  for (const m of raw.matchAll(/[「『"']([^」』"']{2,20})[」』"']/g)) out.add(m[1].trim())
  // ② 色值
  for (const m of raw.matchAll(/#[0-9a-fA-F]{3,8}/g)) out.add(m[0])
  // ③ 英文/数字专名（如 WeChat、iOS）
  for (const m of raw.matchAll(/\b[A-Z][A-Za-z0-9]{1,19}\b/g)) out.add(m[0])
  // ④ 术语映射表中出现的组件别名
  for (const k of Object.keys(TERM_MAP.componentAlias)) if (raw.includes(k)) out.add(k)
  // ⑤ 平台词
  for (const m of raw.matchAll(/(移动端|桌面端|Web|H5|小程序|微信|支付宝|App|iPad|安卓|iOS)/g)) out.add(m[0])
  // ⑥ 高频业务名词（2-6 字的常见业务词，用白名单降低误判）
  for (const m of raw.matchAll(/(支付|登录|注册|订单|购物车|详情|列表|首页|个人中心|消息|收藏|搜索|筛选|评价|优惠券|积分|排行|关注|点赞|评论|分享|上传|下载|导出|报表|账单|记账|预约|挂号|签到|打卡)/g)) out.add(m[0])

  return [...out]
}

export function validateIntent(raw: string, enhanced: string): IntentCheckResult {
  const entities = extractEntities(raw)
  const missing = entities.filter((e) => !enhanced.includes(e))

  // 冲突项应被完整保留（含 [冲突] 标记），此处检查矛盾描述是否同时出现
  const conflicts: string[] = []
  // 若原文含明显对立词对，检查增强结果中是否两者都在
  const OPPOSITE_PAIRS: [RegExp, RegExp][] = [
    [/(极简|简约|简洁|简单)/, /(信息密度高|内容多|复杂|丰富)/],
    [/(深色|暗色|黑色)/, /(浅色|亮色|白色)/],
    [/(圆角|圆润)/, /(直角|方正|锐利)/],
  ]
  for (const [a, b] of OPPOSITE_PAIRS) {
    if (a.test(raw) && b.test(raw)) {
      if (!(a.test(enhanced) && b.test(enhanced))) conflicts.push('检测到对立描述但未同时保留')
    }
  }

  return { passed: missing.length === 0 && conflicts.length === 0, missing, conflicts }
}
```

**未通过时的处理**：

```ts
export async function enhanceWithGuard(raw: string, opts: EnhanceOptions) {
  let enhanced = await callEnhancer(raw, opts)
  let check = validateIntent(raw, enhanced)

  if (!check.passed) {
    // 针对缺失实体做一次定向重试
    enhanced = await callEnhancer(raw, {
      ...opts,
      extraInstruction: `上一次输出遗漏了以下必须保留的原始内容，请务必在本次输出中包含它们：${check.missing.join('、')}`,
    })
    check = validateIntent(raw, enhanced)
  }

  return {
    enhanced,
    degraded: false,
    warning: check.passed ? undefined
      : `以下原始内容可能未被完整保留：${check.missing.join('、')}`,
  }
}
```

> **注意降级原则**（`功能设计-提示词增强.md` §7.3）：校验两次未过时**不退回原文**，而是**照常展示 + 顶部告警**。因为此时已拿到完整结构，退回原文反而损失信息；用告警让用户知情并自行判断，是更优选择。**但若调用失败/返回为空，则一律退回原文**，绝不展示半成品。

### 6.7 增强器完整调用流程

```ts
export async function enhance(raw: string, opts: EnhanceOptions): Promise<EnhanceResult> {
  // ① 分级（本地）
  const { level, reasons } = classify(raw)

  // L3 不做增强
  if (level === 'L3') {
    return { status: 'already-structured', level, raw, notice: '当前描述已是结构化格式，无需增强' }
  }

  // ② 配置检查
  if (!opts.configRef) return { status: 'no-config', level, raw }

  // ③ 构造 Prompt（注入强度 + 映射表摘要）
  const messages = buildEnhancerMessages(raw, level, opts.intensity)

  // ④ 调用 + 校验（含定向重试）
  try {
    const { enhanced, warning } = await enhanceWithGuard(raw, opts)
    if (!enhanced || enhanced.length < raw.length * 0.5) {
      return { status: 'failed', level, raw, reason: 'EMPTY_OR_TRUNCATED' }  // 退回原文
    }
    return {
      status: 'ok', level, raw, enhanced, warning,
      isOriginal: false,
      metrics: { rawLen: raw.length, enhancedLen: enhanced.length },
    }
  } catch (e) {
    // ⑤ 异常一律退回原文（降级原则）
    return { status: 'failed', level, raw, reason: classifyError(e) }
  }
}
```

### 6.8 幂等性实现

对应 `功能设计-提示词增强.md` §6.4：

| 机制 | 实现 |
|---|---|
| L3 拦截 | `classify()` 识别为 L3 时直接返回 `already-structured`，不调模型 |
| 以原文为基准 | 「重新生成」始终传 `raw`（原始输入）而非上次 `enhanced`，避免叠加膨胀 |
| 用户编辑保护 | 用户手动改过的 `enhanced` 若再次增强，把编辑后内容视为新的 `raw`（享受 R-2 保护） |
| 长度护栏 | 增强结果 < 原文 50% 视为异常（截断）→ 退回原文 |

### 6.9 可测试性设计

因为 `classifier` / `suggestor` / `validator` / `term-map` 均为纯函数，可**脱离模型做完整单元测试**：

| 测试项 | 输入 | 断言 |
|---|---|---|
| 分级正确性 | 「记账app」 | `level === 'L0'` |
| 分级正确性 | 「做个电商详情页，有图片价格加购按钮，风格简约，蓝色系」 | `level === 'L2'` |
| 幂等性 | 一份 L2 输入，先增强得到结果 R，再对 R 调 `classify` | 应识别为 `L3` |
| 建议触发 | 「搞个app」 | `shouldSuggest` 为 true |
| 建议不触发 | 完整结构化输入 | `shouldSuggest` 为 false |
| 实体抽取 | 「要微信支付，主色 #2563EB」 | 含 `微信支付` 与 `#2563EB` |
| 意图保全 | 原文含「微信支付」，增强结果漏了 | `passed === false` |
| 冲突保留 | 「极简但信息密度高」 | `conflicts` 被检出 |

> 这让 S4 的增强器专项测试中「L0-L3 覆盖 / 幂等 / 意图保全」三项**可完全离线自动化**，无需消耗模型调用。

---

## 7. 可观测性与调试

### 7.1 请求日志（本地，含脱敏）

```ts
interface LlmLogEntry {
  id: string
  ts: number
  purpose: 'plan' | 'tokens' | 'page' | 'enhance' | 'edit' | 'repair'
  adapter: string
  model: string
  requestTokens?: number
  completionTokens?: number
  ms: number
  ok: boolean
  errorCode?: ErrorCode
  attempts?: number
  // 请求/响应内容仅开发版记录，正式版只记长度与哈希
  promptLength: number
  responseHash: string
}
```

**隐私原则**：正式版**不记录请求/响应正文**（可能含用户业务信息），只记录长度、哈希、耗时、错误码。开发版（`Ctrl+Shift+I` 可用）可开启全文记录。

### 7.2 用户可见的诊断面板

设置页提供「运行日志」入口，展示最近 50 条调用记录（用途、模型、耗时、结果），便于用户自助判断是「配置问题」还是「网络问题」还是「模型能力问题」。

---

## 8. 对下游的交付

| 下游 | 用途 |
|---|---|
| S3-3A | 配置面板四步流程、`test` 接口、safeStorage 密钥流转 |
| S3-3B | 三阶段流水线、温度分层、五级容错、修复重试、增强器全部实现细节 |
| S3-3C | 对话式编辑 Prompt（temp 0.2 + JSON Patch 输出，Patch 格式按 S2-2 字段路径） |
| S4 | 增强器离线测试用例（§6.9）、错误码覆盖、跨模型一致性验证方法 |
| T10 配置指南 | §2.4 分步引导 + §2.5 失败引导文案可直接转为用户文档 |

---

## 9. S2 阶段小结

S2 五份文档已齐备，形成完整可施工契约：

| 文档 | 冻结内容 | 关键下游 |
|---|---|---|
| S2-1 技术架构 | 进程模型 / IPC 协议 / 目录结构 / 打包配置 / 7 条 ADR | S3-3A |
| S2-2 Design JSON Schema | 全量 Schema + 完整示例 + 校验修复链路 + TS 类型 | S3-3B/C/D/E（**全项目契约**） |
| S2-3 组件体系与 Token | 44 组件 + 属性矩阵 + 4 套风格预设 + 双向 Token 体系 | S3-3C/E |
| S2-4 交互与 UI 规范 | 三段式布局 + 七规律落地 + 快捷键表 + 状态设计 + 错误映射 | S3-3A/C/D |
| S2-5 LLM 与 Prompt | 4 适配器 + 三阶段流水线 + 温度分层 + 五级容错 + 增强器完整设计 | S3-3B |

**待 S3-3A 验证项**（R3 风险应对）：用 S2-2 §5 的示例 JSON 跑通真实渲染，确认 Schema 可用后再进入大批量开发。
