// electron/main/config-store.ts
// 模型配置的持久化（不含明文密钥，密钥交给 secure-store）
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ConfigInput, ConfigPublic, AdapterId } from '../../shared/design'
import { secureStore, maskKey } from './secure-store'

interface StoredConfig {
  id: string
  name: string
  adapter: AdapterId
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  timeoutMs: number
  stream: boolean
  isDefault: boolean
}

const FILE = 'configs.json'

function filePath() {
  return path.join(app.getPath('userData'), FILE)
}

function readAll(): StoredConfig[] {
  try {
    if (!fs.existsSync(filePath())) return []
    return JSON.parse(fs.readFileSync(filePath(), 'utf8')) as StoredConfig[]
  } catch {
    return []
  }
}

function writeAll(list: StoredConfig[]) {
  fs.writeFileSync(filePath(), JSON.stringify(list, null, 2), 'utf8')
}

function genId() {
  return `cfg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function toPublic(c: StoredConfig): ConfigPublic {
  const key = secureStore.get(c.id)
  return {
    id: c.id,
    name: c.name,
    adapter: c.adapter,
    baseUrl: c.baseUrl,
    model: c.model,
    temperature: c.temperature,
    maxTokens: c.maxTokens,
    timeoutMs: c.timeoutMs,
    stream: c.stream,
    isDefault: c.isDefault,
    keyMasked: key ? maskKey(key) : '',
    hasKey: !!key,
  }
}

export const configStore = {
  list(): ConfigPublic[] {
    return readAll().map(toPublic)
  },

  /** 内部用：取原始配置（供 LLM 调用），含 id */
  raw(id: string): StoredConfig | undefined {
    return readAll().find((c) => c.id === id)
  },

  rawDefault(): StoredConfig | undefined {
    const all = readAll()
    return all.find((c) => c.isDefault) ?? all[0]
  },

  save(input: ConfigInput): ConfigPublic {
    const all = readAll()
    let target = input.id ? all.find((c) => c.id === input.id) : undefined

    if (!target) {
      target = {
        id: genId(),
        name: input.name,
        adapter: input.adapter,
        baseUrl: input.baseUrl,
        model: input.model,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        timeoutMs: input.timeoutMs,
        stream: input.stream,
        isDefault: all.length === 0,
      }
      all.push(target)
    } else {
      target.name = input.name
      target.adapter = input.adapter
      target.baseUrl = input.baseUrl
      target.model = input.model
      target.temperature = input.temperature
      target.maxTokens = input.maxTokens
      target.timeoutMs = input.timeoutMs
      target.stream = input.stream
    }

    // 密钥：仅当传入非空且非掩码占位时更新
    if (input.apiKey && input.apiKey.trim() && !input.apiKey.includes('****')) {
      secureStore.set(target.id, input.apiKey.trim())
    }

    // 默认项唯一
    if (input.isDefault) {
      all.forEach((c) => (c.isDefault = false))
      target.isDefault = true
    }
    if (!all.some((c) => c.isDefault)) all[0].isDefault = true

    writeAll(all)
    return toPublic(target)
  },

  remove(id: string) {
    const all = readAll().filter((c) => c.id !== id)
    if (all.length && !all.some((c) => c.isDefault)) all[0].isDefault = true
    writeAll(all)
    secureStore.remove(id)
  },

  setDefault(id: string) {
    const all = readAll()
    all.forEach((c) => (c.isDefault = c.id === id))
    writeAll(all)
  },
}
