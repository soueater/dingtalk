# 功能设计 · 项目管理与 Google Stitch 对标（F-PM-01 ~ F-PM-09）

> 归属：望舒 · 项目层 / 工作台 / 界面编排
> 版本：v1.1 ｜ 状态：**已实现**（S1→S7 全部落地，随产品 v1.1.0 交付）
> 落地顺序：S1 数据契约 → S2 主进程/IPC → S3 项目中心 → S4 界面数量 N → S5 DESIGN.md → S6 分支与画布 → S7 本地 MCP
> 关联文档：`analysis/S1-2-核心功能全量拆解.md`（§7 项目与代理管理）、`docs/S2-2-Design-JSON-Schema.md`、`docs/功能设计-对标Stitch能力增强.md`（F-ST-01~04）、`docs/测试报告.md`
> 代码基线：`app/` @ v1.1.0（Electron 44.4.5 + React 19.3.0 + Zustand 5.0.15，`shared/design.ts` SCHEMA `1.2`）

---

## 0. 评审速览（TL;DR）

本方案要回答四个问题：**项目怎么建怎么管**、**界面凭什么属于某个项目**、**界面数量 N 谁来定、怎么扩**、**凭什么说超过了 Stitch**。

调研后有一个前置结论必须先讲清楚 —— **望舒的项目/界面底座不是"没有"，而是"没有显性化的 UI 层"**：

| 被问到的能力 | 望舒现状 | 结论 |
|---|---|---|
| 支持创建多个不同项目 | `projectFs.list/scan/open/save/saveAs/deleteFile` + `recent-projects.json`（最多 30 条）+ 8 条 `project:*` IPC 已全量就位 | **已有**（缺工作台 UI） |
| 为每个项目创建 N 个界面 | `DesignJSON.pages: Page[]` + `PageList.tsx` 完整 CRUD（新建/复制/删除/重命名，全部走 `commit` 事务） | **已有**（缺数量语义） |
| 界面与项目的关联关系 | 客观存在：`Page[]` 内嵌于 `.dsproj` 的 `design.pages`，`Page.id` 全局唯一，`meta.id` 为项目主键 | **已有**（缺显式约束与文档化） |
| 界面数量 N 的配置与扩展 | **完全空白**：无配额字段、无批量入口、无生成期页数控制 | **缺**（本方案主体） |

因此本方案的设计手法是 **「显性化 + 补工作台 + 补配额语义」**，而不是推倒重来。新增编号 **F-PM-01 ~ F-PM-09**，与既有的 F-ST-01~04 互补（F-ST 管「画得好不好」，F-PM 管「放得下、找得到、管得住」）。

| 编号 | 功能 | 一句话目标 | 优先级 | 现有底座 |
|---|---|---|---|---|
| **F-PM-01** | 项目中心（Project Hub） | 从扁平按钮升级为可视化工作台 | **P0** | `projectFs.list/scan` + `project:list` IPC + `ProjectMeta` |
| **F-PM-02** | 项目元数据治理 | 分组 / 标签 / 收藏 / 缩略图 / 摘要 | **P1** | `ProjectMeta.thumbnail?` 字段已预留未用 |
| **F-PM-03** | 多项目并行与快速切换 | 多窗口打开 + 悬浮切换器 + 会话恢复 | **P1** | 主进程 `createWindow()` 已可复用 |
| **F-PM-04** | 界面—项目关联模型 | 把隐性内嵌关系升级为显式契约 + 不变量校验 | **P0** | `Page` / `Flow` / `Asset` 类型齐备 |
| **F-PM-05** | 界面数量 N 的配置与扩展 | 三档配额 + 四种配置入口 + 六路扩展机制 | **P0** | 无（全新增） |
| **F-PM-06** | DESIGN.md 互操作 | 导入 / 导出设计系统，与 Stitch / Claude Code 互通 | **P1** | `DesignSpec` + `style-extract.ts` 已可产出 Token |
| **F-PM-07** | 多方案并行（Agent Manager） | 同一需求并行开 N 条设计分支，横向对比择优 | **P2** | `commit` 事务 + `variantCount` 变体链路 |
| **F-PM-08** | 开放接口（本地 MCP / SDK） | 让外部 Agent 驱动望舒生成项目 | **P2** | `ipc.ts` 已是统一入口，易挂 MCP 适配层 |
| **F-PM-09** | 无限画布编排增强 | 画布分组、缩放导航、界面集折叠 | **P2** | `Page.pos` / `Page.order` 已支持空间排布 |

**落地顺序一句话**：先立契约（F-PM-04 把关联关系写死 + 校验）→ 再补配额（F-PM-05，因为生成器要消费它）→ 再做工作台（F-PM-01/02/03）→ 然后互操作（F-PM-06）→ 最后并行与开放（F-PM-07/08/09）。

**需评审确认的决策点**见 §8。

---

## 1. 背景与现状盘点

### 1.1 需求拆解

原始需求一句话包含四个独立子命题，必须分开设计、分别验收：

| # | 子命题 | 关键问题 | 本方案章节 |
|---|---|---|---|
| ① | 项目的创建与管理方式 | 在哪建？怎么建？怎么组织？怎么删？ | §3（F-PM-01/02/03） |
| ② | 功能界面与项目的关联关系 | 关联靠什么字段？一对几？怎么保证不悬空？ | §4（F-PM-04） |
| ③ | 界面数量 N 的配置与扩展机制 | N 是计划值还是上限？谁设？满了怎么加？ | §5（F-PM-05） |
| ④ | 对标 Stitch 梳理与补齐 | 差哪些？怎么补？凭什么说更好？ | §6（F-PM-06~09） |

### 1.2 望舒现状盘点

#### 1.2.1 已有的资产（可直接复用）

| 资产 | 位置 | 说明 |
|---|---|---|
| `ProjectFile { fileVersion, design }` | `shared/design.ts:200` | 单文件承载全项目，`FILE_VERSION='1.0'` |
| `DesignJSON { schemaVersion, meta, tokens, assets, pages, flows, specs? }` | `shared/design.ts:13` | 唯一数据源，SCHEMA `1.1` |
| `Meta { id, name, device, canvas, createdAt, updatedAt, source, prompt?, specId? }` | `shared/design.ts:24` | 项目级元数据，**已有 `specId` 两级继承的上级** |
| `Page { id, name, order, pos, background?, root, specId? }` | `shared/design.ts:70` | 界面实体，`specId` 为下级覆盖 |
| `Flow { id, from, fromPage, to, trigger, transition?, params? }` | `shared/design.ts:188` | **已带 `fromPage` / `to`，天然支持跨界面跳转** |
| `projectFs`（`list`/`scan`/`open`/`save`/`saveAs`/`touch`/`remove`/`deleteFile`/`defaultDir`） | `electron/main/project-fs.ts:55` | 最近项目 30 条上限，`RECENT_FILE='recent-projects.json'`，`EXT='.dsproj'`，默认目录 `文档/望舒` |
| 8 条项目 IPC | `electron/main/ipc.ts:42-117` | `project:list` / `openByDialog` / `open` / `save` / `saveAs` / `remove` / `revealInFolder` / `defaultDir` |
| `ProjectState`（`path`/`design`/`dirty`/`undoStack`/`redoStack`/`activePageId`/`selectedIds`） | `stores/project.store.ts` | 含 `newProject`/`loadProject`/`loadMock`/`closeProject`/`commit`/`undo`/`redo`/`setActivePage`/`renameProject`/`setDesignMeta`/`bindSpec`/`bindPageSpec`/`upsertSpec`/`removeSpec` |
| `commit(label, mutator, opts)` 事务 + 100 步撤销栈 | `stores/project.store.ts:38` | 所有项目/界面变更的**唯一合法通道**，F-PM 全系列直接复用 |
| `actions.ts`：`newProject`/`openProject`/`saveProject`/`saveProjectAs`/`exportProject`/`revealProjectFolder` | `services/project/actions.ts` | 面向 UI 的高层动作，已有错误兜底 |
| `ProjectMeta { id, name, updatedAt, createdAt, device, pageCount, path, thumbnail? }` | `shared/design.ts:209` | **`pageCount` 已在算、`thumbnail?` 已预留但从未写入** |

> **判断**：项目与界面的**数据底座和 CRUD 能力是完整的**。用户感知的"没有项目管理"，本质是**缺少把这些能力暴露出来的工作台 UI**，以及**缺少"数量"这一维度的语义**。

#### 1.2.2 缺口清单（本方案要补的）

