// electron/main/llm-proxy.ts
// 所有外网 LLM 请求在此发起：规避 CORS、隔离密钥、统一超时与错误码
import type { ChatMessage, ChatResponse, ChatRequest, ErrorCode, TestResult, AdapterId } from '../../shared/design'
import { configStore } from './config-store'
import { secureStore } from './secure-store'

interface CallOptions {
  adapter: AdapterId
  baseUrl: string
  model: string
  apiKey: string
  messages: ChatMessage[]
  temperature: number
  maxTokens: number
  timeoutMs: number
  jsonMode?: boolean
  stream?: boolean
  onDelta?: (delta: string) => void
}

export class LlmError extends Error {
  code: ErrorCode
  detail?: string
  constructor(code: ErrorCode, message: string, detail?: string) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/** 把 HTTP 状态与响应体映射到统一错误码 */
function mapHttpError(status: number, body: string): LlmError {
  let code: ErrorCode = 'E_UNKNOWN'
  let msg = `模型服务返回 ${status}`
  if (status === 401 || status === 403) {
    code = 'E_AUTH'
    msg = '密钥无效或无权访问该模型'
  } else if (status === 404) {
    code = 'E_MODEL'
    msg = '接口地址或模型名不存在'
  } else if (status === 429) {
    code = 'E_RATE_LIMIT'
    msg = '触发服务方限流'
  } else if (status >= 500) {
    code = 'E_NET'
    msg = '模型服务端异常'
  }
  // 尝试从 body 提取更有用的信息
  try {
    const j = JSON.parse(body)
    const m = j?.error?.message || j?.message
    if (m) msg += `：${m}`
  } catch {
    /* ignore */
  }
  return new LlmError(code, msg, body.slice(0, 800))
}

function withTimeout(ms: number, signal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), ms)
  const onAbort = () => ctrl.abort(signal?.reason)
  if (signal) signal.addEventListener('abort', onAbort, { once: true })
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    },
  }
}

/* ------------------------------ 各厂商适配 ------------------------------ */

async function callOpenAI(o: CallOptions, signal: AbortSignal): Promise<ChatResponse> {
  const url = `${normalizeBase(o.baseUrl)}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${o.apiKey}`,
    },
    body: JSON.stringify({
      model: o.model,
      messages: o.messages,
      temperature: o.temperature,
      max_tokens: o.maxTokens,
      stream: false,
      ...(o.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal,
  })
  const text = await res.text()
  if (!res.ok) throw mapHttpError(res.status, text)
  const json = JSON.parse(text)
  return {
    content: json?.choices?.[0]?.message?.content ?? '',
    model: json?.model ?? o.model,
    ms: 0,
    usage: json?.usage
      ? {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
        }
      : undefined,
  }
}

async function callAnthropic(o: CallOptions, signal: AbortSignal): Promise<ChatResponse> {
  const url = `${normalizeBase(o.baseUrl)}/messages`
  const system = o.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const rest = o.messages.filter((m) => m.role !== 'system')
  // jsonMode 用预填充诱导
  const msgs = o.jsonMode ? [...rest, { role: 'assistant', content: '{' }] : rest
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': o.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: o.model,
      max_tokens: o.maxTokens,
      temperature: o.temperature,
      system: system || undefined,
      messages: msgs,
    }),
    signal,
  })
  const text = await res.text()
  if (!res.ok) throw mapHttpError(res.status, text)
  const json = JSON.parse(text)
  let content = (json?.content ?? []).map((c: { text?: string }) => c.text ?? '').join('')
  if (o.jsonMode && content && !content.trimStart().startsWith('{')) content = '{' + content
  return {
    content,
    model: json?.model ?? o.model,
    ms: 0,
    usage: json?.usage
      ? {
          promptTokens: json.usage.input_tokens,
          completionTokens: json.usage.output_tokens,
          totalTokens: (json.usage.input_tokens ?? 0) + (json.usage.output_tokens ?? 0),
        }
      : undefined,
  }
}

