# S2-2 Design JSON Schema 设计

> 项目：本地客户端「望舒」
> 阶段：S2 方案设计　|　版本：v1.0　|　日期：2026-09-29
> **本文件是全项目最关键的契约**：AI 生成、可视化编辑、多格式导出三方共同遵守。

---

## 1. 设计目标与约束

| 目标 | 说明 | 对应上游 |
|---|---|---|
| **AI 可生成** | 结构扁平、语义明确，LLM 一次性输出不易出错 | S1-6 §4.2（抹平模型差异） |
| **编辑可精确** | 每个可编辑属性都能定位到节点/字段 | S1-5 差异化 1 |
| **导出零损耗** | 结构直接映射 HTML/CSS，无需反向推断 | S1-6 §4.1 |
| **支持真实交互** | 跳转关系作为一等公民 | S1-5 差异化 2 |
| **支持一致性** | Token 引用机制，改一处全局生效 | S1-5 差异化 3 |
| **可扩展** | 未知字段可安全忽略，向后兼容 | R3 风险应对 |

### 1.1 三条设计红线

1. **不用嵌套样式对象表达布局**——位置尺寸用扁平 `layout` 字段，避免 LLM 生成深层嵌套出错。
2. **样式只允许引用 Token 或字面量，不允许表达式**——保证可序列化、可校验、可导出。
3. **节点 `id` 全局唯一且稳定**——所有环绕引用（跳转目标、Token 依赖、历史 patch）都靠 id，不得复用。

---

## 2. Schema 总体结构

```jsonc
{
  "schemaVersion": "1.0",        // 契约版本，用于未来迁移
  "meta": { ... },                // 项目元信息
  "tokens": { ... },              // 设计 Token（色彩/字阶/间距/圆角/阴影）
  "assets": [ ... ],              // 图片等资源（base64 或本地路径引用）
  "pages": [ ... ],               // 页面数组（每页一棵节点树）
  "flows": [ ... ]                // 跳转连线（跨页关系，独立于页面，便于流视图渲染）
}
```

> **为什么 flows 独立于 pages**：跳转是「页面之间」的关系，若内嵌在节点里，流视图渲染、批量重连、导出脚本生成都要遍历所有节点去捞。独立成表后，流视图直接读 `flows`，导出脚本直接由 `flows` 生成事件绑定。

---

## 3. 完整 Schema 定义（JSON Schema Draft-07 精简版）

