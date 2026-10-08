// src/services/config/index.ts
// 渲染层配置服务 + 四家厂商接入预设（用户可在此基础上自行扩展任意 OpenAI 兼容服务）
import type { ConfigInput, ConfigPublic, TestResult } from '@shared/design'

/** preload 是否可用（纯浏览器调试时不可用） */
const available = () => typeof window !== 'undefined' && !!window.dsa?.config

export class ApiError extends Error {
  code: string
  detail?: string
  constructor(code: string, message: string, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.detail = detail
  }
}

function unwrap<T>(
  r: { ok: true; data: T } | { ok: false; code: string; message: string; detail?: string },
): T {
  if (r.ok) return r.data
  throw new ApiError(r.code, r.message, r.detail)
}

export const configService = {
  isAvailable: available,

  async list(): Promise<{ list: ConfigPublic[]; encrypted: boolean }> {
    if (!available()) return { list: [], encrypted: false }
    return unwrap(await window.dsa.config.get())
  },

  async save(input: ConfigInput): Promise<ConfigPublic> {
    return unwrap(await window.dsa.config.save(input))
  },

  async remove(id: string): Promise<boolean> {
    return unwrap(await window.dsa.config.remove(id))
  },

  async setDefault(id: string): Promise<boolean> {
    return unwrap(await window.dsa.config.setDefault(id))
  },

  async test(input: ConfigInput): Promise<TestResult> {
    return unwrap(await window.dsa.config.test(input))
  },
}

/* ------------------------------ 厂商预设 ------------------------------ */

export interface AdapterMeta {
  id: ConfigInput['adapter']
  label: string
  defaultBaseUrl: string
  defaultModel: string
  keyPlaceholder: string
  keyRequired: boolean
  docsUrl: string
  /** 密钥获取页 */
  keyUrl: string
  note: string
  models: string[]
  /** 分步引导 */
  guide: string[]
  /** 注意事项 */
  notes: string[]
}

export const ADAPTERS: AdapterMeta[] = [
  {
    id: 'openai',
    label: 'OpenAI 兼容',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    keyPlaceholder: 'sk-...',
    keyRequired: true,
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    keyUrl: 'https://platform.openai.com/api-keys',
    note: '适配绝大多数兼容 /v1/chat/completions 的服务：DeepSeek、Moonshot、通义千问、智谱、硅基流动、本地 vLLM / One-API 等',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3-mini'],
    guide: [
      '在服务商控制台创建 API Key（通常以 sk- 开头）',
      '确认接口地址：官方为 https://api.openai.com/v1；第三方服务需替换为对应地址',
      '填写要使用的模型名称',
      '点击「测试连接」验证可用性',
    ],
    notes: [
      '使用第三方兼容服务时，务必把接口地址改成对方提供的地址，例如 DeepSeek 为 https://api.deepseek.com/v1',
      '密钥仅加密保存在本机，不会上传到任何服务器',
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    keyPlaceholder: 'sk-ant-...',
    keyRequired: true,
    docsUrl: 'https://docs.anthropic.com/en/api/messages',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    note: '使用 /v1/messages 接口，请求头需携带 anthropic-version',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5', 'claude-3-5-sonnet-latest'],
    guide: [
      '登录 Anthropic Console，进入 Settings → API Keys',
      '点击「Create Key」创建并复制密钥（以 sk-ant- 开头）',
      '接口地址保持 https://api.anthropic.com 即可，无需追加 /v1',
      '填写模型名称，点击「测试连接」验证',
    ],
    notes: ['Claude 对长结构化输出表现稳定，适合生成复杂页面', '需携带 anthropic-version 头，应用已自动处理'],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    keyPlaceholder: 'AIza...',
    keyRequired: true,
    docsUrl: 'https://ai.google.dev/api/generate-content',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    note: '使用 generateContent 接口，密钥以 URL 参数传递',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    guide: [
      '打开 Google AI Studio，点击「Get API key」创建密钥',
      '复制以 AIza 开头的密钥并粘贴',
      '选择模型名称（推荐 gemini-2.5-flash，速度快）',
      '点击「测试连接」验证',
    ],
    notes: ['接口地址已包含 /v1beta，请勿重复添加', '部分地区网络可能无法直连'],
  },
  {
    id: 'ollama',
    label: 'Ollama（本地）',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    defaultModel: 'qwen2.5:14b',
    keyPlaceholder: '本地模型无需密钥',
    keyRequired: false,
    docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
    keyUrl: 'https://ollama.com/download',
    note: '完全本地推理，数据不出机器。需先启动 ollama serve 并拉取模型',
    models: ['qwen2.5:14b', 'qwen2.5-coder:14b', 'llama3.1:8b', 'deepseek-coder-v2'],
    guide: [
      '前往 ollama.com 下载并安装 Ollama',
      '终端执行 ollama pull qwen2.5:14b 拉取模型',
      '确认服务已启动（默认端口 11434）',
      '模型名填写你已拉取的名称，密钥留空，点击「测试连接」',
    ],
    notes: [
      '建议 14B 以上模型才有稳定的结构化输出能力',
      '首次调用需加载模型，可能等待较久（属正常现象）',
    ],
  },
]

export function getAdapter(id: string): AdapterMeta {
  return ADAPTERS.find((a) => a.id === id) ?? ADAPTERS[0]
}

/** 常见 OpenAI 兼容端点，一键填入 */
export const BASE_URL_PRESETS: Array<{ label: string; url: string; hint: string }> = [
  { label: 'OpenAI', url: 'https://api.openai.com/v1', hint: '官方' },
  { label: 'DeepSeek', url: 'https://api.deepseek.com/v1', hint: 'deepseek-chat / deepseek-reasoner' },
  { label: 'Moonshot', url: 'https://api.moonshot.cn/v1', hint: 'kimi-k2 系列' },
  { label: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', hint: 'qwen-max / qwen-plus' },
  { label: '智谱 GLM', url: 'https://open.bigmodel.cn/api/paas/v4', hint: 'glm-4-plus' },
  { label: '硅基流动', url: 'https://api.siliconflow.cn/v1', hint: '聚合多家开源模型' },
  { label: '本地 Ollama', url: 'http://127.0.0.1:11434/v1', hint: 'Ollama 的 OpenAI 兼容层' },
]

/** 参数预设：不同任务的推荐温度（对应 docs/S2-5 温度分层表） */
export const TEMPERATURE_PRESETS = [
  { key: 'enhance', label: '提示词增强', value: 0.25, desc: '低温度，保证准确复述用户意图' },
  { key: 'plan', label: '信息架构规划', value: 0.4, desc: '结构化规划，稳定优先' },
  { key: 'tokens', label: '设计定稿', value: 0.3, desc: '规范化输出' },
  { key: 'generate', label: '页面生成', value: 0.6, desc: '默认档，兼顾创造性与稳定性' },
  { key: 'edit', label: '对话式编辑', value: 0.2, desc: '精确改稿，避免误改其他内容' },
  { key: 'variant', label: '生成变体', value: 0.85, desc: '高温度，产出差异化方案' },
  { key: 'repair', label: '格式修复', value: 0.1, desc: '只修格式不改语义' },
] as const
