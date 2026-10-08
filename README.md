# 望舒

> 本地 AI 产品设计助手 —— 用自然语言生成可编辑的界面原型，像设计工具一样改，导出为能直接打开的产物。

纯本地桌面客户端。**无服务器、无账号、无遥测**；所有设计保存在标准 JSON 中，随时可查看、备份、手工修改。

| 项目 | 说明 |
|---|---|
| **产品版本** | `1.1.0` |
| **形态** | Electron 桌面客户端（Windows x64） |
| **技术栈** | Electron + React + TypeScript + Vite + Zustand |
| **许可** | MIT |

---

## 这是什么

你描述想要的产品，望舒规划页面结构、定稿设计规范、逐页生成界面，然后你可以拖拽调整、改文案改属性，最后导出为 HTML / 图片 / 设计源文件。

### 能做什么

- **从一句话到多页原型** —— 描述需求，自动规划页面结构、定稿设计规范、逐页生成
- **真实可视化编辑** —— 拖拽移动、缩放调整、改属性、改文案，全部实时生效
- **全局设计一致性** —— 改一个主色，所有引用它的元素同步更新
- **可点原型** —— 配置页面跳转后，预览时点击真实跳转，可验证完整流程
- **多方案对比** —— 为同一页面生成多个差异化变体，挑选后采纳
- **五种导出格式** —— HTML 单文件 / HTML 工程 / PNG / SVG / 设计源文件

### 三条设计原则

| 原则 | 含义 |
|---|---|
| **纯本地** | 无服务器、无账号、无遥测。只有你主动配置模型时才会产生网络请求 |
| **数据即文件** | 所有设计保存在标准 JSON 中，可随时查看、备份、手工修改 |
| **所见即所得** | 画布、预览、导出共用同一套渲染引擎，导出结果与画布完全一致 |

---

## 核心能力

### 生成与编辑

| 能力 | 说明 |
|---|---|
| **AI 生成** | 采用 OpenAI 兼容协议；内置 OpenAI / DeepSeek / Moonshot / 通义千问 / 智谱 GLM 预设地址，也可填任意兼容端点 |
| **提示词增强** | 把口语化描述改写为 8 区块结构化需求简报（产品概述 / 目标用户与场景 / 页面结构 / … / 待确认事项），**就地覆盖输入框内容并可撤回** |
| **五级容错解析** | JSON 抽取 → 宽松解析 → 结构校验 → 语义修补 → 项目组装，模型返回不规范也能落地 |
| **可视化编辑** | 事务式编辑内核，支持撤销重做、操作合并、增删改查 |
| **设计规范引用** | 解析规范文件并把 Token / 组件注入生成上下文，保证多页风格一致 |
| **页面优化** | 对已有页面做问题检出与优化建议，可生成优化变体 |
| **页面自动补全** | 检测断链与缺失交互状态，推理跳转关系并补齐页面 |
| **自定义风格** | 从文字描述生成风格，或从图片 / HTML 中提炼设计风格（色值量化 → 调色板 → Token），保存后复用 |
| **外观主题** | 四套内置主题：`night`（默认）/ `dawn` / `ocean` / `ink` |

### 项目管理（1.1.0 新增，F-PM-01 ~ F-PM-09）

| 编号 | 能力 | 说明 |
|---|---|---|
| **F-PM-01** | 项目中心 | 从扁平按钮升级为可视化工作台 |
| **F-PM-02** | 项目元数据治理 | 分组 / 标签 / 收藏 / 缩略图 / 摘要 |
| **F-PM-03** | 多项目并行与快速切换 | 多窗口打开 + 悬浮切换器 + 会话恢复 + 快照 |
| **F-PM-04** | 界面—项目关联模型 | 显式契约 + 8 条不变量校验 |
| **F-PM-05** | 界面数量 N 的配置与扩展 | 三档配额语义，见下 |
| **F-PM-06** | DESIGN.md 互操作 | 导入 / 导出设计系统，与 Stitch、Claude Code 互通 |
| **F-PM-07** | 多方案并行 | 同一需求并行开多条设计分支，横向对比择优 |
| **F-PM-08** | 本地开放接口 | 内置 MCP 服务，让外部 Agent 驱动望舒 |
| **F-PM-09** | 无限画布编排增强 | 画布分组、缩放导航、界面集折叠 |