```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://local.design-assistant/design-json/1.0",
  "title": "DesignJSON",
  "type": "object",
  "required": ["schemaVersion", "meta", "tokens", "pages"],
  "additionalProperties": false,
  "properties": {
    "schemaVersion": { "type": "string", "pattern": "^\\d+\\.\\d+$" },
    "meta":   { "$ref": "#/definitions/Meta" },
    "tokens": { "$ref": "#/definitions/Tokens" },
    "assets": { "type": "array", "items": { "$ref": "#/definitions/Asset" } },
    "pages":  { "type": "array", "minItems": 1, "items": { "$ref": "#/definitions/Page" } },
    "flows":  { "type": "array", "items": { "$ref": "#/definitions/Flow" } }
  },

  "definitions": {
    "Meta": {
      "type": "object",
      "required": ["id", "name", "device", "createdAt", "updatedAt"],
      "properties": {
        "id":        { "type": "string" },
        "name":      { "type": "string", "maxLength": 80 },
        "device":    { "enum": ["MOBILE", "TABLET", "DESKTOP", "RESPONSIVE"] },
        "canvas":    { "$ref": "#/definitions/CanvasSize" },
        "createdAt": { "type": "string", "format": "date-time" },
        "updatedAt": { "type": "string", "format": "date-time" },
        "source":    { "enum": ["ai", "mock", "blank", "import"] },
        "prompt":    { "type": "string" }
      }
    },

    "CanvasSize": {
      "type": "object",
      "required": ["width", "height"],
      "properties": {
        "width":  { "type": "number", "minimum": 64, "maximum": 4096 },
        "height": { "type": "number", "minimum": 64, "maximum": 8192 }
      }
    },

    "Tokens": {
      "type": "object",
      "properties": {
        "color":  { "type": "object", "additionalProperties": { "$ref": "#/definitions/ColorToken" } },
        "font":   { "type": "object", "additionalProperties": { "$ref": "#/definitions/FontToken" } },
        "space":  { "type": "object", "additionalProperties": { "type": "number" } },
        "radius": { "type": "object", "additionalProperties": { "type": "number" } },
        "shadow": { "type": "object", "additionalProperties": { "$ref": "#/definitions/ShadowToken" } }
      }
    },

    "ColorToken":  { "type": "string", "pattern": "^(#[0-9a-fA-F]{3,8}|rgba?\\(.+\\)|transparent)$" },
    "FontToken": {
      "type": "object",
      "properties": {
        "family":    { "type": "string" },
        "size":      { "type": "number" },
        "weight":    { "type": "number" },
        "lineHeight":{ "type": "number" },
        "letterSpacing": { "type": "number" }
      }
    },
    "ShadowToken": {
      "type": "object",
      "required": ["x", "y", "blur", "color"],
      "properties": {
        "x": { "type": "number" }, "y": { "type": "number" },
        "blur": { "type": "number" }, "spread": { "type": "number" },
        "color": { "$ref": "#/definitions/ColorToken" }
      }
    },

    "Asset": {
      "type": "object",
      "required": ["id", "type"],
      "properties": {
        "id":   { "type": "string" },
        "type": { "enum": ["image", "icon", "font"] },
        "src":  { "type": "string" },          // data:URI 或 assets/xxx.png
        "mime": { "type": "string" },
        "width":{ "type": "number" }, "height": { "type": "number" }
      }
    },

    "Page": {
      "type": "object",
      "required": ["id", "name", "root"],
      "properties": {
        "id":       { "type": "string" },
        "name":     { "type": "string", "maxLength": 60 },
        "order":    { "type": "number" },
        "pos":      { "$ref": "#/definitions/Point" },   // 流视图中的坐标
        "background": { "type": "string" },              // token 引用或色值
        "root":     { "$ref": "#/definitions/Node" }
      }
    },

    "Node": {
      "type": "object",
      "required": ["id", "type"],
      "properties": {
        "id":       { "type": "string" },
        "type":     { "$ref": "#/definitions/NodeType" },
        "name":     { "type": "string" },     // 图层显示名，可空则按 type 生成
        "layout":   { "$ref": "#/definitions/Layout" },
        "style":    { "$ref": "#/definitions/Style" },
        "props":    { "type": "object" },     // 组件专属属性（文本、图标名、占位等）
        "children": { "type": "array", "items": { "$ref": "#/definitions/Node" } },
        "states":   { "$ref": "#/definitions/States" },   // 变体/状态样式覆盖
        "locked":   { "type": "boolean" },
        "hidden":   { "type": "boolean" }
      }
    },

    "NodeType": {
      "enum": [
        "frame", "group",
        "text", "image", "icon", "divider", "shape",
        "button", "input", "textarea", "checkbox", "radio", "switch", "slider", "select",
        "avatar", "badge", "tag", "chip", "progress", "skeleton",
        "navbar", "tabbar", "sidebar", "breadcrumb", "stepper",
        "card", "list", "listItem", "table", "tableRow", "tableCell",
        "modal", "drawer", "tooltip", "toast", "accordion", "tabs",
        "chart", "map", "calendar", "searchbar", "pagination", "empty"
      ]
    },

    "Layout": {
      "type": "object",
      "properties": {
        "mode":       { "enum": ["absolute", "flex", "grid"] },
        "x":          { "type": "number" },     // absolute 时使用
        "y":          { "type": "number" },
        "width":      { "$ref": "#/definitions/SizeValue" },
        "height":     { "$ref": "#/definitions/SizeValue" },
        "direction":  { "enum": ["row", "column"] },
        "justify":    { "enum": ["start", "center", "end", "between", "around", "evenly"] },
        "align":      { "enum": ["start", "center", "end", "stretch", "baseline"] },
        "gap":        { "type": "number" },
        "padding":    { "$ref": "#/definitions/Edges" },
        "margin":     { "$ref": "#/definitions/Edges" },
        "columns":    { "type": "number" },     // grid
        "wrap":       { "type": "boolean" },
        "position":   { "enum": ["static", "relative", "absolute", "fixed", "sticky"] },
        "zIndex":     { "type": "number" },
        "grow":       { "type": "number" },
        "selfAlign":  { "enum": ["auto", "start", "center", "end", "stretch"] }
      }
    },

    "SizeValue": {
      "oneOf": [
        { "type": "number" },                                    // 固定 px
        { "type": "string", "pattern": "^(auto|fill|fit|\\d+%)$" } // 语义尺寸
      ]
    },

    "Edges": {
      "type": "object",
      "properties": {
        "t": { "type": "number" }, "r": { "type": "number" },
        "b": { "type": "number" }, "l": { "type": "number" }
      }
    },

    "Style": {
      "type": "object",
      "properties": {
        "fill":        { "$ref": "#/definitions/Paint" },
        "stroke":      { "$ref": "#/definitions/Stroke" },
        "radius":      { "$ref": "#/definitions/CornerRadius" },
        "shadow":      { "type": "array", "items": { "$ref": "#/definitions/ShadowToken" } },
        "opacity":     { "type": "number", "minimum": 0, "maximum": 1 },
        "overflow":    { "enum": ["visible", "hidden", "scroll", "auto"] },
        "blendMode":   { "type": "string" },

        "font":        { "$ref": "#/definitions/FontStyle" },
        "textAlign":   { "enum": ["left", "center", "right", "justify"] },
        "textColor":   { "$ref": "#/definitions/Paint" },
        "textDecoration": { "enum": ["none", "underline", "line-through"] },
        "textTransform":  { "enum": ["none", "uppercase", "lowercase", "capitalize"] },
        "maxLines":    { "type": "number" },

        "borderStyle": { "enum": ["solid", "dashed", "dotted", "none"] },
        "alignSelf":   { "type": "string" },
        "cursor":      { "enum": ["default", "pointer", "text", "grab", "not-allowed"] }
      }
    },

    "Paint": {
      "oneOf": [
        { "type": "string" },                                  // "#RRGGBB" | "$color.primary" | "transparent" | "linear-gradient(...)"
        { "type": "object", "additionalProperties": true }      // 渐变对象（v1.1 扩展位）
      ]
    },

    "Stroke": {
      "type": "object",
      "properties": {
        "color": { "$ref": "#/definitions/Paint" },
        "width": { "type": "number" },
        "position": { "enum": ["inside", "center", "outside"] }
      }
    },

    "CornerRadius": {
      "oneOf": [
        { "type": "number" },
        { "type": "string" },                                   // "$radius.md"
        { "type": "object",
          "properties": {
            "tl": { "type": "number" }, "tr": { "type": "number" },
            "br": { "type": "number" }, "bl": { "type": "number" }
          }
        }
      ]
    },

    "FontStyle": {
      "type": "object",
      "properties": {
        "family": { "type": "string" },
        "size":   { "type": "number" },
        "weight": { "type": "number" },
        "lineHeight": { "type": "number" },
        "letterSpacing": { "type": "number" },
        "italic": { "type": "boolean" }
      }
    },

    "States": {
      "type": "object",
      "additionalProperties": { "$ref": "#/definitions/StyleOverride" }
      // 键为状态名: default / hover / active / focus / disabled / error
    },

    "StyleOverride": {
      "type": "object",
      "properties": {
        "style": { "$ref": "#/definitions/Style" },
        "props": { "type": "object" }
      }
    },

    "Flow": {
      "type": "object",
      "required": ["id", "from", "to", "trigger"],
      "properties": {
        "id":       { "type": "string" },
        "from":     { "type": "string" },                      // 源节点 id
        "fromPage": { "type": "string" },
        "to":       { "type": "string" },                      // 目标页面 id
        "trigger":  { "enum": ["click", "hover", "longPress", "submit", "back"] },
        "transition": { "enum": ["none", "slide-left", "slide-right", "fade", "slide-up"] },
        "params":   { "type": "object" }                       // 预留传参
      }
    },

    "Point": {
      "type": "object",
      "required": ["x", "y"],
      "properties": { "x": { "type": "number" }, "y": { "type": "number" } }
    }
  }
}
```

