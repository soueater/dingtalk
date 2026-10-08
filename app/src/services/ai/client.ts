// src/services/ai/client.ts
// 渲染层 → 主进程 LLM 代理的薄封装（含流式）
import type { ChatMessage, ChatResponse } from '@shared/design'
import { ApiError } from '@/services/config'

const available = () => typeof window !== 'undefined' && !!window.dsa?.llm

/** 一次性对话 */
export async function chatOnce(
  configId: string,
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean; timeoutMs?: number } = {},
): Promise<ChatResponse> {
  if (!available()) throw new ApiError('E_NET', '当前环境不支持模型调用')
  const r = await window.dsa.llm.chat({
    configId,
    messages,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    jsonMode: opts.jsonMode,
    timeoutMs: opts.timeoutMs,
  })
  if (r.ok) return r.data
  throw new ApiError(r.code, r.message, r.detail)
}

export interface StreamHandlers {
  onDelta?: (text: string) => void
  signal?: { aborted: boolean }
}

/** 流式对话：返回完整文本 */
export async function chatStream(
  configId: string,
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean; timeoutMs?: number } & StreamHandlers = {},
): Promise<ChatResponse> {
  if (!available()) throw new ApiError('E_NET', '当前环境不支持模型调用')

  const token = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  let buf = ''
  let resolveDone: (v: ChatResponse) => void
  let rejectDone: (e: unknown) => void
  const done = new Promise<ChatResponse>((res, rej) => {
    resolveDone = res
    rejectDone = rej
  })

  const offChunk = window.dsa.llm.onChunk((e) => {
    if (e.token !== token) return
    buf += e.delta
    opts.onDelta?.(buf)
  })
  const offDone = window.dsa.llm.onDone((e) => {
    if (e.token !== token) return
    cleanup()
    resolveDone({ content: e.content || buf, model: '', ms: e.ms, usage: e.usage })
  })
  const offErr = window.dsa.llm.onError((e) => {
    if (e.token !== token) return
    cleanup()
    rejectDone(new ApiError(e.code, e.message))
  })

  const cleanup = () => {
    offChunk()
    offDone()
    offErr()
  }

  try {
    const r = await window.dsa.llm.chatStream(
      {
        configId,
        messages,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        jsonMode: opts.jsonMode,
        timeoutMs: opts.timeoutMs,
      },
      token,
    )
    if (!r.ok && r.code !== 'E_ABORTED') {
      cleanup()
      throw new ApiError(r.code, r.message, r.detail)
    }
  } catch (e) {
    cleanup()
    throw e
  }

  return done
}