| # | 缺口 | 现状证据 | 影响 |
|---|---|---|---|
| G-1 | 无项目中心 / 工作台 UI | `Titlebar.tsx:46-60` 只有「新建 / 打开 / 保存」三个扁平按钮，无列表视图 | 用户无法直观看到"我有多少项目" |
| G-2 | 最近项目列表无 UI 暴露 | `project:list` IPC 已存在，仅 `bootstrap.ts` 用于自动恢复最近一个 | 切项目必须走系统文件对话框 |
| G-3 | 无项目组织能力 | `project-fs.ts` 只存路径字符串数组，无分组/标签/收藏 | 项目多了找不到 |
| G-4 | `thumbnail?` 字段闲置 | `shared/design.ts:218` 定义后全项目零写入 | 项目中心无法做视觉化卡片 |
| G-5 | 无界面数量配额 | 全项目无 `MAX_PAGES` / `interfaceQuota` 类常量 | N 无法配置、无法约束 |
| G-6 | 无批量界面创建 | `PageList.tsx:18 addPage` 仅单个新增 | 生成 5 个界面的流程要手工点 5 次 |
| G-7 | 生成期不控制页数 | 生成链路按 prompt 自由发挥产出 `pages[]` | N 不可预期 |
| G-8 | 删除最后一个界面时静默失败 | `PageList.tsx:44-47` 「`if (length<=1) { useProjectStore.getState(); return }`」—— 空语句，无 toast | **可修缺陷** |
| G-9 | 界面无分组 | `Page` 无 `groupId` 字段 | 10 个界面平铺，无法按"功能模块"归拢 |
| G-10 | 无项目级版本快照 | 仅有内存态 100 步撤销栈，关闭即失 | 误操作不可跨会话恢复 |
| G-11 | 无 DESIGN.md 互操作 | `DesignSpec` 仅有 JSON 形状 | 与 Stitch / Claude Code 断链 |
| G-12 | 无并行方案 / Agent 能力 | S1-2 §7 明确 Stitch 有 Design Agent + Agent Manager | 对标缺口 |
| G-13 | 无开放接口 | S1-2 §6 明确 Stitch 有 MCP / SDK | 对标缺口 |

### 1.3 Google Stitch 现状（2026.03 版）

依据 `analysis/S1-2-核心功能全量拆解.md` §7 与本轮检索到的官方信息：

| 能力 | 说明 | Stitch 状态 |
|---|---|---|
| 项目列表 | 主控制台，最近项目 + 官方 Examples 预设 | ✅ 已有 |
| AI 原生无限画布 | 所有界面平铺在一张无边界画布上，可自由缩放平移 | ✅ 2.0 核心 |
| 多屏生成 | 一次生成一"组"界面（如底部导航三个板块） | ✅ 2.0 新增 |
| 语音实时交互（Vibe Design） | 画布中直接说话改设计 | ✅ 2.0 新增 |
| DESIGN.md | 可从**任意 URL** 提取设计系统；可导出/导入设计规则到其他项目 | ✅ 已有，且**跨工具通用**（Claude Code / v0） |
| Design Agent | 追踪项目历史、跨版本推理 | ✅ 实验特性 |
| Agent Manager | 并行管理多个设计分支，避免多方向探索时分支混乱 | ✅ 实验特性 |
| Stitch MCP server / SDK / Skills | 外部 Agent 驱动 Stitch；**无 REST API** | ✅ 已有 |
| 导出目标 | 代码（HTML/CSS）/ Figma / Google Antigravity / AI Studio / Netlify | ✅ 已有 |
| 计费 | 免费 + 月度生成额度上限 | ⚠️ 额度受限 |
| 形态 | 云端 Web，Labs beta，**有被砍历史** | ⚠️ 存续风险 |

**Stitch 的软肋**（`analysis/S1-2` §8 约束清单已记录）：云端存续风险（C-13）、Experimental 模式功能阉割（C-12）、生成额度受限、无本地私密性、代码只读需复制（C-11）。

---

## 2. 领域模型：三层结构

### 2.1 概念层级

```
Workspace（本地工作区，隐式 = 用户磁盘）
  └── Project（项目，对应一个 .dsproj 文件）
        ├── DesignSpec[]（项目内规范库，可跨项目共享 → F-PM-06）
        ├── PageGroup[]（界面分组，可选，对应"功能模块"）
        └── Page[]（功能界面，N 个）
              └── Node（节点树，页面内容）
        └── Flow[]（跨界面跳转，fromPage → to）
        └── Asset[]（项目内资源）
```

### 2.2 关键定义

| 概念 | 定义 | 实体 | 主键 |
|---|---|---|---|
| **项目（Project）** | 一个交付单元，一次业务/产品的设计集合 | `ProjectFile` | `design.meta.id` |
| **界面（Interface）** | 项目内的一个可独立预览的功能屏幕，等价于 Stitch 的 Screen | `Page` | `Page.id`（全局唯一） |
| **界面分组（PageGroup）** | 项目内的界面归拢单元，如"登录模块 / 首页模块" | `PageGroup` | `PageGroup.id` |
| **节点（Node）** | 界面内的 UI 元素，不跨界面复用实例（只可复制） | `Node` | `Node.id`（界面内唯一） |

> **术语统一**：本方案及后续代码统一使用「**界面**」指代 `Page`，不再混用"页面"（"页面"仅用于预览/导出语境）。用户可见文案统一为「界面」。

### 2.3 关联关系图

```
                ┌──────────────────────────────────────────────────┐
                │  .dsproj（JSON，单文件承载）                       │
                │                                                  │
                │  ProjectFile.fileVersion = '1.0'                  │
                │  └─ DesignJSON.schemaVersion = '1.1' → '1.2'      │
                │      ├─ meta.id ──────────────────── 项目主键      │
                │      ├─ meta.specId ──┐                           │
                │      ├─ specs[]       │  项目级默认规范            │
                │      ├─ pages[] ──────┼── Page.specId（就近覆盖） │
                │      │    ├─ id（全局唯一）                        │
                │      │    ├─ order（列表序）                       │
                │      │    ├─ pos {x,y}（画布坐标）                 │
                │      │    ├─ groupId?（→ PageGroup.id）           │
                │      │    └─ root: Node                           │
                │      ├─ pageGroups[]?（F-PM-05 新增）             │
                │      ├─ flows[] { from, fromPage, to } ── 跨界面  │
                │      └─ assets[] { id, src, mime }                │
                └──────────────────────────────────────────────────┘
                            │
                            │ projectFs.touch() 维护
                            ▼
                recent-projects.json : string[]  （最近 30 条路径）
                            │
                            │ buildMeta() 派生
                            ▼
                ProjectMeta { id, name, pageCount, path, thumbnail? }
                            │
                            ▼
                   F-PM-01 项目中心列表卡片
```

---

## 3. F-PM-01/02/03 · 项目的创建与管理

### 3.1 项目的创建方式（四条路径）

| # | 路径 | 入口 | 说明 | 复用 |
|---|---|---|---|---|
| C-1 | **空白项目** | 项目中心「新建」→ 选设备 + 界面数 N | 直接落一个空壳项目（`meta.source='blank'`，含 1 个空界面） | `project.store.newProject(device)` |
| C-2 | **AI 生成** | 项目中心「AI 新建」→ 填需求描述 + 选 N + 选规范 | 进入主界面，自动触发生成流程产出 N 个界面 | `newProject()` + 生成链路 |
| C-3 | **从模板** | 项目中心「从模板」→ 选模板（登录流 / 电商首页流 / 后台管理流 …） | 模板 = 预置的 `pages[]` 骨架（含 `flows`），可含占位文案 | **新增** `INTERFACE_TEMPLATES` 注册表 |
| C-4 | **从文件导入** | 项目中心「导入」→ 选 `.dsproj` / `DESIGN.md` / 一组 HTML | `.dsproj` 走 `project:open`；`DESIGN.md` 转 `DesignSpec`（F-PM-06）；HTML 组走 `style-extract` + 结构解析 | `project:openByDialog` + F-PM-06 |

**创建向导（Create Wizard）** 统一收口这四条路径，三步：

```
① 来源选择：空白 / AI 生成 / 模板 / 导入
② 基本参数：项目名、目标设备（MOBILE / TABLET / DESKTOP / RESPONSIVE）、
            设计规范（内置 4 套 / 我的规范库 / 不绑定）
③ 界面规划：计划界面数 N（滑块 1~N_max，默认 1；AI 生成时必填）
            可选：勾选"先生成界面清单待确认"（见 §5.3）
        ↓
   [创建] → 落盘 .dsproj 到 文档/望舒/<项目名>.dsproj → 打开主界面
```

> **落盘策略**：C-1/C-3 创建即落盘（避免用户关掉就没了）；C-2/C-4 生成成功后再询问落盘路径，失败则保留为未保存会话。

### 3.2 F-PM-01 · 项目中心（Project Hub）

这是把 G-1/G-2 补掉的核心界面。定位：**启动默认页 + 全局项目导航中枢**。