#### 界面数量 N 的三档语义

| 档位 | 行为 |
|---|---|
| `planned` | 生成目标数量 |
| `softLimit` | 超过则提示，但**允许**继续（默认 20） |
| `hardLimit` | 超过则**禁止**（默认 100；填 `0` 表示不限） |

另有全局兜底上限 `GLOBAL_MAX_PAGES = 500`。

#### 8 条数据不变量

| 编号 | 约束 |
|---|---|
| `I-1` | 至少一页 |
| `I-2` | 界面 id 唯一 |
| `I-3` | `activePageId` 有效 |
| `I-4` | flows 两端可达 |
| `I-5` | `page.specId` 可达 |
| `I-6` | `meta.specId` 可达 |
| `I-7` | assets 可解析（warn） |
| `I-8` | `groupId` 不孤儿 |

---

## 本地 MCP 服务

望舒内置一个 MCP 服务，把项目能力以工具形式暴露给外部 Agent。

- **协议**：MCP `2025-06-18`，Streamable HTTP 最简形态
- **监听**：仅 `127.0.0.1`，不对外暴露
- **鉴权**：Bearer token
- **工具数**：13 个

| 工具 | 作用 |
|---|---|
| `wanshu_app_info` | 应用与版本信息 |
| `wanshu_list_projects` | 列出项目 |
| `wanshu_get_project` | 读取项目 |
| `wanshu_create_project` | 创建项目 |
| `wanshu_save_project` | 保存项目 |
| `wanshu_duplicate_project` | 复制项目 |
| `wanshu_remap_project` | 重映射项目 |
| `wanshu_list_interfaces` | 列出界面 |
| `wanshu_create_interfaces` | 创建界面 |
| `wanshu_list_snapshots` | 列出快照 |
| `wanshu_list_specs` | 列出设计规范 |
| `wanshu_import_design_md` | 导入 DESIGN.md |
| `wanshu_export_design_md` | 导出 DESIGN.md |

---

## 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Electron `44.4.5` |
| 渲染层 | React `19.3` + Zustand `5.0` |
| 语言 | TypeScript `5.9`（`strict: true`） |
| 构建 | Vite `7.3`（渲染层） + esbuild `0.25`（主进程） |
| 打包 | electron-builder `26.15` |
| 测试 | Node 原生脚本 + esbuild 即时转译，**零测试框架依赖** |

---

## 目录结构

```
stitch/
├── analysis/          S1 调研与拆解（产品定位、功能拆解、交互还原、可复用性研究）
├── app/               应用本体
│   ├── electron/      主进程
│   │   ├── main/        窗口、IPC、存储、LLM 代理、MCP 服务
│   │   └── preload/     渲染层与主进程之间的桥
│   ├── shared/        主进程与渲染进程共用（唯一数据源所在）
│   │   ├── design.ts    Design JSON 类型、SCHEMA_VERSION、FILE_VERSION
│   │   ├── version.ts   产品版本与名称的唯一事实来源
│   │   └── …            quota / interfaces / design-md / ids
│   ├── src/           渲染进程（React）
│   │   ├── components/  canvas / hub / layout / overlays / panels / settings / ui
│   │   ├── services/    ai / config / design / export / project / render
│   │   ├── stores/      config / project / theme / ui / workspace
│   │   └── hooks/  lib/  styles/
│   ├── scripts/       构建、测试、图标生成
│   ├── build/         图标产物（electron-builder 直接依赖，已入库）
│   └── package.json
└── docs/              设计与工程文档
```

