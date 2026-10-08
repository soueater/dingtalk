/**
 * 版本号与产品标识的**唯一事实来源**。
 *
 * 规则（SemVer 2.0.0，`MAJOR.MINOR.PATCH`）：
 *   - MAJOR：不兼容的破坏性变更（如 Design JSON 主版本、项目文件格式断裂）
 *   - MINOR：向后兼容的功能新增（新增能力、新增可选字段、新增 IPC 通道）
 *   - PATCH：向后兼容的缺陷修复
 *
 * 任何需要展示或比较产品版本的位置（package.json 除外）都必须引用本模块，
 * 禁止再出现硬编码字面量 —— 历史教训：`electron/main/ipc.ts` 曾把版本写死为
 * `'1.0.0'`，升级后 `app:info` 仍返回旧值，导致「关于」页与安装包版本不一致。
 *
 * 注意：本文件**不**依赖任何 Electron / Node API，主进程与渲染进程共用。
 */

/** 产品名称（中文名，用于窗口标题、安装包、UI 展示） */
export const APP_NAME = '望舒'

/** 产品英文标识（用于 userData 目录名、进程名等不适合中文的位置） */
export const APP_SLUG = 'wanshu'

/** Electron appId（与 package.json 的 build.appId 保持一致） */
export const APP_ID = 'com.local.designassistant'

/** 产品版本号 */
export const APP_VERSION = '1.1.0'

/** 版本号形态断言：必须满足 SemVer 三段式，缺一段即为配置错误 */
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/

/** 解析为可比较的三元组；非法输入返回 null */
export function parseVersion(v: string): [number, number, number] | null {
  if (!VERSION_PATTERN.test(v)) return null
  const [a, b, c] = v.split('.').map((n) => Number.parseInt(n, 10))
  return [a, b, c]
}

/** 比较两个版本：a > b 返回 1，a < b 返回 -1，相等返回 0（非法版本视为 -1 级） */
export function compareVersion(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return pa === pb ? 0 : pa ? 1 : -1
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1
  }
  return 0
}

/** 形如「望舒 v1.1.0」的完整展示串 */
export function versionLabel(): string {
  return `${APP_NAME} v${APP_VERSION}`
}
