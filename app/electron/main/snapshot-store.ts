// electron/main/snapshot-store.ts
// 项目快照与崩溃恢复（F-PM-03）。
//
// 两类快照：
//   · auto   —— 每次 commit 后节流写入，应用崩溃 / 断电时可恢复；
//   · manual —— 用户在「项目设置」里主动创建，保留最近 10 个。
//
// 与项目文件解耦：快照是可丢弃的中间产物，不参与交付。
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { DesignJSON, ProjectFile, SnapshotEntry } from '../../shared/design'
import { FILE_VERSION } from '../../shared/design'
import { uid } from '../../shared/ids'

const AUTOSAVE_DIR = 'autosave'
const SNAPSHOT_DIR = 'snapshots'
const MAX_MANUAL = 10

function sanitizeSegment(s: string): string {
  return String(s ?? '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'project'
}

const autoDir = () => path.join(app.getPath('userData'), AUTOSAVE_DIR)
const snapRoot = () => path.join(app.getPath('userData'), SNAPSHOT_DIR)

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function writeJson(file: string, design: DesignJSON) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify({ fileVersion: FILE_VERSION, design }, null, 2), 'utf8')
}

function readJson(file: string): ProjectFile | null {
  try {
    if (!fs.existsSync(file)) return null
    const pf = JSON.parse(fs.readFileSync(file, 'utf8')) as ProjectFile
    if (!pf?.design?.pages) return null
    return pf
  } catch {
    return null
  }
}

export const snapshotStore = {
  /* ------------------------------- 崩溃恢复 ------------------------------- */

  autoPath(projectId: string) {
    return path.join(autoDir(), `${sanitizeSegment(projectId)}.json`)
  },

  writeAuto(projectId: string, design: DesignJSON): boolean {
    try {
      writeJson(this.autoPath(projectId), design)
      return true
    } catch {
      return false
    }
  },

  readAuto(projectId: string): ProjectFile | null {
    return readJson(this.autoPath(projectId))
  },

  clearAuto(projectId: string) {
    try {
      const p = this.autoPath(projectId)
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* 清理失败无害 */
    }
  },

  /** 是否存在「比项目文件更新」的自动快照（启动时用于提示恢复） */
  hasNewerAuto(projectId: string, projectUpdatedAt: string): boolean {
    try {
      const p = this.autoPath(projectId)
      if (!fs.existsSync(p)) return false
      const auto = fs.statSync(p).mtimeMs
      const base = Date.parse(projectUpdatedAt || '') || 0
      return auto > base
    } catch {
      return false
    }
  },

  /* ------------------------------- 手动快照 ------------------------------- */

  dirOf(projectId: string) {
    return path.join(snapRoot(), sanitizeSegment(projectId))
  },

  createManual(projectId: string, design: DesignJSON, name: string): SnapshotEntry | null {
    try {
      const dir = this.dirOf(projectId)
      ensureDir(dir)
      const id = `snap_${uid()}`
      const at = new Date().toISOString()
      const file = path.join(dir, `${id}.json`)
      writeJson(file, design)
      fs.writeFileSync(
        path.join(dir, `${id}.meta.json`),
        JSON.stringify({ id, projectId, at, kind: 'manual', name }, null, 2),
        'utf8',
      )
      this.prune(projectId)
      return { id, projectId, at, kind: 'manual', name, path: file }
    } catch {
      return null
    }
  },

  list(projectId: string): SnapshotEntry[] {
    try {
      const dir = this.dirOf(projectId)
      if (!fs.existsSync(dir)) return []
      const out: SnapshotEntry[] = []
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.meta.json')) continue
        try {
          const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as SnapshotEntry
          if (m?.id) out.push(m)
        } catch {
          /* 单条损坏跳过 */
        }
      }
      return out.sort((a, b) => (a.at < b.at ? 1 : -1))
    } catch {
      return []
    }
  },

  read(projectId: string, snapshotId: string): ProjectFile | null {
    return readJson(path.join(this.dirOf(projectId), `${sanitizeSegment(snapshotId)}.json`))
  },

  remove(projectId: string, snapshotId: string) {
    const dir = this.dirOf(projectId)
    for (const suffix of ['.json', '.meta.json']) {
      try {
        const p = path.join(dir, `${sanitizeSegment(snapshotId)}${suffix}`)
        if (fs.existsSync(p)) fs.unlinkSync(p)
      } catch {
        /* 忽略 */
      }
    }
  },

  /** 只保留最近 MAX_MANUAL 个手动快照 */
  prune(projectId: string) {
    const list = this.list(projectId)
    list.slice(MAX_MANUAL).forEach((s) => this.remove(projectId, s.id))
  },
}