---

## 4. 关键设计决策说明

### 4.1 布局：为什么不用 CSS 式嵌套

| 方案 | 问题 |
|---|---|
| 直接让 LLM 输出 CSS 字符串 | 格式自由过度，校验困难；不同模型写出的写法千差万别，导出归一化成本高 |
| 嵌套 `style.layout.flex.direction` 深对象 | 层级深，LLM 容易漏字段或层级错位 |
| **扁平 `layout` 混合语义字段（选用）** | 所有布局字段平行铺开，LLM 只需填「值」不需记「路径」，出错率显著下降；渲染器按 `mode` 分派 |

### 4.2 尺寸：`SizeValue` 三态

| 值 | 含义 | 渲染 |
|---|---|---|
| `240` | 固定 240px | `width: 240px` |
| `"fill"` | 撑满父容器（flex:1） | `flex: 1 1 0` |
| `"fit"` | 包裹内容 | `width: fit-content` |
| `"50%"` | 百分比 | `width: 50%` |
| `"auto"` | 浏览器默认 | `width: auto` |

> **设计理由**：AI 生成时「这个卡片应该撑满宽度」用 `"fill"` 表达比让它算像素值可靠得多。这是压缩模型差异的关键手段之一。

### 4.3 Token 引用语法

所有可引用 Token 的字段接受两种形式：