#### 3.2.1 信息架构

```
┌─ 项目中心 ────────────────────────────────────────────────────────────┐
│ [+ 新建]  [AI 新建]  [从模板]  [导入]        🔍 搜索…   排序▾  视图▾  │
├─ 侧栏 ──────────┬─ 主区 ──────────────────────────────────────────────┤
│ ▸ 全部项目 (12)  │  ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│ ▸ ★ 收藏 (3)     │  │ [缩略图] │ │ [缩略图] │ │ [缩略图] │              │
│ ▸ 最近打开       │  │ 电商 App │ │ 后台管理 │ │ 落地页   │              │
│ ▸ 未保存会话     │  │ 7 界面   │ │ 12 界面  │ │ 1 界面   │              │
│                  │  │ MOBILE   │ │ DESKTOP  │ │ RESPONSIVE│             │
│ 分组             │  │ 2 小时前 │ │ 昨天     │ │ 3 天前   │              │
│ ▸ 产品线 A (5)   │  └──────────┘ └──────────┘ └──────────┘              │
│ ▸ 产品线 B (4)   │  …                                                   │
│ ▸ 未分组 (3)     │                                                      │
│                  │                                                      │
│ 标签             │                                                      │
│ # 客户端 # 内部  │                                                      │
├──────────────────┴──────────────────────────────────────────────────────┤
│ 共 12 个项目 · 4 个分组 · 最近同步 10:42                                │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 3.2.2 卡片信息

每张项目卡片展示 `ProjectMeta` 派生字段：

| 展示项 | 数据来源 | 状态 |
|---|---|---|
| 缩略图 | `ProjectMeta.thumbnail`（**F-PM-02 新增写入**：保存时对首个界面 `root` 做 canvas 离屏渲染 → 200×140 PNG base64，写入项目文件旁的 `.wshu-thumb/<meta.id>.png` 缓存） | 待实现 |
| 项目名 | `meta.name` | ✅ |
| 界面数 | `ProjectMeta.pageCount` | ✅ 已算 |
| 设备 | `meta.device` | ✅ |
| 规范名 | `meta.specId` → 查 `specs[]` | ✅ |
| 更新时间 | `meta.updatedAt` | ✅ |
| 收藏标记 | **F-PM-02 新增** `.workspace.json` | 待实现 |
| 分组 / 标签 | **F-PM-02 新增** `.workspace.json` | 待实现 |

> **缩略图取舍**：不在 `.dsproj` 内塞 base64（会污染项目文件、拖慢读写），而是写在**用户数据目录的独立缓存**中，按 `meta.id` 索引。这样项目文件仍然纯粹、可 diff、可版本管理。

#### 3.2.3 视图与检索

| 能力 | 说明 |
|---|---|
| 网格视图（默认） | 卡片瀑布；缩略图 + 元信息 |
| 列表视图 | 紧凑表格：名称 / 界面数 / 设备 / 规范 / 修改时间 / 路径 |
| 搜索 | 按 `meta.name` 模糊匹配（前端过滤 `projectFs.list()+scan()` 的并集） |
| 排序 | 最近修改 ↓（默认）/ 创建时间 / 名称 / 界面数 |
| 筛选 | 按设备 / 按规范 / 按标签 / 仅收藏 / 仅未保存会话 |

**数据来源合并规则**（重要，避免重复卡片）：

```ts
// 项目中心的项目全集 = 最近列表 ∪ 默认目录扫描结果，按 path 去重
const recent = await bridge.invoke('project:list')          // recent-projects.json
const scanned = await bridge.invoke('project:scan')          // 【新增 IPC】目录扫描
const all = dedupeByPath([...recent, ...scanned])
```

### 3.3 项目管理操作矩阵

| # | 操作 | 触发点 | 实现要点 | 状态 |
|---|---|---|---|---|
| 1 | 新建 | 项目中心 / Titlebar | `newProject()` | ✅ 已有 |
| 2 | 打开 | 卡片单击 / 双击 | `openProject(path)`，内部 `project:open` | ✅ 已有 |
| 3 | 从文件对话框打开 | 「导入」/ Titlebar「打开」 | `project:openByDialog` | ✅ 已有 |
| 4 | 打开所在文件夹 | 卡片右键 | `project:revealInFolder` | ✅已有 |
| 5 | 重命名 | 卡片右键 / 主界面 Titlebar | `renameProject()` → `commit`（改 `meta.name`）；**可选同步磁盘文件名** | ✅ 已有（磁盘同步待加） |
| 6 | 复制项目 | 卡片右键「创建副本」 | 读源 `ProjectFile` → 换 `meta.id`、`meta.name='xxx 副本'`、重生成所有 `Page.id`/`Node.id`、清 `flows` 中的失效引用 → `project:saveAs` | 待实现 |
| 7 | 收藏 / 取消收藏 | 卡片星标 | 写入 `.workspace.json` | 待实现 |
| 8 | 移入分组 | 卡片拖拽 → 侧栏分组 | 写入 `.workspace.json` | 待实现 |
| 9 | 打标签 | 卡片右键 → 标签编辑 | 同上 | 待实现 |
| 10 | 归档 | 卡片右键「归档」 | 标记 `archived: true`，默认视图隐藏 | 待实现 |
| 11 | 从最近列表移除 | 卡片右键 | `project:remove`（不删文件） | ✅ 已有 |
| 12 | 删除项目 | 卡片右键「删除」 | 二次确认 → **移入系统回收站**（不 `unlink`）→ `project:remove` | ⚠️ 需改（当前 `deleteFile` 用 `unlinkSync`，**不可恢复**，违反安全约定） |
| 13 | 多选批量操作 | Ctrl/Shift 多选 | 批量归档 / 批量打标签 / 批量移组 | 待实现 |
| 14 | 导出 | 卡片右键 | 复用 `exportProject(format)` | ✅ 已有 |
| 15 | 新建窗口打开 | 卡片右键「在新窗口打开」 | F-PM-03 | 待实现 |

> **⚠️ 必须修的安全问题**：`project-fs.ts:136 deleteFile()` 使用 `fs.unlinkSync` —— **绕过回收站，不可恢复**。按项目的安全约定，应改为系统回收站（`shell.trashItem`）。这是本方案顺带发现的**高危项**，建议立即修复，优先级高于 F-PM 全系列。

### 3.4 F-PM-02 · 项目元数据治理

新增工作区索引文件，与项目文件解耦：

**位置**：`<userData>/workspace.json`

```ts
export interface WorkspaceIndex {
  version: 1
  /** 项目 id → 工作区侧元数据（不污染 .dsproj） */
  entries: Record<string, WorkspaceEntry>
  groups: WorkspaceGroup[]
  tags: string[]
}

export interface WorkspaceEntry {
  /** 项目绝对路径（若项目被移动，靠 id 仍能认回） */
  path?: string
  /** 冗余存一份项目名，便于文件被删后展示"已失效"占位 */
  name: string
  favorite?: boolean
  archived?: boolean
  groupId?: string
  tags?: string[]
  /** 缩略图缓存文件名 */
  thumbnailFile?: string
  /** 最近一次成功打开时间 */
  lastOpenedAt?: string
  /** 置顶 */
  pinned?: boolean
}