> `app/electron` 与 `app/src` **不是独立仓库** —— 整个项目只有一个 Git 仓库，根目录即仓库根。

---

## 快速开始

### 环境要求

- **Node.js ≥ 22.12**（Vite 7 要求 `^20.19 || >=22.12`；Electron 44 要求 `>= 22.12`）
- Windows x64（当前打包目标）
- 生成图标需要 Python + Pillow（可选，产物已入库）

### 安装与运行

```bash
cd app
npm install

npm run dev               # 开发模式（Vite HMR + Electron）
npm run preview:app       # 先完整构建，再用 Electron 启动
```

### 打包

```bash
cd app
npm run build             # 类型检查 + 主进程 + 渲染层
npm run dist              # NSIS 安装包 + 便携版
npm run dist:portable     # 只要便携版
```

打包时建议带镜像环境变量，否则 electron-builder 的签名工具下载可能失败：

```bash
ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" npm run dist
```

**产物目录**：`app/out/artifacts/`

| 产物 | 说明 |
|---|---|
| `望舒 Setup 1.1.0.exe` | NSIS 安装包，可选安装目录 |
| `望舒-1.1.0-portable.exe` | 便携版，免安装、不写注册表 |
| `win-unpacked/望舒.exe` | 解压后的可执行目录 |

> 改了 `electron/` 或 `src/` 之后**必须重新打包**才算交付 —— `npm run verify` 只做类型检查、测试与构建，**不生成安装包**。

---

## 测试

零测试框架依赖，全部基于 Node 原生脚本 + esbuild 即时转译被测 TypeScript 源码。

```bash
cd app

npm run test:all          # 全部 11 个套件
npm run verify            # 类型检查 + 全部测试 + 构建（交付前跑这个）
npm run test:close        # 窗口关闭流程真机实测（真实 Electron）
```

**当前基线：11 套件 1014 项，全绿。**

| 套件 | 断言数 | 覆盖重点 |
|---|---|---|
| `test-enhancer` | 26 | 提示词增强：输入分级 / 术语规范化 / 意图保全 / 幂等 / 降级 |
| `test-parse` | 43 | 五级容错解析 |
| `test-pipeline` | 38 | 生成流水线 E2E |
| `test-editor` | 42 | 编辑内核：事务 / 撤销重做 / 操作合并 |
| `test-export` | 34 | 五种导出格式 / 自包含性 / 转义 |
| `test-specs` | 149 | 设计规范引用 / Token 映射 / 组件复用 |
| `test-defects` | 82 | 关闭决策表 / 状态机不变量 / 画布对齐 / 主题 |
| `test-optimize` | 103 | 页面优化 |
| `test-autofill` | 174 | 页面自动补全 |
| `test-style-extract` | 121 | 风格提炼：色值量化 / 调色板 → Token / HTML 提炼 |
| `test-project` | 202 | 项目模型 F-PM-01~09 / 版本号护栏 / 8 条不变量 / DESIGN.md 往返 |

> 涉及**窗口与进程行为**的结论必须有真机实测（`npm run test:close`），纯函数单测不足以证明。

### 图标

```bash
cd app
npm run icons             # 由 scripts/make-icons.py 生成全部档位（需 Pillow）
npm run icons:verify      # 解析 PE 资源目录，核验 exe 图标档位齐全
```

图标按尺寸分档渲染（≤24px 关柔光去星芒，≤48px 柔光减半星芒放大，≥64px 标准档），
产物覆盖 16 / 24 / 32 / 48 / 64 / 128 / 256 / 512。

---

## 版本号规范

项目里同时存在**四种**「版本」，变更节奏完全不同，**互不联动**。详见 [`docs/版本号规范.md`](docs/版本号规范.md)。

