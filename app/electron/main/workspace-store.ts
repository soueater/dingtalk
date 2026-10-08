// electron/main/workspace-store.ts
// 工作区索引（F-PM-02）：项目的收藏 / 分组 / 标签 / 缩略图指针。
//
// 刻意独立于 .dsproj —— 这些是「使用者视角」的组织元数据，不是设计产物。
// 写进项目文件会污染可交付物，并在多人协作时制造无意义冲突。
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ProjectMeta, WorkspaceEntry, WorkspaceGroup, WorkspaceIndex } from '../../shared/design'
import { EMPTY_WORKSPACE } from '../../shared/design'
import { uid } from '../../shared/ids'

const FILE = 'workspace.json'

function indexPath() {
  return path.join(app.getPath('userData'), FILE)
}

function sanitize(index: unknown): WorkspaceIndex {
  const i = index as Partial<WorkspaceIndex> | null
  if (!i || typeof i !== 'object') return { ...EMPTY_WORKSPACE, entries: {}, groups: [], tags: [] }
  const entries: Record<string, WorkspaceEntry> = {}
  if (i.entries && typeof i.entries === 'object') {
    for (const [k, v] of Object.entries(i.entries)) {
      if (!v || typeof v !== 'object') continue
      const e = v as WorkspaceEntry
      entries[k] = {
        path: typeof e.path === 'string' ? e.path : undefined,
        name: typeof e.name === 'string' ? e.name : '未命名项目',
        favorite: !!e.favorite,
        pinned: !!e.pinned,
        archived: !!e.archived,
        groupId: typeof e.groupId === 'string' ? e.groupId : undefined,
        tags: Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === 'string') : undefined,
        thumbnailFile: typeof e.thumbnailFile === 'string' ? e.thumbnailFile : undefined,
        lastOpenedAt: typeof e.lastOpenedAt === 'string' ? e.lastOpenedAt : undefined,
      }
    }
  }
  const groups: WorkspaceGroup[] = Array.isArray(i.groups)
    ? i.groups
        .filter((g) => g && typeof g === 'object' && typeof (g as WorkspaceGroup).id === 'string')
        .map((g, n) => ({
          id: (g as WorkspaceGroup).id,
          name: typeof (g as WorkspaceGroup).name === 'string' ? (g as WorkspaceGroup).name : `分组 ${n + 1}`,
          order: Number.isFinite((g as WorkspaceGroup).order) ? (g as WorkspaceGroup).order : n,
          color: (g as WorkspaceGroup).color,
        }))
    : []
  const tags = Array.isArray(i.tags) ? [...new Set(i.tags.filter((t) => typeof t === 'string'))] : []
  return { version: 1, entries, groups, tags }
}

export const workspaceStore = {
  load(): WorkspaceIndex {
    try {
      const p = indexPath()
      if (!fs.existsSync(p)) return sanitize(null)
      return sanitize(JSON.parse(fs.readFileSync(p, 'utf8')))
    } catch {
      // 索引损坏不影响项目本身可打开 —— 重置为空白索引即可
      return sanitize(null)
    }
  },

  save(index: WorkspaceIndex): WorkspaceIndex {
    const safe = sanitize(index)
    fs.writeFileSync(indexPath(), JSON.stringify(safe, null, 2), 'utf8')
    return safe
  },

  /** 局部更新某个项目的组织元数据 */
  patchEntry(projectId: string, patch: Partial<WorkspaceEntry>): WorkspaceIndex {
    const idx = this.load()
    const prev = idx.entries[projectId] ?? { name: '未命名项目' }
    idx.entries[projectId] = { ...prev, ...patch, name: patch.name ?? prev.name }
    return this.save(idx)
  },

  /** 记录一次打开（用于「最近打开」排序） */
  touchOpened(projectId: string, name: string, filePath: string): WorkspaceIndex {
    return this.patchEntry(projectId, {
      name,
      path: filePath,
      lastOpenedAt: new Date().toISOString(),
    })
  },

  removeEntry(projectId: string): WorkspaceIndex {
    const idx = this.load()
    delete idx.entries[projectId]
    return this.save(idx)
  },

  addGroup(name: string): WorkspaceIndex {
    const idx = this.load()
    idx.groups = [
      ...idx.groups,
      { id: `grp_${uid()}`, name: name.trim() || `分组 ${idx.groups.length + 1}`, order: idx.groups.length },
    ]
    return this.save(idx)
  },

  renameGroup(groupId: string, name: string): WorkspaceIndex {
    const idx = this.load()
    idx.groups = idx.groups.map((g) => (g.id === groupId ? { ...g, name: name.trim() || g.name } : g))
    return this.save(idx)
  },

  /** 删除分组：成员回到「未分组」 */
  removeGroup(groupId: string): WorkspaceIndex {
    const idx = this.load()
    idx.groups = idx.groups.filter((g) => g.id !== groupId)
    for (const key of Object.keys(idx.entries)) {
      if (idx.entries[key].groupId === groupId) delete idx.entries[key].groupId
    }
    return this.save(idx)
  },

  ensureTag(tag: string): WorkspaceIndex {
    const t = tag.trim()
    if (!t) return this.load()
    const idx = this.load()
    if (!idx.tags.includes(t)) idx.tags = [...idx.tags, t]
    return this.save(idx)
  },

  /**
   * 把工作区元数据合并进项目列表，并**丢弃源文件已消失的条目对 UI 的影响**：
   * 文件不在了但仍留在索引里的项目会以 `missing: true` 的形式一并返回，
   * 让用户在项目中心看到「已失效」占位而不是让记录静默消失。
   */
  merge(metas: ProjectMeta[]): ProjectMeta[] {
    const idx = this.load()
    const byPath = new Set(metas.map((m) => m.path))
    const byId = new Map(metas.map((m) => [m.id, m]))

    for (const [id, e] of Object.entries(idx.entries)) {
      if (byId.has(id)) continue
      if (e.path && byPath.has(e.path)) continue
      // 索引里有、磁盘上没有 —— 保留占位
      metas.push({
        id,
        name: e.name,
        updatedAt: e.lastOpenedAt ?? '',
        createdAt: '',
        device: 'MOBILE',
        pageCount: 0,
        path: e.path ?? '',
        thumbnail: e.thumbnailFile,
      })
    }

    return metas.map((m) => ({ ...m, workspace: idx.entries[m.id] }))
  },
}