async function callGemini(o: CallOptions, signal: AbortSignal): Promise<ChatResponse> {
  const base = normalizeBase(o.baseUrl)
  const url = `${base}/models/${o.model}:generateContent?key=${encodeURIComponent(o.apiKey)}`
  const systemText = o.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const contents = o.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
      contents,
      generationConfig: {
        temperature: o.temperature,
        maxOutputTokens: o.maxTokens,
        ...(o.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    }),
    signal,
  })
  const text = await res.text()
  if (!res.ok) throw mapHttpError(res.status, text)
  const json = JSON.parse(text)
  const content = (json?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('')
  return { content, model: o.model, ms: 0 }
}

async function callOllama(o: CallOptions, signal: AbortSignal): Promise<ChatResponse> {
  const url = `${normalizeBase(o.baseUrl)}/api/chat`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: o.model,
      messages: o.messages,
      stream: false,
      ...(o.jsonMode ? { format: 'json' } : {}),
      options: { temperature: o.temperature, num_predict: o.maxTokens },
    }),
    signal,
  })
  const text = await res.text()
  if (!res.ok) throw mapHttpError(res.status, text)
  const json = JSON.parse(text)
  return { content: json?.message?.content ?? '', model: json?.model ?? o.model, ms: 0 }
}

/* ------------------------------ 流式解析工具 ------------------------------ */

/** 按 SSE 逐行解析（OpenAI 兼容） */
async function streamOpenAI(
  o: CallOptions,
  signal: AbortSignal,
  onDelta: (d: string) => void,
): Promise<{ content: string; model: string }> {
  const url = `${normalizeBase(o.baseUrl)}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.apiKey}` },
    body: JSON.stringify({
      model: o.model,
      messages: o.messages,
      temperature: o.temperature,
      max_tokens: o.maxTokens,
      stream: true,
      ...(o.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal,
  })
  if (!res.ok) throw mapHttpError(res.status, await res.text())
  const reader = res.body?.getReader()
  if (!reader) throw new LlmError('E_NET', '响应无数据流')
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let model = o.model
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const j = JSON.parse(payload)
        if (j.model) model = j.model
        const d: string = j?.choices?.[0]?.delta?.content ?? ''
        if (d) {
          content += d
          onDelta(d)
        }
      } catch {
        /* 忽略半包 */
      }
    }
  }
  return { content, model }
}

/* -------------------------------- 对外接口 -------------------------------- */

async function dispatch(o: CallOptions, signal: AbortSignal): Promise<ChatResponse> {
  switch (o.adapter) {
    case 'openai':
      return callOpenAI(o, signal)
    case 'anthropic':
      return callAnthropic(o, signal)
    case 'gemini':
      return callGemini(o, signal)
    case 'ollama':
      return callOllama(o, signal)
    default:
      return callOpenAI(o, signal)
  }
}

