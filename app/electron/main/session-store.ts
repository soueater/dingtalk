// electron/main/session-store.ts
// 会话恢复（F-PM-03）：记录退出时打开了哪些窗口及其项目，下次启动原样还原。
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { SessionFile } from '../../shared/design'

const FILE = 'session.json'

function sessionPath() {
  return path.join(app.getPath('userData'), FILE)
}

function sanitize(raw: unknown): SessionFile {
  const s = raw as Partial<SessionFile> | null
  const windows = Array.isArray(s?.windows)
    ? s!.windows
        .filter((w) => w && typeof w === 'object' && typeof (w as { path?: string }).path === 'string')
        .map((w) => ({
          path: (w as { path: string }).path,
          activePageId:
            typeof (w as { activePageId?: string }).activePageId === 'string'
              ? (w as { activePageId: string }).activePageId
              : undefined,
        }))
        .slice(0, 8) // 最多还原 8 个窗口，避免异常情况下开出一堆窗口
    : []
  return { version: 1, windows }
}

export const sessionStore = {
  load(): SessionFile {
    try {
      const p = sessionPath()
      if (!fs.existsSync(p)) return { version: 1, windows: [] }
      const parsed = sanitize(JSON.parse(fs.readFileSync(p, 'utf8')))
      // 过滤掉已不存在的项目文件，避免启动时连环报错
      return { version: 1, windows: parsed.windows.filter((w) => fs.existsSync(w.path)) }
    } catch {
      return { version: 1, windows: [] }
    }
  },

  save(session: SessionFile): void {
    try {
      fs.writeFileSync(sessionPath(), JSON.stringify(sanitize(session), null, 2), 'utf8')
    } catch {
      /* 会话恢复属便利功能，写入失败不阻断退出 */
    }
  },

  clear(): void {
    try {
      const p = sessionPath()
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* 忽略 */
    }
  },
}
