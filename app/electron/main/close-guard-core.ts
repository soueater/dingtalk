// electron/main/close-guard-core.ts
// 「关闭守卫」的纯逻辑内核 —— 不 import electron，可被单元测试直接覆盖。
//
// 缺陷背景（软件无法正常关闭）：
//   渲染层 src/App.tsx 曾用 window.beforeunload 在 dirty 时 preventDefault()，
//   Electron 对渲染层取消卸载的反应是触发主进程 webContents 的
//   'will-prevent-unload' 事件；主进程当时没有任何监听器，于是走了 Chromium
//   的默认分支「阻止卸载」——点击关闭按钮（或 Alt+F4）毫无反应，也没有任何提示。
//   修复思路：关闭决策权收归主进程，beforeunload 降级为「浏览器调试环境兜底」。
//
// 本文件只描述决策规则，副作用（弹窗 / 关窗 / 通知渲染层保存）在同目录 close-guard.ts。

/** 用户对「是否保存」的三种回答 */
export type CloseChoice = 'save' | 'discard' | 'cancel'

/** 主进程对一次 close 事件的处置 */
export type CloseDecision = 'allow' | 'ask' | 'ignore'

export interface CloseSnapshot {
  /** 已确认关闭（用户选了「不保存」，或「保存」且保存成功），后续 close 直接放行 */
  confirmed: boolean
  /** 渲染层同步过来的「有未保存改动」标记 */
  dirty: boolean
  /** 确认对话框是否正在展示，避免连点关闭弹出多个框 */
  dialogOpen: boolean
}

/**
 * 决定本次 close 事件怎么处理：
 * - allow  ：直接关闭（已确认，或本来就没有未保存改动）
 * - ask    ：弹三选项确认框
 * - ignore ：已有对话框在路上，本次不处理，也**不能放行**（放行会丢改动）
 */
export function decideClose(s: CloseSnapshot): CloseDecision {
  if (s.confirmed) return 'allow'
  if (s.dialogOpen) return 'ignore'
  if (!s.dirty) return 'allow'
  return 'ask'
}

/**
 * 原生对话框返回值 → 语义动作。
 * 约定按钮顺序 [保存并关闭, 不保存, 取消]，因此 0/1/2 之外的一切取值
 * （undefined、null、负数、越界）统一按「取消」处理 —— 保守即安全。
 */
export function mapDialogResponse(response: number | undefined | null): CloseChoice {
  if (response === 0) return 'save'
  if (response === 1) return 'discard'
  return 'cancel'
}

/** 选择动作后主进程的下一步 */
export type ChoiceEffect = 'close-now' | 'save-then-close' | 'stay'

export function effectOfChoice(choice: CloseChoice): ChoiceEffect {
  if (choice === 'discard') return 'close-now'
  if (choice === 'save') return 'save-then-close'
  return 'stay'
}

/**
 * 渲染层保存结束后是否放行关闭。
 * 保存失败必须保持窗口打开，否则用户的改动会随窗口一起消失。
 */
export function shouldCloseAfterSave(saveOk: boolean): boolean {
  return saveOk === true
}

/** 对话框中三个按钮的文案顺序，集中在此便于与 mapDialogResponse 对齐 */
export const CLOSE_DIALOG_BUTTONS = ['保存并关闭', '不保存', '取消'] as const
/** 默认聚焦「保存并关闭」 */
export const CLOSE_DIALOG_DEFAULT_ID = 0
/** ESC 等价于「取消」 */
export const CLOSE_DIALOG_CANCEL_ID = 2