export const llmProxy = {
  /** 非流式调用 */
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const cfg = configStore.raw(req.configId)
    if (!cfg) throw new LlmError('E_AUTH', '配置不存在，请重新配置模型')
    const apiKey = secureStore.get(cfg.id) ?? ''
    if (cfg.adapter !== 'ollama' && !apiKey) {
      throw new LlmError('E_AUTH', '尚未填写 API 密钥')
    }
    const { signal, cleanup } = withTimeout(req.timeoutMs ?? cfg.timeoutMs)
    const start = Date.now()
    try {
      const r = await dispatch(
        {
          adapter: cfg.adapter,
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          apiKey,
          messages: req.messages,
          temperature: req.temperature ?? cfg.temperature,
          maxTokens: req.maxTokens ?? cfg.maxTokens,
          timeoutMs: req.timeoutMs ?? cfg.timeoutMs,
          jsonMode: req.jsonMode,
        },
        signal,
      )
      return { ...r, ms: Date.now() - start }
    } catch (e) {
      throw toLlmError(e)
    } finally {
      cleanup()
    }
  },

  /** 流式调用（OpenAI 兼容优先；其他适配器回退为非流式一次性返回） */
  async chatStream(
    req: ChatRequest,
    signal: AbortSignal,
    onDelta: (d: string) => void,
  ): Promise<ChatResponse> {
    const cfg = configStore.raw(req.configId)
    if (!cfg) throw new LlmError('E_AUTH', '配置不存在，请重新配置模型')
    const apiKey = secureStore.get(cfg.id) ?? ''
    const { signal: tSignal, cleanup } = withTimeout(req.timeoutMs ?? cfg.timeoutMs, signal)
    const start = Date.now()
    try {
      if (cfg.adapter === 'openai') {
        const r = await streamOpenAI(
          {
            adapter: cfg.adapter,
            baseUrl: cfg.baseUrl,
            model: cfg.model,
            apiKey,
            messages: req.messages,
            temperature: req.temperature ?? cfg.temperature,
            maxTokens: req.maxTokens ?? cfg.maxTokens,
            timeoutMs: req.timeoutMs ?? cfg.timeoutMs,
            jsonMode: req.jsonMode,
          },
          tSignal,
          onDelta,
        )
        return { content: r.content, model: r.model, ms: Date.now() - start }
      }
      // 其他适配器：非流式，一次性吐出
      const r = await dispatch(
        {
          adapter: cfg.adapter,
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          apiKey,
          messages: req.messages,
          temperature: req.temperature ?? cfg.temperature,
          maxTokens: req.maxTokens ?? cfg.maxTokens,
          timeoutMs: req.timeoutMs ?? cfg.timeoutMs,
          jsonMode: req.jsonMode,
        },
        tSignal,
      )
      onDelta(r.content)
      return { ...r, ms: Date.now() - start }
    } catch (e) {
      throw toLlmError(e)
    } finally {
      cleanup()
    }
  },

  /** 连通性测试（不依赖已保存配置） */
  async test(input: {
    adapter: AdapterId
    baseUrl: string
    model: string
    apiKey?: string
    configId?: string
    timeoutMs?: number
  }): Promise<TestResult> {
    // 密钥来源：优先本次输入明文；否则取已存配置的密钥
    let apiKey = input.apiKey?.trim() ?? ''
    if (input.configId) {
      const exist = secureStore.get(input.configId)
      if (exist) apiKey = apiKey || exist
    }
    if (input.adapter !== 'ollama' && !apiKey) {
      return { ok: false, message: '未填写 API 密钥', errorCode: 'E_AUTH' }
    }
    const { signal, cleanup } = withTimeout(input.timeoutMs ?? 30000)
    const start = Date.now()
    try {
      const r = await dispatch(
        {
          adapter: input.adapter,
          baseUrl: input.baseUrl,
          model: input.model,
          apiKey,
          messages: [{ role: 'user', content: 'ping' }],
          temperature: 0,
          maxTokens: 8,
          timeoutMs: input.timeoutMs ?? 30000,
        },
        signal,
      )
      const latency = Date.now() - start
      return {
        ok: true,
        message: `连接成功（模型：${r.model}，延迟 ${latency}ms）`,
        latencyMs: latency,
        modelEcho: r.model,
      }
    } catch (e) {
      const le = toLlmError(e)
      return { ok: false, message: le.message, errorCode: le.code }
    } finally {
      cleanup()
    }
  },
}

function toLlmError(e: unknown): LlmError {
  if (e instanceof LlmError) return e
  const err = e as Error & { name?: string; cause?: unknown }
  if (err?.name === 'AbortError') return new LlmError('E_ABORTED', '请求已取消')
  const msg = String(err?.message ?? e)
  if (/timeout|timed out|aborted due to timeout/i.test(msg)) return new LlmError('E_TIMEOUT', '请求超时')
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network|getaddrinfo/i.test(msg)) {
    return new LlmError('E_NET', '无法连接到模型服务，请检查网络与服务地址', msg)
  }
  return new LlmError('E_UNKNOWN', msg)
}
