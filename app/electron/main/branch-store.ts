// electron/main/branch-store.ts
// 方案分支（F-PM-07）的持久化。
//
// 为什么不把分支写进 .dsproj：
//   分支是「尚未采纳的备选方案」，写进项目文件会让交付物里混入大量死数据，
//   也会让两个人各自探索方案时互相冲突。故与缩略图/工作区索引一样独立存放。
//
// 存放位置：userData/branches/<projectId>/<branchId>.json
//   · meta 单独一份，便于列表接口只读 meta、不读庞大的 pages 树；
//   · 每个项目保留最近 MAX_BRANCHES 条，按创建时间淘汰。
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Node, Page, ProjectBranch, ProjectBranchSummary, Tokens } from '../../shared/design'
import { uid } from '../../shared/ids'

const BRANCH_DIR = 'branches'
/** 单个项目保留的分支数上限（超出按创建时间淘汰最旧的） */
const MAX_BRANCHES = 20

function sanitizeSegment(s: string): string {
  return String(s ?? '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'project'
}

const branchRoot = () => path.join(app.getPath('userData'), BRANCH_DIR)

function dirOf(projectId: string): string {
  return path.join(branchRoot(), sanitizeSegment(projectId))
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function countNodes(n: Node): number {
  return 1 + (n.children?.reduce((s, c) => s + countNodes(c), 0) ?? 0)
}

function summarize(b: ProjectBranch): ProjectBranchSummary {
  return {
    id: b.id,
    projectId: b.projectId,
    name: b.name,
    aspect: b.aspect,
    createdAt: b.createdAt,
    adopted: b.adopted,
    pageCount: b.pages.length,
    flowCount: b.flows.length,
    nodeCount: b.pages.reduce((s, p) => s + countNodes(p.root), 0),
  }
}

export const branchStore = {
  dirOf,

  /** 列表：只读 meta，避免把整棵树搬到内存 */
  list(projectId: string): ProjectBranchSummary[] {
    try {
      const dir = dirOf(projectId)
      if (!fs.existsSync(dir)) return []
      const out: ProjectBranchSummary[] = []
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.meta.json')) continue
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as ProjectBranchSummary
          if (meta?.id) out.push(meta)
        } catch {
          /* 单条损坏跳过，不影响其余 */
        }
      }
      return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    } catch {
      return []
    }
  },

  create(
    projectId: string,
    payload: { name: string; aspect?: string; pages: Page[]; flows: ProjectBranch['flows']; tokens?: Tokens },
  ): ProjectBranchSummary | null {
    try {
      const dir = dirOf(projectId)
      ensureDir(dir)
      const id = `br_${uid()}`
      const createdAt = new Date().toISOString()
      const branch: ProjectBranch = {
        id,
        projectId,
        name: payload.name,
        aspect: payload.aspect,
        createdAt,
        pages: payload.pages,
        flows: payload.flows,
        tokens: payload.tokens,
        adopted: false,
      }
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(branch), 'utf8')
      const meta = summarize(branch)
      fs.writeFileSync(path.join(dir, `${id}.meta.json`), JSON.stringify(meta, null, 2), 'utf8')
      this.prune(projectId)
      return meta
    } catch {
      return null
    }
  },

  read(projectId: string, branchId: string): ProjectBranch | null {
    try {
      const file = path.join(dirOf(projectId), `${sanitizeSegment(branchId)}.json`)
      if (!fs.existsSync(file)) return null
      const b = JSON.parse(fs.readFileSync(file, 'utf8')) as ProjectBranch
      return b?.pages ? b : null
    } catch {
      return null
    }
  },

  rename(projectId: string, branchId: string, name: string, aspect?: string): boolean {
    const b = this.read(projectId, branchId)
    if (!b) return false
    try {
      b.name = name
      if (aspect !== undefined) b.aspect = aspect
      const dir = dirOf(projectId)
      fs.writeFileSync(path.join(dir, `${sanitizeSegment(branchId)}.json`), JSON.stringify(b), 'utf8')
      fs.writeFileSync(
        path.join(dir, `${sanitizeSegment(branchId)}.meta.json`),
        JSON.stringify(summarize(b), null, 2),
        'utf8',
      )
      return true
    } catch {
      return false
    }
  },

  /** 标记为已采纳（并清掉其它分支的 adopted，保证同一时刻只有一个「当前方案」） */
  markAdopted(projectId: string, branchId: string): boolean {
    const list = this.list(projectId)
    for (const m of list) {
      const b = this.read(projectId, m.id)
      if (!b) continue
      const next = b.id === branchId
      if (!!b.adopted === next) continue
      b.adopted = next
      try {
        const dir = dirOf(projectId)
        fs.writeFileSync(path.join(dir, `${m.id}.json`), JSON.stringify(b), 'utf8')
        fs.writeFileSync(path.join(dir, `${m.id}.meta.json`), JSON.stringify(summarize(b), null, 2), 'utf8')
      } catch {
        /* 单条写失败不影响其它 */
      }
    }
    return true
  },

  remove(projectId: string, branchId: string) {
    const dir = dirOf(projectId)
    for (const suffix of ['.json', '.meta.json']) {
      try {
        const p = path.join(dir, `${sanitizeSegment(branchId)}${suffix}`)
        if (fs.existsSync(p)) fs.unlinkSync(p)
      } catch {
        /* 忽略 */
      }
    }
  },

  /** 只保留最近 MAX_BRANCHES 条，且不淘汰已被采纳的那条 */
  prune(projectId: string) {
    const list = this.list(projectId)
    list
      .slice(MAX_BRANCHES)
      .filter((m) => !m.adopted)
      .forEach((m) => this.remove(projectId, m.id))
  },

  /** 项目被删除时一并清空（由 project-fs 调用） */
  clear(projectId: string) {
    try {
      const dir = dirOf(projectId)
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 忽略 */
    }
  },
}