export interface WorkspaceGroup {
  id: string
  name: string
  order: number
  color?: string
}
```

**为何独立成文件而不写进 `.dsproj`**：

1. 「收藏 / 标签 / 分组」是**使用者视角**的元数据，不是设计产物的一部分 —— 换个人拿到 `.dsproj` 不应该看到别人的分类；
2. 写进 `.dsproj` 会让「同一项目被多人协作编辑」时产生无意义的冲突；
3. 项目文件被移动/删除后，工作区索引仍能展示"失效占位"，提升容错。

### 3.5 F-PM-03 · 多项目并行与快速切换

| 能力 | 说明 | 实现要点 |
|---|---|---|
| **多窗口打开** | 每个项目一个 BrowserWindow | `createWindow()` 已可复用；需把 `project.path` 通过 `additionalArguments` 传给新窗口；`close-guard` 需按窗口实例化（当前 `attachCloseGuard(win)` 已按窗口挂载，**天然支持**） |
| **项目切换器** | Titlebar 项目名旁加 ▾，弹出最近 8 个项目 + 「打开项目中心」 | 复用 `project:list` |
| **会话恢复** | 关闭应用时记录已开窗口的项目路径，下次启动还原 | 写入 `<userData>/session.json`；`bootstrap.ts` 当前只恢复 1 个，扩展为恢复全部 |
| **项目标签页** | （备选）单窗口内多项目 Tab | 需 `ProjectState` 支持多实例，**工作量大，列为 P3 备选** |

> **决策建议**：首发采用**多窗口**方案（改动小、隔离好、崩溃互不影响），暂不做单窗口多 Tab。

### 3.6 自动保存与版本快照

| 能力 | 策略 | 说明 |
|---|---|---|
| 自动保存 | 项目已绑定路径时，`dirty` 变更后 **30s 防抖**落盘；未绑定路径则不自动保存（避免弹窗轰炸） | 写入前经 `commit` 状态已一致，无额外风险 |
| 崩溃恢复 | 每次 `commit` 后把 `design` 快照写入 `<userData>/autosave/<meta.id>.json`（**节流 5s**） | 启动时若发现 autosave 比 `.dsproj` 新，提示"检测到未保存的更改，是否恢复" |
| 手动快照 | 项目设置面板「创建快照」，保留最近 10 个 | 存 `<userData>/snapshots/<meta.id>/<timestamp>.json` |
| 快照恢复 | 项目中心卡片右键「历史版本」→ 列出快照 → 恢复 / 另存为副本 | — |

---

## 4. F-PM-04 · 功能界面与项目的关联关系

### 4.1 关联关系的五条定义

**R-1 承载关系（1 : N）**
一个项目承载 N 个界面（N ≥ 1）。界面**内嵌**于项目文件，不独立成文件。
理由：界面之间需共享 `tokens`（规范）、`assets`（资源）、`flows`（跳转），拆文件会让这三者跨文件引用，破坏"单文件可完整还原一个交付物"的核心约定。

**R-2 归属键（Ownership）**
`ProjectFile.design.pages[]` 即为归属。界面的"所属项目"由**它存在哪个 `.dsproj` 里**决定，而非由字段显式声明。
同时，语义上额外的显式锚点：`design.meta.id`（项目主键）。

**R-3 唯一性（Uniqueness）**

| 层级 | 唯一键 | 范围 | 校验时机 |
|---|---|---|---|
| 项目 | `meta.id` | 工作区内全局唯一 | 创建 / 导入时 |
| 界面 | `Page.id` | **项目内唯一即可，但约定全局唯一**（便于 flows 与外部引用无歧义） | `commit` 前置校验 |
| 节点 | `Node.id` | 界面内唯一（跨界面可重复） | 生成解析时 |
| 分组 | `PageGroup.id` | 项目内唯一 | — |

**R-4 顺序与位置（Order & Position）**
两个维度并行维护：

| 维度 | 字段 | 语义 | 用途 |
|---|---|---|---|
| 逻辑序 | `Page.order: number` | 界面在列表/流程中的先后 | 界面列表排序、导出时的文件序 |
| 空间序 | `Page.pos: {x, y}` | 界面在无限画布上的位置 | 画布排布、多屏并列查看 |

约定：`addPage` 时 `order = pages.length`、`pos.x = max(existing.pos.x) + canvas.width + 40`（与 `PageList.tsx:18-28` 现有行为一致，保持不变）。

**R-5 引用完整性（Referential Integrity）**
`Flow.fromPage` / `Flow.to` 必须指向**本项目内已存在的界面 id**。界面删除时必须级联清理：

```ts
// 与 PageList.tsx:49-53 现有行为一致，建议抽取为公共函数 cascadeDeletePage()
d.pages = d.pages.filter(p => p.id !== pageId)
d.flows = d.flows.filter(f => f.fromPage !== pageId && f.to !== pageId)
```

### 4.2 不变量清单（Invariants，须写成单测）

| # | 不变量 | 违反后果 | 校验位置 |
|---|---|---|---|
| I-1 | `pages.length >= 1` | 项目无界面，画布空白、导出崩溃 | `commit` 后置断言 + `delPage` 前置拦截 |
| I-2 | `pages[].id` 互不相同 | React key 冲突、`setActivePage` 指向错误 | `commit` 前置 |
| I-3 | `activePageId` ∈ `pages[].id` | 主区渲染空 | `removePage` 后自动改选 `pages[0]` |
| I-4 | `flows[].fromPage` ∈ `pages[].id` 且 `flows[].to` ∈ `pages[].id` | 预览时跳转死链 | `removePage` 级联 |
| I-5 | `page.specId`（若存在）∈ `specs[].id` ∪ `BUILTIN_SPEC_IDS` | 界面解析不出 Token | `removeSpec` 时把指向它的页面重置为 `undefined` |
| I-6 | `meta.specId`（若存在）∈ 同上 | 全项目解析失败 | 同上 |
| I-7 | `assets[].id` 被引用的节点必须能解析到 `src` | 图片裂 | 导入时校验；缺失只警告不阻断 |
| I-8 | `Page.groupId`（若存在）∈ `pageGroups[].id` | 分组孤儿 | `removePageGroup` 时把成员 `groupId` 置空 |

**建议实现**：新增 `services/project/invariants.ts`，导出 `checkInvariants(design): Violation[]`，在 `commit` 内开发模式断言，并在 `project:save` 前做一次全量检查（生产模式仅记日志 + 上报 toast）。

### 4.3 两级规范继承（与 F-ST-01 衔接）

界面与项目的规范关系是**就近优先的覆盖链**：

```
解析某界面的 TokenMap 时：

  page.specId ──有──→ 用该 DesignSpec
      │无
      ▼
  meta.specId ──有──→ 用该 DesignSpec
      │无
      ▼
  不绑定（用 design.tokens 自身，即"项目自由风格"）

最终：tokenMapForPage(design, pageId)  ← 唯一入口，画布/预览/导出/变体四处同源
```

这与既有约定一致（`tokenMapForPage` 是唯一入口，不得各自 `buildTokenMap`）。新增 F-PM 不改变这条链，只是**在项目中心把 `meta.specId` 可视化出来**（卡片显示规范名），并允许从项目中心直接改绑。

### 4.4 跨界面流程（flows）

`Flow` 已有 `fromPage` / `to`，天然支持跨界面跳转。F-PM-04 只补两件事：

1. **可视化**：项目中心的"流程视图"（可选）—— 把 N 个界面按 `flows` 连成有向图，一眼看出哪些界面是孤岛；
2. **完整性守卫**：删除界面时级联（见 R-5 I-4）。

### 4.5 资源（assets）归属

`Asset` 属于**项目**，不属于界面。`Node.style.fill` 里存的是 `Asset.id` 引用。
因此：
- 删除界面**不删除**资产（可能被其它界面引用）；
- 新增「资产清理」入口：扫描全项目节点引用，列出未被引用的资产，用户确认后删除。

### 4.6 关联关系速查表

| 问题 | 答案 |
|---|---|
| 界面凭什么属于这个项目？ | 因为它存在这个 `.dsproj` 的 `design.pages[]` 数组里 |
| 一个项目能有多少界面？ | N ≥ 1，上限由 `meta.quota` 配置（见 §5） |
| 一个界面能属于多个项目吗？ | 不能。跨项目复用请用"复制界面到项目"（深拷贝 + 重生成 id） |
| 删项目会删界面吗？ | 会（界面内嵌），所以删项目必须二次确认 + 走回收站 |
| 界面能独立导出吗？ | 能，导出时按界面拆分目录（见 §5.5） |
| 换项目时规范怎么办？ | 项目级 `meta.specId` 独立；可"把当前项目的规范存进规范库"再在别的项目引用（F-PM-06） |

---

## 5. F-PM-05 · 界面数量 N 的配置方式与扩展机制

这是需求里最"实"的一块，也是望舒目前**完全空白**的部分（G-5/G-6/G-7）。

### 5.1 N 的三档语义（关键设计）

"界面数量 N"在真实流程中其实是**三个不同的数**，混用会出问题。本方案拆成三档：

| 档位 | 字段 | 语义 | 默认 | 谁改 |
|---|---|---|---|---|
| **计划值 `planned`** | `meta.quota.planned` | 本次生成**打算**产出多少个界面。是给 AI 规划器的目标数 | 1 | 创建向导 / 生成面板 |
| **软上限 `softLimit`** | `meta.quota.softLimit` | 超过就**提示**"已达建议上限，继续会增加管理成本"，但**允许** | 20 | 项目设置 |
| **硬上限 `hardLimit`** | `meta.quota.hardLimit` | 超过就**禁止**新增 / 生成。`0` 表示不限 | 100 | 项目设置（受全局配置 `appLimits.maxPagesPerProject` 约束，防止用户设成天文数字把内存打爆） |

**为什么必须拆三档**：

- 只有 `planned` → 用户在生成后发现少了一屏，想手动加第 6 屏，被"计划 5"卡住 → 荒谬；
- 只有 `hardLimit` → AI 不知道要生成几屏，仍会自由发挥 → N 不可控；
- 只有 `softLimit` → 无法表达"这个项目我就是要 30 个界面"。

### 5.2 数据模型

```ts
// shared/design.ts 新增（SCHEMA 1.1 → 1.2，纯可选字段，向后兼容）
export interface InterfaceQuota {
  /** 计划界面数（生成目标） */
  planned: number
  /** 软上限：超出提示但允许 */
  softLimit: number
  /** 硬上限：超出禁止；0 = 不限（仍受全局配置约束） */
  hardLimit: number
  /** 生成策略 */
  strategy?: 'single' | 'flow' | 'batch'
}

