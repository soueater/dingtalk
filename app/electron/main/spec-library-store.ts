// electron/main/spec-library-store.ts
// 用户级设计规范库（F-PM-06）：跨项目复用的规范集合。
//
// 与「项目内规范」（design.specs）的区别：
//   项目内  —— 随项目文件走，换项目就看不到；
//   用户级  —— 存在 userData/spec-library.json，任何项目都可选用，
//              用于落实 Stitch DESIGN.md 的"跨工具/跨项目一致事实源"思路。
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { DesignSpec } from '../../shared/design'

const FILE = 'spec-library.json'

function libPath() {
  return path.join(app.getPath('userData'), FILE)
}

function sanitize(raw: unknown): DesignSpec[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s) => s && typeof s === 'object' && typeof (s as DesignSpec).id === 'string')
    .map((s) => {
      const x = s as DesignSpec
      return {
        id: x.id,
        name: typeof x.name === 'string' ? x.name : '未命名规范',
        desc: typeof x.desc === 'string' ? x.desc : undefined,
        // 用户级库里的规范一律标记为 imported/derived 语义；来源字段保持原值
        source: x.source === 'derived' ? 'derived' : 'imported',
        tokens: x.tokens ?? {},
        rules: x.rules,
        createdAt: typeof x.createdAt === 'string' ? x.createdAt : new Date().toISOString(),
      }
    })
}

export const specLibraryStore = {
  list(): DesignSpec[] {
    try {
      const p = libPath()
      if (!fs.existsSync(p)) return []
      return sanitize(JSON.parse(fs.readFileSync(p, 'utf8'))).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1,
      )
    } catch {
      return []
    }
  },

  save(list: DesignSpec[]): DesignSpec[] {
    const safe = sanitize(list)
    fs.writeFileSync(libPath(), JSON.stringify(safe, null, 2), 'utf8')
    return safe
  },

  /** 新增或覆盖同名 id 的一条规范 */
  upsert(spec: DesignSpec): DesignSpec[] {
    const list = this.list()
    const at = list.findIndex((s) => s.id === spec.id)
    if (at >= 0) list[at] = spec
    else list.unshift(spec)
    return this.save(list)
  },

  remove(id: string): DesignSpec[] {
    return this.save(this.list().filter((s) => s.id !== id))
  },
}
