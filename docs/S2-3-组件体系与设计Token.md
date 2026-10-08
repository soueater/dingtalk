# S2-3 组件体系与设计 Token

> 项目：本地客户端「望舒」
> 阶段：S2 方案设计　|　版本：v1.0　|　日期：2026-09-29
> 上游依据：`docs/S2-2-Design-JSON-Schema.md`、`analysis/S1-2-核心功能全量拆解.md`、`analysis/S1-5-结论与落地建议.md` §3.2-D

---

## 1. 设计 Token 体系

### 1.1 为什么 Token 是本项目的差异化地基

| 问题 | Stitch 的做法 | 本项目的做法 |
|---|---|---|
| 跨页风格漂移（P-3） | 靠提示词显式约束，第二页经常变靛蓝 | **Token 强制统一**，页面只引用 Token，不写死色值 |
| 全局改色 | Edit theme 只作用当前图 | **Token 变更全局传播**，反查索引一次命中所有引用点 |
| 风格探索 | 单一 Material 风格 | **多套 Token 预设** + 用户自定义 |

**结论**：Token 不是「设计变量」这么简单，它是本项目的**一致性强制机制**。页面节点里出现硬编码色值 = 一致性失控的开始，因此生成时违反 Token 引用会被判定为 warning 并要求修正。

### 1.2 Token 分类与命名规范

命名格式：`$<类别>.<语义名>`，**用语义名而非外观名**（`primary` 而非 `blue500`），因为换肤时语义名不变。

| 类别 | 前缀 | 用途 | 数量（本项目默认） |
|---|---|---|---|
| 色彩 | `$color.*` | 背景、文字、边框、品牌色、状态色 | 18 |
| 字体 | `$font.*` | 字阶（含字号/字重/行高） | 8 阶 |
| 间距 | `$space.*` | 内边距、外边距、间隙 | 8 档 |
| 圆角 | `$radius.*` | 圆角 | 5 档 |
| 阴影 | `$shadow.*` | 投影 | 4 档 |

### 1.3 色彩 Token（默认「清透蓝」预设）

```jsonc
"color": {
  // 品牌
  "primary":      "#3B82F6",
  "primaryHover": "#2563EB",
  "primaryActive":"#1D4ED8",
  "primarySoft":  "#EFF6FF",     // 浅色底，用于选中/高亮背景
  "onPrimary":    "#FFFFFF",

  // 中性
  "bg":           "#FFFFFF",
  "surface":      "#F9FAFB",
  "surfaceAlt":   "#F3F4F6",
  "border":       "#E5E7EB",
  "borderStrong": "#D1D5DB",

  // 文字
  "text":         "#111827",
  "textSecondary":"#6B7280",
  "textMuted":    "#9CA3AF",
  "textInverse":  "#FFFFFF",

  // 状态
  "success":      "#10B981",
  "warning":      "#F59E0B",
  "danger":       "#EF4444",
  "info":         "#3B82F6"
}
```

### 1.4 四套内置风格预设

风格预设 = 一整套 Token 值。切换预设即全局换装，这是解决 P-8「AI 平均审美同质化」的手段。

| 预设 | 定位 | primary | bg | surface | radius.md | font.family | 特征 |
|---|---|---|---|---|---|---|---|
| **清透蓝 Clear Blue** | 默认。通用 SaaS、工具类 | `#3B82F6` | `#FFFFFF` | `#F9FAFB` | 10 | Inter | 干净、中性、留白足 |
| **墨韵 Mono Ink** | 极简、专业工具、后台 | `#111827` | `#FFFFFF` | `#F5F5F5` | 6 | Inter | 无彩、高对比、锐利 |
| **暖橙 Warm Amber** | 消费类、社区、内容 | `#F97316` | `#FFFBF7` | `#FFF4EC` | 14 | Inter | 温暖、亲和、圆润 |
| **青碧 Teal Calm** | 健康、金融、B 端控制台 | `#0D9488` | `#FFFFFF` | `#F0FDFA` | 10 | Inter | 冷静、可信、克制 |