```
字面量:  "#3B82F6"              → 硬编码颜色
引用:    "$color.primary"        → 指向 tokens.color.primary
```

**为什么用 `$` 前缀**：① 不会与合法 CSS 值歧义；② 正则易校验；③ 解析时一眼可辨。

**Token 变更传播机制**：
```
tokens.color.primary: "#3B82F6" → "#EF4444"
   ↓ 建立反查索引 tokenKey → [nodeId...]（渲染时维护）
   ↓ 命中的节点重新解析样式
   ↓ 一次性批量提交为一笔历史事务
```

### 4.4 交互：为什么 flows 独立

跳转的真实逻辑需要「运行时事件绑定」，导出 HTML 时由 `flows` 直接生成：

```js
// 导出脚本片段（由 flows 生成）
document.querySelector('[data-id="btn_login"]')
  .addEventListener('click', () => goTo('page_home', 'slide-left'))
```

若跳转埋在节点里，导出器需要遍历整棵树拼装，且流视图（画布连线）无法低成本渲染。

### 4.5 状态：`states` 的表达力

```jsonc
{
  "id": "btn_primary",
  "type": "button",
  "style": { "fill": "$color.primary", "radius": "$radius.md" },
  "states": {
    "hover":   { "style": { "fill": "$color.primaryHover" } },
    "active":  { "style": { "opacity": 0.85 } },
    "disabled":{ "style": { "opacity": 0.4 }, "props": { "disabled": true } }
  }
}
```

**约定**：`states` 是**叠加覆盖**，只写差异，不写全量。渲染时 `base.style + state.style` 合并。

### 4.6 未知字段容忍策略

校验分两档：

| 档位 | 行为 | 场景 |
|---|---|---|
| **严格档** | `additionalProperties: false`，多一个字段即失败 | 开发期自检、Mock 数据 |
| **宽松档（生产）** | 忽略未知字段，仅对必需字段与类型做校验 | 收到 LLM 输出时 |

> **理由**：LLM 偶尔会吐出 `"comment": "..."` 这类额外字段，若严格模式直接判失败会导致大量无谓重试。宽松档先「能用」，再由修复链路清理。