export interface Meta {
  // …既有字段不变
  /** 界面配额（F-PM-05）。旧文件无此字段 → 按 DEFAULT_QUOTA 处理 */
  quota?: InterfaceQuota
}

export const DEFAULT_QUOTA: InterfaceQuota = {
  planned: 1,
  softLimit: 20,
  hardLimit: 100,
  strategy: 'single',
}
```

**解析层兼容**（严格遵守既有向后兼容约定）：

```ts
// 读取时统一兜底，全项目只此一处
export function resolveQuota(meta: Meta): InterfaceQuota {
  const q = meta.quota
  if (!q) return { ...DEFAULT_QUOTA }
  return {
    planned: clampInt(q.planned, 1, 999),
    softLimit: clampInt(q.softLimit, 1, 999),
    hardLimit: clampInt(q.hardLimit, 0, 999),   // 0 = 不限
    strategy: q.strategy ?? 'single',
  }
}
```

### 5.3 N 的配置方式（四个入口）

| # | 入口 | 场景 | 交互 |
|---|---|---|---|
| **E-1 创建向导** | 新建项目时 | 滑块或数字输入，范围 `1 ~ hardLimit`（默认 1）。选「AI 生成」时此值直通生成提示词 |
| **E-2 生成面板** | 主界面 AI 面板 | 需求描述框下方加「界面数」小控件（1–20 快捷档 + 自定义）。填写后写入 `meta.quota.planned` 并参与提示词 |
| **E-3 项目设置** | 项目中心卡片右键「项目设置」 | 三个数字输入：计划 / 软上限 / 硬上限 + 策略下拉。改 `hardLimit` 时校验 ≥ `pages.length`、≤ 全局上限 |
| **E-4 界面列表批量追加** | 界面列表顶部「+ N」 | 输入 N（默认 1）→ 一次性 `commit` 追加 N 个空界面，画布横向依次排布 |

> **E-2 是需求的重点**：用户说"帮我设计一个 5 个界面的电商 App"，系统应当**既解析出 5**，又把它写进 `meta.quota.planned`，让后续补页有基准。

### 5.4 AI 规划阶段如何控制 N

新增「界面规划（Sitemap Planning）」前置阶段，插在生成流程最前面：

```
需求描述 + N + 设备 + 规范
        │
        ▼
[阶段 0] 界面规划器 planInterfaces()
        输出：InterfacePlanItem[] { name, purpose, entry?, groupName? }
        长度 = N（模型需严格遵守；解析后不足则按 N 补齐、超出则截断）
        │
        ▼  （可选）用户确认清单 —— 可增删改，改完的条数即实际 N
        ▼
[阶段 1..k] 逐界面生成（可串行，也可并行 2~3 个）
        每个界面走既有「Token 定稿 + 布局生成」链路
        │
        ▼
[收尾] 写入 design.pages[]、按 groupName 建 PageGroup、
       按 entry 关系建 Flow（首页 → 各界面）
```

**关键约束（必须写进提示词与校验器）**：

| 约束 | 实现 |
|---|---|
| 规划条目数必须 == `planned` | 解析后 `slice(0, planned)`；不足则用生成的名称模板补齐 |
| 每个界面名唯一且语义清晰 | 重复名自动加序号后缀 |
| 规划输出必须是合法 JSON | 复用既有 `askJson()` 的「校验 + 一次修复重试」范式（见 F-ST-03 沉淀） |
| 生成失败不破坏已有界面 | 逐界面生成各自独立 `commit`，失败者跳过并汇总提示；**不得整批回滚**用户已产出的内容 |

**「先生成清单待确认」选项**：N ≥ 3 时默认勾选。理由：一次性生成 8 个界面成本高，先确认清单能显著降低浪费。这与项目的交互约定一致（**面向用户的自动改写一律需要用户确认，不做静默改写**）。

### 5.5 扩展机制（六路）

当用户想往项目里加界面时，提供六条路径：

| # | 机制 | 说明 | 上限约束 |
|---|---|---|---|
| **X-1 单个新增** | 界面列表「+」 | 现有 `PageList.addPage`，补 `hardLimit` 校验 + 超软上限提示 | 受 `hardLimit` |
| **X-2 复制界面** | 界面右键「复制」/ `Ctrl+D` | 现有 `dupPage`，深拷贝 + 重生成 `Page.id` 与**所有 `Node.id`**（当前实现只换了 `Page.id`，节点 id 未重生成 → **隐患，见 §9 缺陷清单**） | 受 `hardLimit` |
| **X-3 批量追加** | 界面列表「+ N」（E-4） | 一次 `commit` 追加 N 个空界面 | 受 `hardLimit` |
| **X-4 续生成** | AI 面板「再生成 N 个界面」 | 基于已有界面清单，让模型补 N 个**不重复**的界面（提示词里带上已有界面名） | 受 `hardLimit` |
| **X-5 外部导入** | 项目中心 / 界面列表「导入界面」 | 从 HTML 文件 / 图片 / 结构化描述 → 提炼为 1 个新界面（复用 F-ST-01 的 `extractTokensFromHtml` + `tokensFromImageFile` 思路，扩展为「结构 + 风格」双提炼） | 受 `hardLimit` |
| **X-6 模板实例化** | 界面列表「从模板插入」 | `INTERFACE_TEMPLATES` 注册表（登录、注册、首页、列表、详情、表单、设置、个人中心、支付、空态…），选中即插入骨架 | 受 `hardLimit` |

**扩展机制的可扩展性（本方案要回答的第二层"扩展"）**：

> 需求里的"扩展机制"应理解为**两层**：① 界面数量的扩展；② **能力本身的扩展**（未来加入新的界面来源而不改架构）。

为此引入**界面来源适配器注册表**：

```ts
// services/project/interface-sources.ts
export interface InterfaceSource {
  id: string
  label: string
  /** 是否可离线工作 */
  offline: boolean
  /** 产出一个或多个界面的提案，交给用户确认后由调用方 commit */
  propose(ctx: ProposeContext): Promise<PageProposal[]>
}

const REGISTRY = new Map<string, InterfaceSource>()