```jsonc
// 预设 WARM_AMBER 差异片段（其余继承基线）
"color": {
  "primary": "#F97316", "primaryHover": "#EA580C", "primaryActive": "#C2410C",
  "primarySoft": "#FFF7ED",
  "bg": "#FFFBF7", "surface": "#FFF4EC", "surfaceAlt": "#FFEDD5",
  "border": "#F3E4D7", "text": "#1C1917", "textSecondary": "#78716C"
},
"radius": { "sm": 8, "md": 14, "lg": 20, "xl": 28, "full": 999 }
```

### 1.5 字阶（8 阶，移动端基线）

| Token | size | weight | lineHeight | 用途 |
|---|---|---|---|---|
| `$font.display` | 34 | 700 | 42 | 首屏大标题 |
| `$font.h1` | 28 | 700 | 36 | 页面主标题 |
| `$font.h2` | 22 | 600 | 30 | 区块标题 |
| `$font.h3` | 18 | 600 | 26 | 卡片标题 |
| `$font.body` | 15 | 400 | 22 | 正文 |
| `$font.bodyStrong` | 15 | 600 | 22 | 强调正文 |
| `$font.caption` | 13 | 400 | 18 | 辅助说明 |
| `$font.overline` | 11 | 600 | 16 | 标签（常配 uppercase） |

> **桌面端放大规则**：`DESKTOP` 设备下，`body` 提升到 16/24，其余按 1.07 系数放大，由渲染器在设备预设中统一处理，Token 值本身不改。

### 1.6 间距 / 圆角 / 阴影

```jsonc
"space":  { "xxs": 2, "xs": 4, "sm": 8, "md": 16, "lg": 24, "xl": 32, "xxl": 48, "huge": 64 },
"radius": { "sm": 6, "md": 10, "lg": 16, "xl": 24, "full": 999 },
"shadow": {
  "xs":   { "x": 0, "y": 1, "blur": 2,  "color": "rgba(0,0,0,0.05)" },
  "sm":   { "x": 0, "y": 2, "blur": 8,  "color": "rgba(0,0,0,0.06)" },
  "md":   { "x": 0, "y": 4, "blur": 16, "color": "rgba(0,0,0,0.08)" },
  "lg":   { "x": 0, "y": 8, "blur": 32, "color": "rgba(0,0,0,0.12)" }
}
```

**间距节奏**：主节奏为 **8px 栅格**（`sm=8 / md=16 / lg=24`），`xs=4` 与 `xxs=2` 为微调档。生成时若出现 13px、17px 这类非节奏值，校验器会吸附到最近档位。

---

## 2. 组件清单（44 个）

### 2.1 组件分级

| 级别 | 说明 | 是否在组件面板可见 |
|---|---|---|
| **L1 基础** | 通用原子，画布与面板均可用 | ✅ 可见 |
| **L2 组合** | 由 L1 组装，有默认内部结构 | ✅ 可见 |
| **L3 容器** | 结构容器，通常由 AI 生成而非手动拖入 | ⚠️ 可见但标注「结构」 |

### 2.2 全量清单

#### A. 基础（L1）

| # | type | 名称 | 关键 props | 默认布局 |
|---|---|---|---|---|
| 1 | `frame` | 容器 | — | flex column |
| 2 | `group` | 编组 | — | absolute |
| 3 | `text` | 文本 | `content` | fit × fit |
| 4 | `image` | 图片 | `src`, `fit`(cover/contain/fill), `alt` | fill × fit |
| 5 | `icon` | 图标 | `name`, `size` | 24 × 24 |
| 6 | `divider` | 分割线 | `label?`, `orientation` | fill × 1 |
| 7 | `shape` | 形状 | `kind`(rect/circle/line) | 100 × 100 |

#### B. 表单控件（L1）

