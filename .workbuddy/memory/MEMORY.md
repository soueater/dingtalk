# 望舒（stitch）项目长期约定

> 只记「跨会话必须遵守」的硬性规则与稳定事实，不记流水账。

## 交付铁律

1. **改代码 ≠ 交付。** 凡改动 `app/electron/` 或 `app/src/`，交付前**必须重新执行 `electron-builder`**。
   `npm run verify` 只做「类型检查 + 测试 + 构建 `dist/`」，**不打包**。
   曾经因此让用户复测旧二进制、误判"缺陷未修复"。
2. **打包后核验产物内容**（机器可判定）：
   ```bash
   grep -c "<本次修复的特征串>" <outDir>/win-unpacked/resources/app.asar
   ```
   例：关闭修复的特征串是 `will-prevent-unload`。
3. **交付时明确指出产物路径**，并提醒用户「旧 exe 不含修复」。

## 产物目录约定

- 交付产物统一输出到 **`app/out/artifacts/`**（`build.directories.output`）：
  `望舒 Setup <ver>.exe`（NSIS 安装包）、`望舒-<ver>-portable.exe`、`win-unpacked/望舒.exe`。
  NSIS 中间文件（`.nsis.7z`、`__uninstaller.exe`）放在 `out/artifacts/_nsis/`。
- **为什么输出根不是 `out/`**：1.0.0 时代留下的 `out/win-unpacked/resources` 被系统句柄占用，无法删除/移动，
  导致 electron-builder 每次启动清理旧输出目录时失败。把输出根下沉一层（`out/artifacts/`）即可彻底绕开。
- `app/package/`、`app/pkg/`、`app/release/` 为**历史废弃目录**，旧 exe 已归档至 `app/_old_builds/`。
- 打包必须带镜像环境变量，否则签名工具下载失败：
  `ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"`
- electron-builder 最后一步清理 `.nsis.7z` / `__uninstaller.exe` 会被沙箱 safe-delete 守卫拦截（退出码 1）
  —— **已知环境限制，产物已生成，可忽略该报错**。
- **安全删除守卫是「每回合累计计数」**（阈值 50）。同一回合内多次构建会互相累加并提前触发，
  连 `build-electron.mjs` 的 `rmSync('dist/electron')` 都会被拦。
  对策：一回合只跑一次完整构建；需要再打包时用 `-c.directories.output=<全新目录>`，不要重复跑 `npm run build`。
- `win-unpacked` 目录常被系统句柄（杀软/索引）占用而无法移动；**需要全新输出时，直接换一个新目录名**，不要去动旧目录。

## 图标约定

- 唯一来源是 `app/scripts/make-icons.py`（归一化几何 + 4× 超采样）。产物：`build/icon.{svg,png,ico}`、`build/icons/<n>x<n>.png`、`public/favicon.png`。
- **按尺寸分档**（不是把大图缩小）：≤24px 关柔光、去星芒；≤48px 柔光减半、星芒放大；≥64px 标准档。
  原因：柔光落在月亮区域会把底色提亮到 `#7FB2FF`，16px 下白月对比度只剩 2.4:1。
- 改几何时**脚本与 `build/icon.svg` 必须同步**，否则两者分叉。
- 核验：`npm run icons:verify`（`scripts/verify-exe-icons.py`）直接解析 PE 资源目录，
  断言每个 exe 都带 `RT_GROUP_ICON` 且 `RT_ICON` 覆盖 16/24/32/48/64/128/256。
- `npm run icons` 需要 Pillow —— 只有系统 Python 3.14 装了，PATH 里的 `python` 可能是没装的那个。

## 测试约定

- 测试脚本：`app/scripts/test-*.mjs`，Node 原生 + esbuild 即时转译 TS，**不引入测试框架**。
- esbuild 的 `alias` **拦不住相对路径导入**，必须用 `onResolve` **plugin**；替身状态挂 `globalThis`。
- 测试基线（当前）：**11 套件 1014 项**（26/43/38/42/34/149/82/103/174/121 + `test-project` 202）。
  `npm run test:all` 应保持全绿零回归。
