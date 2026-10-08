// electron/main/project-fs.ts
// 项目文件（.dsproj）读写、最近项目列表、缩略图缓存、复制与删除
import { app, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ProjectFile, ProjectMeta } from '../../shared/design'
import { FILE_VERSION } from '../../shared/design'
import { remapProjectIds } from '../../shared/interfaces'

const RECENT_FILE = 'recent-projects.json'
const THUMB_DIR = 'thumbnails'
const EXT = '.dsproj'

function recentPath() {
  return path.join(app.getPath('userData'), RECENT_FILE)
}

export const DEFAULT_PROJECT_DIR = () => path.join(app.getPath('documents'), '望舒')

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function sanitizeSegment(s: string): string {
  return String(s ?? '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'project'
}

/** 在目标目录里找一个不冲突的文件名：`名字.dsproj` → `名字 2.dsproj` → ... */
function uniquePathIn(dir: string, baseName: string): string {
  const base = sanitizeSegment(baseName)
  let candidate = path.join(dir, `${base}${EXT}`)
  let i = 2
  while (fs.existsSync(candidate) && i < 1000) {
    candidate = path.join(dir, `${base} ${i}${EXT}`)
    i += 1
  }
  return candidate
}

/* ------------------------------ 最近项目列表 ------------------------------ */

function readRecentRaw(): string[] {
  try {
    if (!fs.existsSync(recentPath())) return []
    const list = JSON.parse(fs.readFileSync(recentPath(), 'utf8')) as string[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeRecent(list: string[]) {
  fs.writeFileSync(recentPath(), JSON.stringify(list.slice(0, 60), null, 2), 'utf8')
}

/* -------------------------------- 缩略图缓存 -------------------------------- */

export const THUMBNAIL_DIR = () => path.join(app.getPath('userData'), THUMB_DIR)

function thumbFileOf(id: string) {
  return path.join(THUMBNAIL_DIR(), `${sanitizeSegment(id)}.png`)
}

/** 写入缩略图（dataUrl 形式，形如 `data:image/png;base64,...`） */
export function writeThumbnail(id: string, dataUrl: string): string | null {
  try {
    const m = /^data:image\/png;base64,(.+)$/i.exec(String(dataUrl ?? ''))
    if (!m) return null
    ensureDir(THUMBNAIL_DIR())
    const file = thumbFileOf(id)
    fs.writeFileSync(file, Buffer.from(m[1], 'base64'))
    return file
  } catch {
    return null
  }
}

/** 读取缩略图 dataUrl；不存在返回 null */
export function readThumbnail(id: string): string | null {
  try {
    const file = thumbFileOf(id)
    if (!fs.existsSync(file)) return null
    return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`
  } catch {
    return null
  }
}

export function removeThumbnail(id: string) {
  try {
    const file = thumbFileOf(id)
    if (fs.existsSync(file)) fs.unlinkSync(file)
  } catch {
    /* 缩略图属于可重建缓存，删除失败不影响任何功能 */
  }
}

/* -------------------------------- 项目元信息 -------------------------------- */

/** 从文件读取项目并生成元信息 */
function buildMeta(filePath: string): ProjectMeta | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const pf = JSON.parse(raw) as ProjectFile
    const d = pf.design
    if (!d?.meta?.id) return null
    return {
      id: d.meta.id,
      name: d.meta.name,
      updatedAt: d.meta.updatedAt,
      createdAt: d.meta.createdAt,
      device: d.meta.device,
      pageCount: d.pages?.length ?? 0,
      path: filePath,
      thumbnail: fs.existsSync(thumbFileOf(d.meta.id)) ? `${d.meta.id}.png` : undefined,
    }
  } catch {
    return null
  }
}

export const projectFs = {
  /** 最近项目列表（自动跳过已删除文件） */
  list(): ProjectMeta[] {
    const files = readRecentRaw()
    const metas: ProjectMeta[] = []
    const alive: string[] = []
    for (const f of files) {
      if (!fs.existsSync(f)) continue
      const m = buildMeta(f)
      if (m) {
        metas.push(m)
        alive.push(f)
      }
    }
    if (alive.length !== files.length) writeRecent(alive)
    return metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  },

  /** 扫描目录，补充未在最近列表中的项目 */
  scan(dir?: string): ProjectMeta[] {
    const target = dir ?? DEFAULT_PROJECT_DIR()
    if (!fs.existsSync(target)) return []
    const out: ProjectMeta[] = []
    try {
      for (const name of fs.readdirSync(target)) {
        if (!name.endsWith(EXT)) continue
        const m = buildMeta(path.join(target, name))
        if (m) out.push(m)
      }
    } catch {
      /* 目录不可读时返回空集，由 UI 提示"扫描失败"而非崩溃 */
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  },

  open(filePath: string): ProjectFile {
    if (!fs.existsSync(filePath)) {
      throw Object.assign(new Error('项目文件不存在'), { code: 'E_FS_NOTFOUND' })
    }
    try {
      const pf = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ProjectFile
      if (!pf.design || !pf.design.pages) {
        throw Object.assign(new Error('项目文件结构不完整'), { code: 'E_FS_CORRUPT' })
      }
      this.touch(filePath)
      return pf
    } catch (e) {
      const err = e as { code?: string }
      if (err.code) throw e
      throw Object.assign(new Error('项目文件已损坏，无法解析'), { code: 'E_FS_CORRUPT' })
    }
  },

  /** 只读元信息（项目中心卡片用，不触发 touch） */
  meta(filePath: string): ProjectMeta | null {
    return buildMeta(filePath)
  },

  /** 保存到已绑定路径 */
  save(filePath: string, pf: ProjectFile): string {
    ensureDir(path.dirname(filePath))
    // 统一补 fileVersion，避免调用方遗漏
    const payload: ProjectFile = { fileVersion: pf.fileVersion || FILE_VERSION, design: pf.design }
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
    this.touch(filePath)
    return filePath
  },

  /**
   * 保存到**指定路径**（不弹对话框）。
   * 与 save 的区别：save 用于已绑定路径的静默保存，这个方法专供
   * 「另存为指定位置」「从向导创建项目」这类已知目标路径的场景。
   */
  saveTo(targetPath: string, pf: ProjectFile): string {
    const withExt = targetPath.toLowerCase().endsWith(EXT) ? targetPath : `${targetPath}${EXT}`
    return this.save(withExt, pf)
  },

  /** 另存为：弹出对话框 */
  async saveAs(pf: ProjectFile, suggestedName?: string): Promise<string | null> {
    const defaultDir = DEFAULT_PROJECT_DIR()
    ensureDir(defaultDir)
    const res = await dialog.showSaveDialog({
      title: '另存为',
      defaultPath: path.join(
        defaultDir,
        `${sanitizeSegment(suggestedName || pf.design.meta.name || '未命名项目')}${EXT}`,
      ),
      filters: [{ name: '望舒项目', extensions: ['dsproj'] }],
    })
    if (res.canceled || !res.filePath) return null
    return this.save(res.filePath, pf)
  },

  /** 在默认目录中按名称新建（自动避让重名），返回落盘路径 */
  createInDefaultDir(name: string, pf: ProjectFile): string {
    const dir = DEFAULT_PROJECT_DIR()
    ensureDir(dir)
    const target = uniquePathIn(dir, name || '未命名项目')
    return this.save(target, pf)
  },

  /**
   * 复制项目文件：重排全部实体 id 后写到同目录的新文件。
   * 返回新文件路径。
   */
  duplicate(filePath: string, newName?: string): string {
    const src = this.open(filePath)
    const base = newName?.trim() || `${src.design.meta.name} 副本`
    const target = uniquePathIn(path.dirname(filePath), base)
    const copy = remapProjectIds(src, { name: path.basename(target, EXT) })
    return this.save(target, copy)
  },

  touch(filePath: string) {
    const list = readRecentRaw().filter((f) => f !== filePath)
    list.unshift(filePath)
    writeRecent(list)
  },

  remove(filePath: string) {
    writeRecent(readRecentRaw().filter((f) => f !== filePath))
  },

  /**
   * 删除项目文件 —— **走系统回收站，不做永久删除**。
   *
   * 历史缺陷 BUG-PM-1：旧实现用 `fs.unlinkSync`，绕过回收站且不可恢复，
   * 用户误点「删除项目」即永久失去作品。按项目的安全约定，一律优先回收站。
   */
  async trash(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) await shell.trashItem(filePath)
    } catch (e) {
      // 回收站不可用（部分 Linux 桌面 / 无桌面会话）时，抛出让上层提示用户，
      // **不**退化为 unlinkSync —— 宁可删不掉，也不能静默永久删除。
      throw Object.assign(new Error('无法移入回收站，请手动在文件管理器中删除'), {
        code: 'E_FS_TRASH',
        detail: String((e as Error)?.message ?? e),
      })
    }
    // 连带清理缩略图缓存与最近列表
    const meta = buildMeta(filePath)
    if (meta) removeThumbnail(meta.id)
    this.remove(filePath)
  },

  defaultDir(): string {
    return DEFAULT_PROJECT_DIR()
  },
}