| # | type | 名称 | 关键 props |
|---|---|---|---|
| 8 | `button` | 按钮 | `label`, `variant`(primary/secondary/ghost/danger), `size`(sm/md/lg), `icon?`, `loading?` |
| 9 | `input` | 单行输入 | `placeholder`, `inputType`, `value?`, `prefixIcon?`, `suffixIcon?` |
| 10 | `textarea` | 多行输入 | `placeholder`, `rows` |
| 11 | `checkbox` | 复选框 | `label`, `checked` |
| 12 | `radio` | 单选框 | `label`, `checked`, `name` |
| 13 | `switch` | 开关 | `checked` |
| 14 | `slider` | 滑块 | `min`, `max`, `value` |
| 15 | `select` | 下拉选择 | `placeholder`, `options[]` |
| 16 | `searchbar` | 搜索框 | `placeholder` |
| 17 | `stepper` | 步进器 | `steps[]`, `current` |

#### C. 展示（L1/L2）

| # | type | 名称 | 级别 | 关键 props |
|---|---|---|---|---|
| 18 | `avatar` | 头像 | L1 | `src`, `size`, `shape`(circle/square) |
| 19 | `badge` | 徽标 | L1 | `label`, `tone` |
| 20 | `tag` | 标签 | L1 | `label`, `tone` |
| 21 | `chip` | 筛选片 | L1 | `label`, `selected` |
| 22 | `progress` | 进度条 | L1 | `value`, `showLabel` |
| 23 | `skeleton` | 骨架屏 | L1 | `rows` |
| 24 | `empty` | 空状态 | L2 | `title`, `description`, `actionLabel?` |
| 25 | `chart` | 图表占位 | L2 | `kind`(line/bar/pie/donut), `series` |
| 26 | `map` | 地图占位 | L1 | `center`, `zoom` |
| 27 | `calendar` | 日历 | L2 | `month`, `selected` |
| 28 | `pagination` | 分页 | L2 | `total`, `pageSize`, `current` |

#### D. 导航（L2）

| # | type | 名称 | 关键 props |
|---|---|---|---|
| 29 | `navbar` | 顶部导航 | `title`, `showBack`, `actions[]` |
| 30 | `tabbar` | 底部标签栏 | `items[]`, `activeIndex` |
| 31 | `sidebar` | 侧边导航 | `items[]`, `collapsed` |
| 32 | `breadcrumb` | 面包屑 | `items[]` |
| 33 | `tabs` | 选项卡 | `items[]`, `activeIndex` |
| 34 | `accordion` | 折叠面板 | `items[]`, `expandedIndex` |

#### E. 数据展示（L2/L3）

| # | type | 名称 | 级别 | 关键 props |
|---|---|---|---|---|
| 35 | `card` | 卡片 | L3 | `title?`, `padding` |
| 36 | `list` | 列表 | L3 | `divided` |
| 37 | `listItem` | 列表项 | L2 | `title`, `subtitle?`, `avatar?`, `trailing?` |
| 38 | `table` | 表格 | L3 | `columns[]`, `striped` |
| 39 | `tableRow` | 表格行 | L3 | — |
| 40 | `tableCell` | 表格单元格 | L3 | `align` |

#### F. 反馈与浮层（L2）

| # | type | 名称 | 关键 props |
|---|---|---|---|
| 41 | `modal` | 模态框 | `title`, `description?`, `confirmLabel?` |
| 42 | `drawer` | 抽屉 | `title`, `placement`(left/right/top/bottom) |
| 43 | `tooltip` | 提示气泡 | `content` |
| 44 | `toast` | 轻提示 | `message`, `tone` |

---

## 3. 组件属性矩阵（核心组件详解）

### 3.1 通用可配置属性（所有组件共有）