export function registerInterfaceSource(s: InterfaceSource) { REGISTRY.set(s.id, s) }
export function listInterfaceSources(): InterfaceSource[] { return [...REGISTRY.values()] }
```

内置实现：`blank` / `duplicate` / `template` / `ai-plan` / `ai-continue` / `html-import` / `image-import` / `describe-import`。
未来加 MCP 驱动的来源、Figma 导入等，**只需注册一个适配器**，UI 自动列出（`listInterfaceSources()` 驱动下拉）。

### 5.6 超限与降级策略

| 情形 | 行为 |
|---|---|
| 新增后 `length > softLimit` | 允许，但弹非阻断提示：「项目已有 21 个界面，超过建议上限 20。界面过多会影响画布可读性，建议拆分项目或使用分组。」+ 「不再提示」勾选 |
| 新增后 `length > hardLimit` 且 `hardLimit > 0` | **阻断**，提示：「已达项目界面上限（100）。可在项目设置中调整上限。」并提供「去设置」按钮 |
| `planned > hardLimit` | 创建向导阶段即阻断，提示修正 |
| 生成时模型产出 < `planned` | 不报错，产出多少算多少，提示「计划 5 个，实际生成 3 个，可点击『续生成 2 个』」 |
| 生成时模型产出 > `planned` | 静默截断到 `planned`（多余的不落盘），并在日志记录 |
| `hardLimit = 0` | 视为不限，但仍受全局配置 `appLimits.maxPagesPerProject`（建议 500）兜底，防止内存失控 |

### 5.7 N 与导出的关系

| 导出格式 | N 的体现 |
|---|---|
| 整项目代码导出 | 每个界面一个目录（`screen-01-login/`），含 `index.html` + 样式；根目录 `index.html` 为界面导航页 |
| 单界面导出 | 只导出当前 `activePageId` 对应界面 |
| ZIP 打包 | 按界面分目录，附 `manifest.json`（界面名、order、flows） |
| DESIGN.md 导出 | 不含界面内容，只导出 Token 与规则（F-PM-06） |

### 5.8 N 的决策速查表

| 用户意图 | 用的档位 | 入口 |
|---|---|---|
| "生成一个电商 App 的 5 个主要界面" | `planned = 5` | 生成面板 E-2 |
| "先给我 1 屏看看风格" | `planned = 1` | 生成面板 E-2 |
| "再补 3 个界面" | `planned` 不变，走 X-4 续生成 | 生成面板 |
| "我要 30 个界面的大项目" | 调 `softLimit ≥ 30` | 项目设置 E-3 |
| "别让我加超过 50 个" | `hardLimit = 50` | 项目设置 E-3 |
| "一次性给 8 个空界面我自己画" | — | 批量追加 E-4 |

---

## 6. 对标 Google Stitch：能力梳理与补齐

### 6.1 全量对标表

状态图例：✅ 已有 ｜ 🟡 部分/待接线 ｜ ❌ 缺 ｜ 🏆 望舒已超越

| # | 模块 | Stitch 能力 | 望舒现状 | 状态 | 补齐动作 | 编号 |
|---|---|---|---|---|---|---|
| **A. 项目管理** |
| A1 | 项目列表 | 主控制台，最近项目 + Examples | 数据层齐备，**无 UI** | 🟡 | 项目中心 | **F-PM-01** |
| A2 | 项目组织（分组/标签/收藏） | 未见（扁平列表） | 无 | 🏆 | 做出来即超越 | **F-PM-02** |
| A3 | 多项目并行 | 单项目单画布 | 无 | ❌ | 多窗口 + 切换器 | **F-PM-03** |
| A4 | 版本历史 / 快照 | 未见（Design Agent 追踪历史） | 仅内存 100 步撤销 | 🟡 | 快照 + 崩溃恢复 | **F-PM-03** |
| A5 | 项目模板 | Examples 预设案例 | 无 | ❌ | 界面模板注册表 | **F-PM-05** |
| A6 | 本地存储 / 隐私 | 云端，Labs 有被砍历史 | 纯本地 | 🏆 | — | — |
| **B. 界面（Screen）管理** |
| B1 | 一个项目多界面 | 支持，画布平铺 | `pages[]` 已支持 | ✅ | 显性化 | **F-PM-04** |
| B2 | 界面数量可控 | 单次生成，多屏一组 | **无配额** | ❌ | 三档配额 | **F-PM-05** |
| B3 | 界面批量创建 | 多屏生成一次出 N 屏 | 只能逐个点 | ❌ | 批量追加 + 规划器 | **F-PM-05** |
| B4 | 界面分组/分模块 | 未见 | 无 | 🏆 | `PageGroup` | **F-PM-05** |
| B5 | 界面复制 | 支持 | 支持（**但节点 id 未重生成，隐患**） | 🟡 | 修复 | §9 |
| B6 | 界面重命名/删除/排序 | 支持 | 支持（删除最后 1 页静默失败） | 🟡 | 修复 | §9 |
| **C. 画布与编排** |
| C1 | AI 原生无限画布 | ✅ 2.0 核心 | `Page.pos` 已支持空间排布 | 🟡 | 补齐导航与分组 | **F-PM-09** |
| C2 | 画布缩放/平移/缩略导航 | ✅ | 待核（画布组件已具备基础） | 🟡 | 补缩略图导航 | **F-PM-09** |
| C3 | 界面流程可视化 | Flow 连线 | `flows[]` 有数据 | 🟡 | 流程视图 | **F-PM-09** |
| **D. 设计系统** |
| D1 | DESIGN.md 导入 | ✅ **可从任意 URL 提取** | 无 | ❌ | 导入 + URL 抓取 | **F-PM-06** |
| D2 | DESIGN.md 导出/跨项目复用 | ✅ | `DesignSpec` 可存项目内 | 🟡 | 导出 + 跨项目规范库 | **F-PM-06** |
| D3 | 设计规范负面规则（do/don't） | ✅ | `SpecRules.dos/donts` 类型已备 | 🟡 | 接线到提示词 | **F-PM-06** |
| D4 | 从图片/HTML 提炼风格 | ✅（有限） | **已实现**（`style-extract.ts` 121 项测试） | 🏆 | — | F-ST-01 |
| D5 | 风格漂移检测 / 一键修正 | 未见 | **已实现** | 🏆 | — | F-ST-01 |
| **E. 生成** |
| E1 | 文字生成 | ✅ | ✅ | ✅ | — | — |
| E2 | 图片/草图生成 | ✅ | 待核 | 🟡 | — | — |
| E3 | 语音实时交互（Vibe Design） | ✅ 2.0 新增 | ❌ | ❌ | 可选：系统 TTS/ASR 接入（P3） | — |
| E4 | 多变体生成 | ✅ 1–5 变体 | 已实现（缺陷已修） | ✅ | — | F-ST-03 |
| E5 | 多屏生成（一次 N 屏） | ✅ 2.0 新增 | ❌ | ❌ | 规划器 + 批量生成 | **F-PM-05** |
| E6 | 页面自动补全（补页 + 补交互） | 部分 | **已实现** | 🏆 | — | F-ST-02 |
| E7 | 页面 AI 优化 | ✅ 对话式迭代 | **已实现** | ✅ | — | F-ST-04 |
| **F. 协作与代理** |
| F1 | Design Agent（跨版本推理） | ✅ 实验 | ❌ | ❌ | 并行方案管理 | **F-PM-07** |
| F2 | Agent Manager（并行多分支） | ✅ 实验 | ❌ | ❌ | 分支管理 | **F-PM-07** |
| F3 | MCP server | ✅ | ❌ | ❌ | 本地 MCP 适配层 | **F-PM-08** |
| F4 | SDK | ✅（无 REST） | ❌ | ❌ | 本地 HTTP/IPC SDK | **F-PM-08** |
| **G. 导出** |
| G1 | 代码导出（HTML/CSS） | ✅ | ✅ | ✅ | — | — |
| G2 | Figma 导出 | ✅ | ❌ | ❌ | P3 备选 | — |
| G3 | 下游工具直达（Antigravity/AI Studio/Netlify） | ✅ | ❌ | ❌ | P3 备选（本地优先，价值有限） | — |
| G4 | 一键部署 / 分享链接 | ✅ | ❌ | ❌ | P3 备选 | — |
| **H. 工程质量（Stitch 无对标）** |
| H1 | 离线可用 | ❌ 云端 | ✅ 纯本地 | 🏆 | — | — |
| H2 | 无月度生成额度 | ❌ 有限额 | ✅ 只受用户自己的模型额度 | 🏆 | — | — |
| H3 | 自动化测试体系 | 未知 | ✅ **10 套件 812 项** | 🏆 | — | `测试报告.md` |
| H4 | 缺陷回归 + 真机探针 | 未知 | ✅（含关闭流程真机探针 4/4） | 🏆 | — | `测试报告.md` |
| H5 | 自定义模型接入（OpenAI/Anthropic/Gemini/Ollama） | ❌ 仅 Gemini | ✅ 4 类适配器 | 🏆 | — | — |

### 6.2 缺失部分补齐方案

#### F-PM-06 · DESIGN.md 互操作（补 D1/D2/D3）

Stitch 的 `DESIGN.md` 之所以关键，`analysis/S1-2` §4.2 已明确指出：**它是"跨工具一致性的共享事实源"**，同一份文件可用于 Claude Code、v0 等任何 AI 设计工具。

**导入（三条来源）**：

| 来源 | 处理 |
|---|---|
| 本地 `.md` 文件 | 读取 → 解析 → `DesignSpec` |
| 粘贴文本 | 同上 |
| **URL 抓取** | 主进程 `net`/`fetch` 拉取（渲染进程受 CORS 限制，必须走主进程）→ 解析 → 用户确认后存为规范 |

**解析器**（纯函数，可离线测，走既有测试体例）：

```ts
// services/design/design-md.ts（纯逻辑，不 import store/react/electron）
export interface ParsedDesignMd {
  name?: string
  tokens: Partial<Tokens>
  rules?: SpecRules
  /** 未能识别的段落，原样保留供用户查看 */
  raw: string
}