- **断言里不要硬编码版本字面量**：`schemaVersion === '1.1'` 这类写法升级时会误报成回归，
  应引用 `SCHEMA_VERSION`。`test:project` 已有护栏扫描此模式。
- 历史文档中的旧版本号加 `<!-- hist-version-ok -->` 行内标记豁免，不要为让护栏变绿而篡改史实。
- **纯逻辑层与 IO 层分离**：可离线测的逻辑放纯函数文件（不 import store/react/electron），需要网络的单独一个文件。这是本项目一贯体例。
- 涉及「窗口/进程行为」的结论，**必须有真机实测**（如 `npm run test:close` 用真实 Electron 验证窗口确实关闭），纯函数单测不足以证明。

## 版本控制约定

- 仓库根 = **项目根** `C:/Users/smk/WorkBuddy/stitch`（`app/` 不是独立仓库，不嵌套）。
- **入库范围**：源码 / 文档 / 分析结论 / 配置 / 图标源与图标产物 / `.workbuddy/memory`。
- **不入库**：`node_modules/`、`dist/`、`app/out/`、`app/_old_builds/`、`app/package*/`、`app/pkg/`、
  `app/release*/`、`app/.shots/`、`*.exe`、`*.nsis.7z`、`.env*`。理由：GB 级二进制且可由源码重建。
- `app/build/icon.{png,ico}` 与 `build/icons/` **必须入库** —— electron-builder 直接依赖，缺了则无法打包。
- **提交前必查**：`git status` 里是否混入 `node_modules` / `*.exe` / `out/`；提交后核对文件数与总体积
  （正常量级：**约 200 文件 / 3 MB**；若出现数十 MB 或上千文件，说明忽略规则漏了）。
- 身份：仓库级 `user.name=smk` / `user.email=smk@localhost`（全局未配置，用户可改；改后首次提交用 `--amend --reset-author`）。

## 版本号约定

四种版本**互不联动**，详见 `docs/版本号规范.md`：

| # | 名称 | 当前值 | 位置 |
|---|---|---|---|
| 1 | 产品版本（SemVer） | `1.1.0` | `shared/version.ts` `APP_VERSION` + `package.json` |
| 2 | 项目文件信封 | `1.0` | `shared/design.ts` `FILE_VERSION`（改了旧文件打不开） |
| 3 | 设计数据模型 | `1.2` | `shared/design.ts` `SCHEMA_VERSION` |
| 4 | 文档修订号 | `v1.1` | 各文档头部 `> 版本：` |


## 设计系统约定

- **Design JSON 是唯一数据源**：`app/shared/design.ts`（`SCHEMA_VERSION='1.2'`、`FILE_VERSION='1.0'`）。
- Token 键名约定（与 `style-presets.ts` 对齐，提炼/生成风格必须遵守）：
  - `color`：`primary / primaryHover / primaryActive / primarySoft / onPrimary / bg / surface / surfaceAlt / border / borderStrong / text / textSecondary / textMuted / textInverse / success / warning / danger / info`
  - `font`：`display / h1 / h2 / h3 / body / bodyStrong / caption / overline`（各含 `family/size/weight/lineHeight`）
  - `radius`：`sm / md / lg / xl / full`（full 固定 999）
  - `space`：`xxs / xs / sm / md / lg / xl / xxl / huge`
  - `shadow`：`xs / sm / md / lg`
- 节点样式走**内联 `style`**，所以任何要覆盖它的规则（如 `Node.states` 伪类）必须：用 `[data-id="…"]` 锚定 + **逐条 `!important`** + 集中放进 `<style>` 块。
- 取 TokenMap 的唯一入口是 `tokenMapForPage`（画布/预览/导出/变体四处同源），不要各自 `buildTokenMap`。

## 交互约定

- 面向用户的自动改写（增强、补页、补交互、换规范）**一律需要用户确认，不做静默改写**。
- 提示词增强是**就地覆盖 + 可撤回**（`history` 栈）；不要恢复"原文/增强版二选一"的对比视图。