| 分组 | 属性 | Schema 路径 | 控件类型 |
|---|---|---|---|
| 布局 | 定位模式 | `layout.mode` | 分段控件 |
| 布局 | 位置 X/Y | `layout.x/y` | 数字输入 |
| 布局 | 宽/高 | `layout.width/height` | 尺寸控件（px/%/fill/fit/auto） |
| 布局 | 方向 | `layout.direction` | 图标切换 |
| 布局 | 主轴对齐 | `layout.justify` | 图标组 |
| 布局 | 交叉轴对齐 | `layout.align` | 图标组 |
| 布局 | 间距 | `layout.gap` | 数字 + 吸附 |
| 布局 | 内边距 | `layout.padding` | 四向输入 |
| 布局 | 层级 | `layout.zIndex` | 数字 |
| 外观 | 填充 | `style.fill` | 色板（Token/自定义） |
| 外观 | 描边 | `style.stroke.*` | 颜色+宽度+位置 |
| 外观 | 圆角 | `style.radius` | 圆角控件（可四角独立） |
| 外观 | 阴影 | `style.shadow[]` | 阴影预设 + 自定义 |
| 外观 | 透明度 | `style.opacity` | 滑块 |
| 外观 | 溢出 | `style.overflow` | 下拉 |
| 文本 | 字体 | `style.font.*` | 字阶选择 + 自定义 |
| 文本 | 对齐 | `style.textAlign` | 图标组 |
| 文本 | 颜色 | `style.textColor` | 色板 |
| 文本 | 最大行数 | `style.maxLines` | 数字 |
| 状态 | 悬停/激活/禁用 | `states.*` | 状态覆盖编辑器 |

### 3.2 `button` 属性矩阵

| 属性 | 类型 | 取值 | 默认 | 影响 |
|---|---|---|---|---|
| `label` | string | 任意文本 | "按钮" | 显示文案 |
| `variant` | enum | primary / secondary / ghost / danger | primary | 决定 fill / border / textColor 组合 |
| `size` | enum | sm / md / lg | md | 高度 32/40/48，字号与内边距联动 |
| `icon` | string? | 图标名 | — | 前置图标 |
| `iconPos` | enum | left / right | left | 图标位置 |
| `fullWidth` | boolean | — | false | 撑满父容器 |
| `loading` | boolean | — | false | 显示加载态，禁用交互 |
| `disabled` | boolean | — | false | 置灰 |

**variant 与 Token 的预设映射**：

| variant | fill | textColor | stroke |
|---|---|---|---|
| primary | `$color.primary` | `$color.onPrimary` | — |
| secondary | `$color.primarySoft` | `$color.primary` | — |
| ghost | `transparent` | `$color.text` | `$color.border` |
| danger | `$color.danger` | `#FFFFFF` | — |

### 3.3 `input` 属性矩阵

| 属性 | 类型 | 取值 | 默认 |
|---|---|---|---|
| `placeholder` | string | — | "请输入" |
| `inputType` | enum | text / password / tel / email / number | text |
| `value` | string | — | "" |
| `label` | string? | — | — |
| `helperText` | string? | — | — |
| `prefixIcon` | string? | — | — |
| `suffixIcon` | string? | — | — |
| `state` | enum | default / focus / error / disabled | default |

### 3.4 `card` 属性矩阵

| 属性 | 类型 | 默认 |
|---|---|---|
| `title` | string? | — |
| `subtitle` | string? | — |
| `padding` | enum | md |
| `elevated` | boolean | false（true 时加 `$shadow.sm`） |
| `clickable` | boolean | false（true 时 cursor:pointer + hover 态） |

### 3.5 `table` 属性矩阵（B 端必需）

| 属性 | 类型 | 说明 |
|---|---|---|
| `columns` | `{key, title, width, align}[]` | 列定义 |
| `striped` | boolean | 斑马纹 |
| `bordered` | boolean | 显示网格线 |
| `dense` | boolean | 紧凑行高 |
| `rowHeight` | number | 覆盖默认行高 |

> **B 端能力边界标注**（对应 S1-5 P-6）：本项目提供结构化的 `table` 组件，但不承诺自动生成复杂业务表格（多级表头、列固定、虚拟滚动大数据）。这是 v1.0 明确不竞争的领域，表格以「视觉呈现正确」为标准。