---

## 5. 完整示例：登录页（可直接用于渲染验证）

```jsonc
{
  "schemaVersion": "1.0",
  "meta": {
    "id": "proj_demo_login",
    "name": "登录流程示例",
    "device": "MOBILE",
    "canvas": { "width": 390, "height": 844 },
    "createdAt": "2026-09-29T10:00:00Z",
    "updatedAt": "2026-09-29T10:00:00Z",
    "source": "mock",
    "prompt": "一个简洁的登录页，包含手机号输入、密码输入、登录按钮和第三方登录"
  },
  "tokens": {
    "color": {
      "primary":      "#3B82F6",
      "primaryHover": "#2563EB",
      "bg":           "#FFFFFF",
      "surface":      "#F9FAFB",
      "text":         "#111827",
      "textMuted":    "#6B7280",
      "border":       "#E5E7EB",
      "danger":       "#EF4444"
    },
    "font": {
      "h1":  { "family": "Inter", "size": 28, "weight": 700, "lineHeight": 36 },
      "body":{ "family": "Inter", "size": 15, "weight": 400, "lineHeight": 22 },
      "label":{ "family": "Inter", "size": 13, "weight": 500, "lineHeight": 18 }
    },
    "space":  { "xs": 4, "sm": 8, "md": 16, "lg": 24, "xl": 32, "xxl": 48 },
    "radius": { "sm": 6, "md": 10, "lg": 16, "full": 999 },
    "shadow": {
      "card": { "x": 0, "y": 2, "blur": 8, "spread": 0, "color": "rgba(0,0,0,0.06)" }
    }
  },
  "assets": [],
  "pages": [
    {
      "id": "page_login",
      "name": "登录",
      "order": 0,
      "pos": { "x": 0, "y": 0 },
      "background": "$color.bg",
      "root": {
        "id": "root_login",
        "type": "frame",
        "name": "登录页",
        "layout": {
          "mode": "flex", "direction": "column",
          "padding": { "t": 64, "r": 24, "b": 24, "l": 24 },
          "gap": 24, "width": "fill", "height": "fill"
        },
        "style": { "fill": "$color.bg" },
        "children": [
          {
            "id": "txt_title",
            "type": "text",
            "name": "标题",
            "layout": { "mode": "flex", "width": "fill", "height": "fit" },
            "style": { "font": { "family": "Inter", "size": 28, "weight": 700 }, "textColor": "$color.text" },
            "props": { "content": "欢迎回来" }
          },
          {
            "id": "txt_sub",
            "type": "text",
            "name": "副标题",
            "layout": { "mode": "flex", "width": "fill", "height": "fit" },
            "style": { "font": { "family": "Inter", "size": 15 }, "textColor": "$color.textMuted" },
            "props": { "content": "登录以继续你的设计工作" }
          },
          {
            "id": "input_phone",
            "type": "input",
            "name": "手机号",
            "layout": { "mode": "flex", "width": "fill", "height": 52 },
            "style": {
              "fill": "$color.surface", "radius": "$radius.md",
              "stroke": { "color": "$color.border", "width": 1, "position": "inside" }
            },
            "props": { "placeholder": "请输入手机号", "inputType": "tel" }
          },
          {
            "id": "input_pwd",
            "type": "input",
            "name": "密码",
            "layout": { "mode": "flex", "width": "fill", "height": 52 },
            "style": {
              "fill": "$color.surface", "radius": "$radius.md",
              "stroke": { "color": "$color.border", "width": 1, "position": "inside" }
            },
            "props": { "placeholder": "请输入密码", "inputType": "password" }
          },
          {
            "id": "btn_login",
            "type": "button",
            "name": "登录按钮",
            "layout": { "mode": "flex", "width": "fill", "height": 52, "justify": "center", "align": "center" },
            "style": { "fill": "$color.primary", "radius": "$radius.md", "cursor": "pointer" },
            "states": {
              "hover": { "style": { "fill": "$color.primaryHover" } },
              "active": { "style": { "opacity": 0.86 } }
            },
            "props": { "label": "登录" }
          },
          {
            "id": "divider_or",
            "type": "divider",
            "name": "或",
            "layout": { "mode": "flex", "width": "fill", "height": "fit" },
            "style": {},
            "props": { "label": "或使用其他方式登录" }
          },
          {
            "id": "frame_third",
            "type": "frame",
            "name": "第三方登录",
            "layout": { "mode": "flex", "direction": "row", "gap": 12, "justify": "center", "width": "fill", "height": 48 },
            "style": {},
            "children": [
              { "id": "btn_wx", "type": "button", "name": "微信", "layout": { "mode": "flex", "width": "fill", "height": 48, "justify": "center", "align": "center" }, "style": { "fill": "$color.surface", "radius": "$radius.md", "stroke": { "color": "$color.border", "width": 1 } }, "props": { "label": "微信", "variant": "ghost" } },
              { "id": "btn_apple", "type": "button", "name": "Apple", "layout": { "mode": "flex", "width": "fill", "height": 48, "justify": "center", "align": "center" }, "style": { "fill": "$color.surface", "radius": "$radius.md", "stroke": { "color": "$color.border", "width": 1 } }, "props": { "label": "Apple", "variant": "ghost" } }
            ]
          }
        ]
      }
    }
  ],
  "flows": []
}
```

