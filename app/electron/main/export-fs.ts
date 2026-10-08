// electron/main/export-fs.ts
// 导出落盘：PNG / SVG / HTML / JSON
import { dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ExportFormat, ExportRequest, ExportResult } from '../../shared/design'
import { projectFs } from './project-fs'

const FORMAT_LABEL: Record<ExportFormat, string> = {
  png: 'PNG 图片',
  svg: 'SVG 矢量图',
  'html-single': 'HTML 单文件',
  'html-multi': 'HTML 工程（多文件）',
  json: 'JSON 源文件',
}

const FORMAT_EXT: Record<ExportFormat, string> = {
  png: 'png',
  svg: 'svg',
  'html-single': 'html',
  'html-multi': '',
  json: 'dsproj.json',
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/** 为导出请求选择目标路径 */
export async function pickExportTarget(
  format: ExportFormat,
  suggestedName: string,
  isDir: boolean,
): Promise<string | null> {
  const baseDir = projectFs.defaultDir()
  ensureDir(baseDir)

  if (isDir) {
    const res = await dialog.showOpenDialog({
      title: '选择导出目录',
      defaultPath: baseDir,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (res.canceled || !res.filePaths.length) return null
    return path.join(res.filePaths[0], suggestedName)
  }

  const ext = FORMAT_EXT[format]
  const res = await dialog.showSaveDialog({
    title: `导出为 ${FORMAT_LABEL[format]}`,
    defaultPath: path.join(baseDir, `${suggestedName}.${ext || 'html'}`),
    filters: [{ name: FORMAT_LABEL[format], extensions: [ext || 'html'] }],
  })
  if (res.canceled || !res.filePath) return null
  return res.filePath
}

export const exportFs = {
  /** 写出导出物（PNG/SVG 的二进制由渲染层通过 IPC 传来 base64） */
  write(req: ExportRequest & { pngBase64?: Record<string, string> }): ExportResult {
    try {
      switch (req.format) {
        case 'json': {
          if (!req.design) return { ok: false, message: '缺少 JSON 数据' }
          ensureDir(path.dirname(req.targetPath))
          fs.writeFileSync(req.targetPath, JSON.stringify(req.design, null, 2), 'utf8')
          return { ok: true, path: req.targetPath, message: 'JSON 已导出' }
        }
        case 'html-single': {
          const file = req.files?.[0]
          if (!file) return { ok: false, message: '缺少 HTML 内容' }
          ensureDir(path.dirname(req.targetPath))
          fs.writeFileSync(req.targetPath, file.content, 'utf8')
          return { ok: true, path: req.targetPath, message: 'HTML 单文件已导出' }
        }
        case 'svg': {
          const file = req.files?.[0]
          if (!file) return { ok: false, message: '缺少 SVG 内容' }
          ensureDir(path.dirname(req.targetPath))
          fs.writeFileSync(req.targetPath, file.content, 'utf8')
          return { ok: true, path: req.targetPath, message: 'SVG 已导出' }
        }
        case 'html-multi': {
          if (!req.files?.length) return { ok: false, message: '缺少工程文件' }
          ensureDir(req.targetPath)
          const written: string[] = []
          for (const f of req.files) {
            const dest = path.join(req.targetPath, f.name)
            ensureDir(path.dirname(dest))
            fs.writeFileSync(dest, f.content, 'utf8')
            written.push(dest)
          }
          return { ok: true, path: req.targetPath, message: `已导出 ${written.length} 个文件`, files: written }
        }
        case 'png': {
          // 目录路径：每个页面一个 png
          const target = req.targetPath
          const isDir = !path.extname(target)
          const written: string[] = []
          const b64 = req.pngBase64 ?? {}
          if (isDir) {
            ensureDir(target)
            for (const [pid, data] of Object.entries(b64)) {
              const name = req.pages?.find((p) => p.id === pid)?.name ?? pid
              const dest = path.join(target, `${sanitize(name)}.png`)
              fs.writeFileSync(dest, Buffer.from(data, 'base64'))
              written.push(dest)
            }
          } else {
            // 单文件：取第一张
            const first = Object.values(b64)[0]
            if (!first) return { ok: false, message: '缺少图片数据' }
            ensureDir(path.dirname(target))
            fs.writeFileSync(target, Buffer.from(first, 'base64'))
            written.push(target)
          }
          return { ok: true, path: isDir ? target : written[0], message: `已导出 ${written.length} 张 PNG`, files: written }
        }
        default:
          return { ok: false, message: '不支持的格式' }
      }
    } catch (e) {
      const msg = (e as Error).message
      if (/EACCES|EPERM/i.test(msg)) {
        return { ok: false, message: '无权限写入该位置，请另选路径' }
      }
      return { ok: false, message: `导出失败：${msg}` }
    }
  },
}

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'page'
}