/** 解析容错：既认结构化代码块，也认「颜色：#3B82F6 主色」这类自然语言行 */
export function parseDesignMd(md: string): ParsedDesignMd
/** 反向：DesignSpec → DESIGN.md 文本 */
export function serializeDesignMd(spec: DesignSpec): string
```

**导出**：项目中心 / 规范面板 → 「导出 DESIGN.md」→ 产出标准 markdown，便于丢给 Claude Code / v0。

**规范库（跨项目）**：`DesignSpec` 目前存在项目内 `design.specs[]`（会随项目走）。新增**用户级规范库** `<userData>/spec-library.json`：
- 「保存到我的规范库」把当前项目里的某套规范提升为全局；
- 新建项目时可直接从规范库选；
- 规范库条目可导出 `.design.md`。

这与 F-ST-01 的「规范实体」完全衔接，只是增加了一个**存储层级**。

#### F-PM-07 · 多方案并行 / Agent Manager（补 F1/F2）

**问题**：Stitch 的 Agent Manager 解决的是"多方向探索时分支混乱"。望舒现在只能"改了就回不去"（除 100 步内存撤销）。

**方案**：**项目内并行分支（Branch）**，不引入新文件格式：

```ts
// 存于 <userData>/branches/<meta.id>.json，不写进 .dsproj
export interface ProjectBranch {
  id: string
  projectId: string
  name: string            // "方案 A · 极简" / "方案 B · 暖色"
  createdAt: string
  /** 分支起点：以某个界面的快照为基准 */
  basePageId?: string
  /** 该分支产出的界面快照（Page[]），与主项目隔离 */
  pages: Page[]
}
```

**交互**：
1. 在 AI 面板选「多方案探索」→ 指定方向数（2–4）与差异维度（布局 / 配色 / 信息密度）；
2. 每个方向生成到一个独立分支；
3. 项目中心或画布侧栏出现「方案对比」——N 个分支的同一界面并排（复用画布的并排能力）；
4. 选定后「采纳到主项目」→ 把分支 `pages` 合并进 `design.pages[]`（一次 `commit`）。

**与既有能力的衔接**：复用 F-ST-03 已沉淀的「逐请求 + 校验重试」范式；复用 `commit` 事务。不作静默合并 —— **采纳必须有用户明确动作**。

#### F-PM-08 · 开放接口（补 F3/F4）

Stitch 有 MCP / SDK 但无 REST API；望舒已有统一的 `ipc.ts` 通道层，挂 MCP 适配层的成本很低。

**方案**：新增 `electron/main/mcp-server.ts`，把既有 IPC 能力映射为 MCP Tools：

| MCP Tool | 映射 | 说明 |
|---|---|---|
| `wanshu.list_projects` | `project:list` | 列出项目 |
| `wanshu.create_project` | `newProject` + `project:saveAs` | 创建项目 |
| `wanshu.open_project` | `project:open` | 打开项目 |
| `wanshu.get_design` | 直接读 `design` | 取整体 JSON |
| `wanshu.list_interfaces` | `design.pages` | 列出界面 |
| `wanshu.create_interface` | X-1/X-3 | 新增界面 |
| `wanshu.generate_interfaces` | 生成链路 | 指定 N 生成 |
| `wanshu.export_project` | `export:write` | 导出 |
| `wanshu.get_spec` / `set_spec` | `bindSpec` | 规范读写 |
| `wanshu.import_design_md` | F-PM-06 | 导入设计系统 |

**安全**：MCP server **仅监听 localhost**，需 token 鉴权；默认关闭，在设置页显式开启。所有写操作走 `commit`，因此天然保留撤销能力。

#### F-PM-09 · 无限画布编排增强（补 C1/C2/C3）

| 子能力 | 说明 |
|---|---|
| 分组折叠 | 按 `PageGroup` 在画布上画分组框；分组可折叠为"堆叠卡片"，点击展开 |
| 缩略导航 | 右下角 minimap，显示所有界面的 `pos` + 当前视口矩形；可拖动跳转 |
| 流程视图 | 独立面板：界面为节点、`flows` 为有向边；孤立界面高亮提示 |
| 自动排布 | 「一键整理」按 `order` 或按 `flows` 的拓扑序重排 `pos`（避免手工摆放） |
| 对齐辅助 | 界面拖拽时显示与相邻界面的对齐参考线与等距提示 |

### 6.3 望舒的超越点（论证"更好用了"）

| # | 维度 | Stitch | 望舒 F-PM 方案 | 为什么更好用 |
|---|---|---|---|---|
| 1 | **数据主权** | 云端，Labs beta 有被砍历史 | 纯本地 `.dsproj` 单文件，可 git、可邮件、可网盘 | 不怕服务下线，成果自主 |
| 2 | **成本** | 免费 + 月度生成额度 | 无平台额度，只用你自己的模型额度 | 想做多少做多少 |
| 3 | **模型选择** | 仅 Gemini 系列 | OpenAI / Anthropic / Gemini / Ollama 四类适配 | 可离线（Ollama），可换更强的模型 |
| 4 | **项目组织** | 扁平列表 | 分组 / 标签 / 收藏 / 置顶 / 搜索 / 多视图 | 项目多了也能管住 |
| 5 | **界面数量可控** | 生成时不确定出几屏 | **三档配额**（计划/软上限/硬上限）+ 创建时即定 N | N 可预期、可约束 |
| 6 | **界面扩展性** | 只能再多生成一次 | 六路扩展 + **界面来源适配器注册表** | 加新来源不改架构 |
| 7 | **设计系统互操作** | DESIGN.md（单向偏导出） | 导入（文件/粘贴/**URL**）+ 导出 + **跨项目规范库** + 负面规则接线 | 双向、可复用、能约束 |
| 8 | **规范治理** | 无漂移检测 | F-ST-01 已有漂移检测 + 一键修正 | 多界面并排不跑偏 |
| 9 | **补页与补交互** | 部分 | F-ST-02 已实现（自动补页 + 自动补 states/flows） | 少手工 |
| 10 | **工程质量** | 未知 | 812 项自动化测试 + 真机探针 + 缺陷回归 | 改动不退化 |
| 11 | **安全** | — | 删除走系统回收站、MCP 仅 localhost + token、无静默改写 | 误操作可挽回 |
| 12 | **多窗口并行** | 单画布 | 每项目独立窗口，崩溃隔离 | 大项目并行不互相卡 |

### 6.4 评分（用于评审对齐）

以 Stitch 公开能力为 100 分基准，逐项加权：

| 维度 | 权重 | Stitch | 望舒现状 | 望舒 + F-PM 落地后 |
|---|---|---|---|---|
| 项目与界面管理 | 25% | 80 | 45 | **95** |
| 设计系统能力 | 20% | 90 | 70 | **95** |
| 生成能力 | 20% | 95 | 80 | **90**（语音交互缺，列为 P3） |
| 编辑与原型 | 15% | 85 | 80 | **90** |
| 导出与互操作 | 10% | 95 | 60 | **80**（Figma/部署直达不做） |
| 本地化与工程 | 10% | 40 | 95 | **98** |
| **加权总分** | 100% | **81.3** | **69.3** | **92.1** |

**结论**：补齐 F-PM-01~08 后，望舒在"项目/界面管理"与"本地化工程"两个维度实现反超，在设计系统维度打平或略超，在"导出直达下游工具"上主动放弃（与本地优先定位冲突，价值有限）。整体功能性超过 Stitch，且易用性因"零额度 + 多模型 + 强组织能力"而更优。

---

## 7. 落地顺序与工作量估算

| 阶段 | 内容 | 前置 | 交付判据 |
|---|---|---|---|
| **S1（P0）** | ① 修 `deleteFile` 走回收站（安全）；② F-PM-04 关联契约 + `invariants.ts` + 修复 §9 三个缺陷；③ F-PM-05 数据模型（`InterfaceQuota` + `resolveQuota`） | 无 | 纯函数单测全绿；存量 `.dsproj` 读取无回归 |
| **S2（P0）** | F-PM-01 项目中心（列表/网格/搜索/排序）+ 新增 `project:scan` / `project:workspace*` IPC | S1 | UI 截图验证；可建/开/删项目 |
| **S3（P1）** | F-PM-05 完整体（N 配置四入口 + 规划器 + 六路扩展 + 界面来源注册表） | S1 | 生成 N=5 的项目端到端可跑；配额边界有用例 |
| **S4（P1）** | F-PM-02 元数据治理 + F-PM-03 多窗口/切换器/快照 | S2 | 分组标签持久化；多窗口关闭流程回归通过 |
| **S5（P1）** | F-PM-06 DESIGN.md 导入导出 + 跨项目规范库 | S1 | 解析器纯函数测试；URL 导入成功 |
| **S6（P2）** | F-PM-07 分支并行 + F-PM-09 画布编排增强 | S3 | 分支采纳不静默；画布分组折叠可用 |
| **S7（P2）** | F-PM-08 本地 MCP server | S2 | 外部 MCP 客户端可列出项目与界面 |
| **P3 备选** | 语音交互、Figma 导出、下游部署直达、单窗口多 Tab | — | 按需 |

> **每个阶段收尾必须执行**（项目既定铁律）：`npm run test:all` 全绿（当前基线 10 套件 812 项，新增用例后基线同步上调）→ `npm run verify` 全绿 → **`electron-builder` 重新打包** → asar 特征串核验 → 交付时明确产物路径。

---

## 8. 需评审确认的决策点

| # | 决策点 | 备选 | 建议 |
|---|---|---|---|
| D-1 | 界面分组（`PageGroup`）是否进 `DesignJSON`？ | ① 进 schema（推荐）② 只存工作区索引 | **①**：分组是设计产物的一部分（画布上要画分组框），跨机器应一致 |
| D-2 | 收藏/标签/分组存哪？ | ① `<userData>/workspace.json`（推荐）② 写进 `.dsproj` | **①**：是使用者视角元数据，不该污染设计产物 |
| D-3 | `hardLimit` 默认值 | 50 / 100 / 不限 | **100** + 全局兜底 500 |
| D-4 | N 的规划清单是否默认需确认 | ① N≥3 才确认（推荐）② 总是确认 ③ 从不确认 | **①**：小项目不打断，大项目防浪费 |
| D-5 | 多项目并行形态 | ① 多窗口（推荐）② 单窗口多 Tab | **①**：改动小、隔离好 |
| D-6 | 是否做 DESIGN.md **URL 抓取** | ① 做（推荐）② 仅本地文件 | **①**：对齐 Stitch 且实现成本低（主进程 fetch + 纯函数解析） |
| D-7 | MCP 默认开还是关 | ① 默认关，设置页开启（推荐）② 默认开 | **①**：安全默认 |
| D-8 | 缩略图生成时机 | ① 保存时 + 节流（推荐）② 实时 | **①**：实时会拖慢编辑 |
| D-9 | `commit` 里是否强制跑 `checkInvariants` | ① 开发模式断言 + 保存前检查（推荐）② 每次 commit 全跑 | **①**：避免热路径性能损耗 |
| D-10 | 界面术语 | "界面" / "页面" / "屏幕" | **"界面"**（与需求原文一致），代码仍用 `Page` 不改名 |

---

## 9. 顺带发现的缺陷清单（建议随 S1 一并修复）

调研中发现三处既有实现问题，均与"界面管理"直接相关：

| # | 缺陷 | 位置 | 现状 | 修复 |
|---|---|---|---|---|
| **BUG-PM-1** | **删除项目文件不可恢复** | `electron/main/project-fs.ts:136` `deleteFile()` 用 `fs.unlinkSync` | 绕过系统回收站，误删无法找回 | 改为 `shell.trashItem(filePath)`；删前二次确认 |
| **BUG-PM-2** | **复制界面未重生成节点 id** | `src/components/panels/PageList.tsx:30-41` `dupPage()` 只重写了 `copy.id` 与 `copy.name` | 副本与原界面的 `Node.id` 完全相同 → 跨界面选中/查找可能串页；导出时组件 key 冲突 | 深拷贝后递归重生成所有 `Node.id`；同步重映射页内 `flows` |
| **BUG-PM-3** | **删除最后一个界面时静默失败** | `src/components/panels/PageList.tsx:44-47` | `if (design.pages.length <= 1) { useProjectStore.getState(); return }` —— 空语句，无任何提示，用户以为点了没反应 | 改为 toast：「项目至少保留 1 个界面」；或用 disabled 态 |

---

## 附录 A · 新增/变更类型清单

```ts
// ── shared/design.ts 变更（SCHEMA 1.1 → 1.2，全部为可选新增，向后兼容） ──
export interface InterfaceQuota {
  planned: number
  softLimit: number
  hardLimit: number        // 0 = 不限
  strategy?: 'single' | 'flow' | 'batch'
}

