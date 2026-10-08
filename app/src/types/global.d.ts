/// <reference types="vite/client" />

import type { DsaApi } from '../../electron/preload/index'

declare global {
  interface Window {
    /** 由 preload 通过 contextBridge 注入；纯浏览器调试环境下可能为 undefined */
    dsa: DsaApi
    /** 打包后由主进程注入的只读信息 */
    __APP_VERSION__?: string
  }
}

export {}