---

## 4. 组件在画布上的渲染映射

### 4.1 渲染映射表

```ts
// src/services/renderer/registry.ts
export const COMPONENT_REGISTRY: Record<NodeType, {
  render: (node: Node, ctx: RenderCtx) => React.ReactNode
  defaults: Partial<Node>          // 拖入画布时的初始值
  propsSchema: PropSchema[]        // 驱动右侧属性面板自动生成
}> = {
  button: { render: renderButton, defaults: {...}, propsSchema: BUTTON_PROPS },
  input:  { render: renderInput,  defaults: {...}, propsSchema: INPUT_PROPS },
  // ...
}
```

**关键机制**：`propsSchema` 同时驱动**属性面板渲染**与**AI 生成约束**。属性面板不需要为每个组件手写 UI——按 schema 自动生成控件。这也是「新增组件成本低」的原因。

### 4.2 拖入即实例化

```
用户从组件面板拖拽 "button" 到画布
  → 读取 COMPONENT_REGISTRY.button.defaults
  → 生成新节点：{ id: nanoid(), type: 'button', ...defaults }
  → 计算落点坐标（考虑父容器坐标系与 flex 流）
  → applyPatch({ op: 'insert', parent, index, node }, { label: '插入按钮' })
  → 选中新节点 → 属性面板自动按 BUTTON_PROPS 渲染
```

### 4.3 结构容器 vs 自由容器的生成策略

| 场景 | 生成策略 |
|---|---|
| AI 生成 | 优先 `flex` 布局（响应式友好、导出干净） |
| 手动插入到 flex 父容器 | 作为 flex item，用 `grow: 1` 或固定尺寸 |
| 手动插入到 absolute 父容器 | 按落点计算 `x/y`，`layout.mode = 'absolute'` |
| 用户显式编组 | 生成 `group`，`mode = 'absolute'`，保持子节点坐标不变 |

---

## 5. 应用自身 UI 的设计 Token（区别于设计稿 Token）

> **重要区分**：上面 §1 是「用户设计稿」的 Token（存于项目 JSON）。本节是「工具本身界面」的 Token
> （存于 `app/src/styles/tokens.css`）。两者独立，不要混用。

> **落地状态**：实现已从"单一深色"演进为**多主题体系**，本节按实际代码更新（早期草案的 `--app-*`
> 命名已废弃，正式命名为 `--surface-* / --brand / --text-*`）。

工具界面自身采用 **CSS 变量 + `data-theme` 覆盖** 的三层结构：

| 层 | 位置 | 内容 | 是否随主题变化 |
|---|---|---|---|
| ① 结构层 | `:root` | 间距 / 圆角 / 字阶 / 动效 / 层级 / 尺寸常量 / 阴影间接层 | ❌ 不变 |
| ② 颜色层 | `:root, [data-theme='night']` 及各主题块 | 表面层级 / 边框 / 文字 / 强调色 / 语义色 | ✅ 每主题一套 |
| ③ 消费层 | 其余所有 `*.css` + 组件内联样式 | **只引用变量，不写死颜色** | 自动跟随 |

```css
/* app/src/styles/tokens.css（节选，主题一 · 夜阑） */
:root {
  /* 结构层：与主题无关 */
  --h-titlebar: 48px;  --w-left: 264px;  --w-right: 300px;  --h-statusbar: 28px;
  --shadow-md: 0 4px 14px var(--shadow-color-2);   /* 经间接层，各主题可自定浓度 */
}

:root,
[data-theme='night'] {
  color-scheme: dark;
  /* 表面层级：越靠近内容越亮 */
  --app-bg: #0f1115;  --surface-1: #15181e;  --surface-2: #1a1e26;  --surface-3: #20252f;
  --canvas-bg: #0a0c10;
  --border-subtle: #232833;  --border: #2b313d;  --border-strong: #3a4250;
  --text-1: #e8ecf2;  --text-2: #9aa4b2;  --text-3: #6b7583;
  --brand: #4c8dff;  --brand-soft: rgba(76,141,255,.14);  --on-brand: #ffffff;
  --success: #38d39f;  --warning: #f5a524;  --danger: #f5566e;
  /* 工具界面前景，供"纸张/手柄/遮罩"等场景用 */
  --page-paper: #ffffff;  --handle-bg: #ffffff;  --scrim: rgba(4,6,10,.62);
}
```