### 5.1 带跳转的示例（两页 + flow）

```jsonc
"flows": [
  {
    "id": "flow_1",
    "from": "btn_login",
    "fromPage": "page_login",
    "to": "page_home",
    "trigger": "click",
    "transition": "slide-left"
  }
]
```

---

## 6. 校验与修复链路

```
LLM 原始输出
  ① 提取：剥离 ```json 围栏，定位最外层 { }
  ② 宽松解析：JSON.parse + 尾逗号/单引号容错
  ③ 结构性校验（宽松档）：必需字段存在 + 类型正确 + 枚举合法
  ④ 语义修补（可自动）：
       - 缺 id → 按 type+序号补
       - 缺 layout → 按 type 默认布局补
       - enum 越界 → 取最接近合法值
       - Token 引用失效 → 回退字面量或默认色
  ⑤ 通过 → 入 project.store；失败 → 生成「修复提示」追加到对话重试（≤2 次）
  ⑥ 仍失败 → 降级：保留失败原文供用户查看 + 提示改用更小粒度重试
```

**自动可修复 vs 需重试 的分界**：

| 类别 | 处理 |
|---|---|
| 可自动补全（缺 id/layout/props 默认值） | 静默修补 |
| 可自动纠正（枚举越界、Token 失效） | 静默纠正 + 记录 warning |
| 需重试（JSON 语法错误、根结构缺失 pages） | 追加修复提示重试 |
| 无法修复（返回空、返回拒绝性文本） | 降级提示 + 建议换模型/换描述 |

---

## 7. 类型定义（TypeScript，与 Schema 一一对应）

```ts
// src/types/design.ts —— 与本文档 Schema 严格对应
export type Device = 'MOBILE' | 'TABLET' | 'DESKTOP' | 'RESPONSIVE'
export type SizeValue = number | 'auto' | 'fill' | 'fit' | `${number}%`
export type PaintRef = string | Record<string, unknown>

export interface DesignJSON {
  schemaVersion: string
  meta: Meta
  tokens: Tokens
  assets: Asset[]
  pages: Page[]
  flows: Flow[]
}

export interface Meta {
  id: string; name: string; device: Device
  canvas: { width: number; height: number }
  createdAt: string; updatedAt: string
  source: 'ai' | 'mock' | 'blank' | 'import'
  prompt?: string
}

export interface Tokens {
  color?: Record<string, string>
  font?: Record<string, { family: string; size: number; weight?: number; lineHeight?: number; letterSpacing?: number }>
  space?: Record<string, number>
  radius?: Record<string, number>
  shadow?: Record<string, { x: number; y: number; blur: number; spread?: number; color: string }>
}