| # | 版本 | 当前值 | 唯一事实来源 | 变更触发条件 |
|---|---|---|---|---|
| 1 | **产品版本** | `1.1.0` | `app/shared/version.ts` `APP_VERSION` | 每次对外交付 |
| 2 | **项目文件格式版本** | `1.0` | `app/shared/design.ts` `FILE_VERSION` | `.dsproj` 信封结构断裂 |
| 3 | **Design JSON Schema** | `1.2` | `app/shared/design.ts` `SCHEMA_VERSION` | 增删字段、改字段语义 |
| 4 | **文档修订号** | `v1.1` | 各文档头部 | 文档实质修订 |

产品版本的**唯一可写位置**是 `app/shared/version.ts`，其余位置一律引用；需人工同步的只有 `package.json`（npm 与 electron-builder 不读 TS）。`npm run test:project` 会断言两条链不分叉。

### 版本记录

| 产品版本 | 类型 | 主要内容 |
|---|---|---|
| `1.0.0` | 首发 | 核心四链路（生成 / 编辑 / 跳转 / 导出）+ 变体 + 提示词增强 + 四套主题 |
| `1.1.0` | MINOR | 项目管理 F-PM-01~09 + 图标分档优化 + 版本号统一；Schema `1.1 → 1.2`（新增字段全部可选，向后兼容） |

---

## 数据与文件

| 内容 | 位置 |
|---|---|
| 项目文件 | `<文档目录>/望舒/*.dsproj` |
| 设计源文件导出 | `dsproj.json`（可在本工具重新导入继续编辑） |
| 最近项目 / 方案分支 / 偏好设置 | Electron `userData` 目录 |

项目文件是标准 JSON，外层信封为 `ProjectFile { fileVersion, design }`。

---

## 文档索引

### 产品与需求

| 文档 | 内容 |
|---|---|
| [`docs/产品使用说明文档.md`](docs/产品使用说明文档.md) | 完整使用说明、快捷键、常见问题 |
| [`docs/大模型配置操作指南.md`](docs/大模型配置操作指南.md) | 各服务商配置步骤 |
| [`docs/功能设计-项目管理与Stitch对标.md`](docs/功能设计-项目管理与Stitch对标.md) | F-PM-01~09 设计（1.1.0 主线） |
| [`docs/功能设计-对标Stitch能力增强.md`](docs/功能设计-对标Stitch能力增强.md) | 规范引用 / 补全 / 变体 / 优化 |
| [`docs/功能设计-提示词增强.md`](docs/功能设计-提示词增强.md) | 提示词增强设计 |
| [`docs/任务分解-WBS.md`](docs/任务分解-WBS.md) ・ [`docs/项目工作计划.md`](docs/项目工作计划.md) | 计划与拆解 |

### 工程与规范

| 文档 | 内容 |
|---|---|
| [`docs/S2-1-技术架构设计.md`](docs/S2-1-技术架构设计.md) | 架构总览 |
| [`docs/S2-2-Design-JSON-Schema.md`](docs/S2-2-Design-JSON-Schema.md) | 数据模型定义 |
| [`docs/S2-3-组件体系与设计Token.md`](docs/S2-3-组件体系与设计Token.md) | 组件体系与 Token |
| [`docs/S2-4-交互与UI规范.md`](docs/S2-4-交互与UI规范.md) | 交互与视觉规范（含应用图标规范） |
| [`docs/S2-5-LLM接入与Prompt方案.md`](docs/S2-5-LLM接入与Prompt方案.md) | 模型接入与 Prompt 方案 |
| [`docs/版本号规范.md`](docs/版本号规范.md) | 四种版本号规则与升级 Checklist |
| [`docs/测试报告.md`](docs/测试报告.md) | 测试策略、结果与缺陷记录 |

### 调研

[`analysis/`](analysis/) —— S1 阶段六篇：产品定位与价值体系、核心功能全量拆解、全链路交互流程还原、界面布局与信息架构、结论与落地建议、可复用性研究。

---

## 许可

MIT