### 5.1 四套内置主题

| id | 名称 | 明暗 | 定位 |
|---|---|---|---|
| `night` | 夜阑 | 深色 | 默认。低亮度蓝调，长时间使用更省眼 |
| `dawn` | 晨光 | 浅色 | 白天 / 投屏演示 |
| `ocean` | 沧海 | 深色 | 蓝青冷调偏好 |
| `ink` | 墨韵 | 浅色 | 淡紫灰调，柔和不刺眼 |

切换由 `app/src/stores/theme.store.ts` 负责：写 `<html data-theme>` + `data-theme` 对应的变量覆盖即时生效，
并持久化到 localStorage；同时把窗口底色与原生标题栏按钮区颜色通过 IPC 同步给主进程。

> **关键约束**：主题只影响**工具外壳**。用户设计稿的颜色来自项目 JSON 里的 `$color.*` Token，
> 导出产物与界面主题完全解耦——换主题不会把设计稿改色。

### 5.2 设计约束

- 工具 UI 的强调色统一用 `--brand`，与用户设计稿的 `$color.primary` 视觉隔离（设计稿在独立渲染上下文中）。
- 所有交互控件最小点击区 28×28，保证可达性。
- 深色主题不使用纯黑 `#000`，用 `#0f1115` 减少视觉疲劳。
- **禁止硬编码颜色**：新增样式一律引用变量，否则切到浅色主题会出现"深色孤岛"。
  自检方式：`grep -n "#[0-9a-fA-F]\{3,8\}" app/src/styles/*.css` 应只在 `tokens.css` 中出现。
- 舞台缩放下的描边/手柄用 `calc(Npx * var(--inv-zoom))` 抵消 `scale()`，保证任意缩放级别下视觉粗细恒定。

---

## 6. 组件体系的扩展方式

### 6.1 新增一个组件需要改动的地方

| 步骤 | 文件 | 工作量 |
|---|---|---|
| 1. 加 `NodeType` 枚举值 | `src/types/design.ts` | 1 行 |
| 2. 加渲染映射 + defaults + propsSchema | `src/services/renderer/registry.ts` | ~30 行 |
| 3. 加渲染实现 | `src/services/renderer/components/xxx.tsx` | ~40 行 |
| 4. 加 HTML 导出模板 | `src/services/export/html/templates.ts` | ~20 行 |
| 5. 加 SVG 序列化规则 | `src/services/export/svg/serializer.ts` | ~15 行 |

> 无第 2 步之外的面板改动——属性面板自动按 schema 生成。这是把「新增组件成本」压到最低的关键设计。

### 6.2 v2.0 预留扩展位

| 扩展 | 说明 |
|---|---|
| 自定义组件（用户定义） | 用户把一组节点保存为可复用组件，存于项目 `components` 字段 |
| 组件变体 | 同一组件多套预设（如 button 的 icon-only / 带角标） |
| 设计系统导入 | 解析 design.md 式文本 → 覆盖 Token |

---

## 7. 对下游的交付

| 下游 | 用途 |
|---|---|
| S2-4 UI 规范 | `--app-*` Token 全套可用；全局交互与状态设计基于此 |
| S2-5 Prompt 方案 | `NodeType` 清单 + `propsSchema` 将写入生成 Prompt 与 Schema 约束 |
| S3-3A | `tokens.css` 直接落地；三段式宽度常量已定 |
| S3-3C | `COMPONENT_REGISTRY` 是渲染器与组件面板的共同数据源 |
| S3-3E | HTML/SVG 导出器按组件清单补齐模板 |