export interface PageGroup {
  id: string
  name: string
  order: number
  collapsed?: boolean
  color?: string
}

export interface Meta {
  // …既有字段不变
  quota?: InterfaceQuota
}

export interface Page {
  // …既有字段不变
  groupId?: string
}

export interface DesignJSON {
  // …既有字段不变
  pageGroups?: PageGroup[]
}

export const DEFAULT_QUOTA: InterfaceQuota = { planned: 1, softLimit: 20, hardLimit: 100, strategy: 'single' }
export function resolveQuota(meta: Meta): InterfaceQuota

// ── 新增文件（用户数据目录，不进 .dsproj） ──
// <userData>/workspace.json      → WorkspaceIndex
// <userData>/session.json        → { windows: string[] }（已开项目路径）
// <userData>/autosave/<id>.json  → DesignJSON 快照
// <userData>/snapshots/<id>/*.json
// <userData>/spec-library.json   → DesignSpec[]（跨项目规范库）
// <userData>/branches/<id>.json  → ProjectBranch[]

// ── 新增服务（纯逻辑，可离线测） ──
// services/project/invariants.ts     checkInvariants(design): Violation[]
// services/project/quota.ts          resolveQuota / canAddInterface / clampQuota
// services/project/interface-sources.ts  InterfaceSource 注册表
// services/design/design-md.ts       parseDesignMd / serializeDesignMd
// services/ai/plan-interfaces.ts     planInterfaces()（唯一联网入口）
```

## 附录 B · 新增 IPC 通道清单

| 通道 | 入参 | 返回 | 用途 |
|---|---|---|---|
| `project:scan` | `dir?: string` | `ProjectMeta[]` | 扫描默认目录（补齐项目中心数据源） |
| `project:workspace:get` | — | `WorkspaceIndex` | 读取工作区索引 |
| `project:workspace:set` | `WorkspaceIndex` | `{ ok }` | 写入工作区索引 |
| `project:thumbnail:set` | `{ id, dataUrl }` | `{ ok }` | 写缩略图缓存 |
| `project:thumbnail:get` | `id` | `string \| null` | 读缩略图缓存 |
| `project:trash` | `path` | `{ ok }` | **走系统回收站删除**（替代 `unlinkSync`） |
| `project:duplicate` | `{ path, newName }` | `{ path }` | 复制项目文件 + 重生成 id |
| `spec:library:get` / `spec:library:set` | — / `DesignSpec[]` | `DesignSpec[]` / `{ ok }` | 跨项目规范库 |
| `design-md:fetch` | `url` | `string` | 主进程抓取 DESIGN.md（绕过 CORS） |
| `session:save` / `session:load` | `string[]` / — | `{ ok }` / `string[]` | 多窗口会话恢复 |
| `window:openProject` | `path` | `{ ok }` | 新窗口打开指定项目 |

## 附录 C · 验收与测试用例（Test-first）

**纯逻辑层（新增 `scripts/test-project-model.mjs`，走既有 esbuild + `check/group` 体例）**

| 组 | 用例 | 断言要点 |
|---|---|---|
| ① `resolveQuota` | 缺字段 / 脏值 / 越界 / `hardLimit=0` | 全部兜底到合法值；`0` 不被当成"上限 0" |
| ② `canAddInterface` | 达到软上限 / 达到硬上限 / 不限 | 分别返回 `ok` / `warn` / `block` |
| ③ `checkInvariants` | 构造 8 条不变量各自的违反样例 | 全部能被检出，且不误报合规数据 |
| ④ `cascadeDeletePage` | 删中间界面、删被 flows 引用的界面 | `flows` 中相关边全部清除，其它边不动 |
| ⑤ `parseDesignMd` | 代码块式 / 自然语言式 / 混合 / 空输入 | Token 抽取正确；无法识别的段落进 `raw` 不丢失 |
| ⑥ `serializeDesignMd` → `parseDesignMd` | 往返一致性 | `parse(serialize(spec)).tokens ≈ spec.tokens` |
| ⑦ `planInterfaces` 结果规整 | 少于 N / 多于 N / 重名 | 补齐 / 截断 / 去重加序号 |
| ⑧ 节点 id 重生成（BUG-PM-2） | 复制界面后比对 id 集合 | 与原界面 id 集合**交集为空** |

**集成层（UI 截图 + 真机）**

| 场景 | 验证方式 |
|---|---|
| 项目中心渲染 | `npm run shot -- --eval` 打开项目中心截图，确认卡片/侧栏/搜索渲染正确 |
| 新建 N=5 项目 | 端到端跑一次，确认 `pages.length === 5`、`meta.quota.planned === 5` |
| 配额边界 | 手动加到 `hardLimit`，确认按钮禁用 + 提示出现 |
| 多窗口关闭 | `npm run test:close` 现有 4 场景回归（确保 F-PM-03 未破坏关闭流程） |
| 删除项目 | 删除后确认文件在系统回收站（BUG-PM-1 修复验证） |

**回归基线**：`npm run test:all` 当前 10 套件 812 项全绿；F-PM 落地后新增套件 → 基线同步上调，**零回归**为硬性要求。

---

## 10. 一句话总结

> **望舒不需要重建项目管理 —— 数据底座（项目文件 + `pages[]` + 完整 IPC + `commit` 事务）已经就位，缺的是"把它露出来"（项目中心）、"把界面归属写死"（关联契约与不变量）、"给数量一个说法"（三档配额 N）；补齐这三块再加上 DESIGN.md 互操作、多方案并行与本地 MCP，即在功能完整度与易用性上全面超过 Google Stitch。**
