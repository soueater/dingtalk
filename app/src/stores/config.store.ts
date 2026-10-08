// src/stores/config.store.ts —— 模型配置集合（不含明文密钥）
import { create } from 'zustand'
import type { ConfigInput, ConfigPublic } from '@shared/design'
import { configService, getAdapter } from '@/services/config'

interface ConfigState {
  list: ConfigPublic[]
  encrypted: boolean
  loaded: boolean
  loading: boolean
  /** 当前活动配置 id（用户可在多配置间切换） */
  activeId: string | null

  load: () => Promise<void>
  save: (input: ConfigInput) => Promise<ConfigPublic>
  remove: (id: string) => Promise<void>
  setDefault: (id: string) => Promise<void>
  /** 当前应使用的配置：优先 activeId，其次默认项，最后第一项 */
  current: () => ConfigPublic | undefined
  byId: (id: string) => ConfigPublic | undefined
  setActive: (id: string) => void
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  list: [],
  encrypted: false,
  loaded: false,
  loading: false,
  activeId: null,

  load: async () => {
    if (!configService.isAvailable()) {
      set({ loaded: true, list: [], encrypted: false })
      return
    }
    set({ loading: true })
    try {
      const { list, encrypted } = await configService.list()
      set({ list, encrypted, loaded: true })
      const cur = get().activeId
      const stillValid = cur && list.some((c) => c.id === cur)
      if (!stillValid) {
        set({ activeId: (list.find((c) => c.isDefault) ?? list[0])?.id ?? null })
      }
    } catch {
      set({ loaded: true })
    } finally {
      set({ loading: false })
    }
  },

  save: async (input) => {
    const saved = await configService.save(input)
    await get().load()
    return saved
  },

  remove: async (id) => {
    await configService.remove(id)
    await get().load()
  },

  setDefault: async (id) => {
    await configService.setDefault(id)
    await get().load()
  },

  current: () => {
    const { list, activeId } = get()
    return list.find((c) => c.id === activeId) ?? list.find((c) => c.isDefault) ?? list[0]
  },

  byId: (id) => get().list.find((c) => c.id === id),

  setActive: (id) => set({ activeId: id }),
}))

/** 新建配置的初值 */
export function defaultConfigInput(adapter: ConfigInput['adapter'] = 'openai'): ConfigInput {
  const a = getAdapter(adapter)
  return {
    name: a.label,
    adapter,
    baseUrl: a.defaultBaseUrl,
    model: a.defaultModel,
    apiKey: '',
    temperature: 0.6,
    maxTokens: 8192,
    timeoutMs: 120000,
    stream: true,
    isDefault: false,
  }
}