export interface Asset { id: string; type: 'image' | 'icon' | 'font'; src: string; mime?: string; width?: number; height?: number }

export interface Page {
  id: string; name: string; order: number
  pos: { x: number; y: number }
  background?: string
  root: Node
}

export type NodeType = /* §3 NodeType enum 全量 */

export interface Node {
  id: string; type: NodeType
  name?: string
  layout?: Layout
  style?: Style
  props?: Record<string, unknown>
  children?: Node[]
  states?: Record<string, { style?: Partial<Style>; props?: Record<string, unknown> }>
  locked?: boolean
  hidden?: boolean
}

export interface Layout {
  mode?: 'absolute' | 'flex' | 'grid'
  x?: number; y?: number
  width?: SizeValue; height?: SizeValue
  direction?: 'row' | 'column'
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline'
  gap?: number
  padding?: Edges; margin?: Edges
  columns?: number; wrap?: boolean
  position?: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky'
  zIndex?: number; grow?: number
  selfAlign?: 'auto' | 'start' | 'center' | 'end' | 'stretch'
}

export interface Edges { t?: number; r?: number; b?: number; l?: number }

export interface Style {
  fill?: PaintRef
  stroke?: { color?: PaintRef; width?: number; position?: 'inside' | 'center' | 'outside' }
  radius?: number | string | { tl?: number; tr?: number; br?: number; bl?: number }
  shadow?: Array<{ x: number; y: number; blur: number; spread?: number; color: string }>
  opacity?: number
  overflow?: 'visible' | 'hidden' | 'scroll' | 'auto'
  font?: { family?: string; size?: number; weight?: number; lineHeight?: number; letterSpacing?: number; italic?: boolean }
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  textColor?: PaintRef
  textDecoration?: 'none' | 'underline' | 'line-through'
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  maxLines?: number
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none'
  cursor?: 'default' | 'pointer' | 'text' | 'grab' | 'not-allowed'
}

export interface Flow {
  id: string; from: string; fromPage: string; to: string
  trigger: 'click' | 'hover' | 'longPress' | 'submit' | 'back'
  transition?: 'none' | 'slide-left' | 'slide-right' | 'fade' | 'slide-up'
  params?: Record<string, unknown>
}
```

---

## 8. 版本演进策略

| 变更类型 | 处理方式 | 兼容性 |
|---|---|---|
| 新增可选字段 | 直接加，老文件缺该字段走默认值 | 向后兼容 |
| 新增节点类型 | 加进 enum，老渲染器遇到未知类型降级为 `frame` | 向后兼容 |
| 新增交互触发方式 | 加进 enum，老导出器忽略 | 向后兼容 |
| 修改既有字段语义 | 升 `schemaVersion`（如 2.0），加载时跑迁移器 | **破坏性，需迁移** |
| 删除字段 | 升版 + 迁移器把旧值映射到新位置 | **破坏性，需迁移** |

**迁移器约定**：`src/services/schema/migrations/index.ts` 维护 `1.0 → 1.1 → ...` 的链式迁移函数，加载项目时先读 `schemaVersion` 再逐级迁移到当前版本。v1.0 阶段只需预留接口。

---

## 9. 对下游的交付

| 下游 | 用途 |
|---|---|
| S2-3 组件体系 | `NodeType` 全量枚举即组件清单来源；每个 type 的 `props` 契约在此扩充 |
| S2-5 Prompt 方案 | 本 Schema 将内嵌进生成 Prompt 作为强约束；修复链路规则直接复用于生成容错 |
| S3-3A | `src/types/design.ts` 可直接落地；示例 JSON 作为开发期渲染验证数据 |
| S3-3C 编辑器 | `applyPatch` 的操作粒度按本 Schema 的字段路径定义 |
| S3-3D 跳转 | `flows` 表结构与流视图渲染直接对齐 |
| S3-3E 导出 | HTML 生成器按 `flows` 生成事件绑定；SVG 生成器按节点树序列化 |
