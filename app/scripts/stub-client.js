// scripts/stub-client.js
// 测试替身：默认抛错（纯逻辑测试不应真的调用模型）。
// test-defects.mjs 通过 __queue / __calls / __reset 注入可控输出。

/** 预设的模型返回队列；为空时保持「抛错」的默认行为 */
let queue = []
/** 记录每次调用的入参，供断言检查 messages / opts */
let calls = []

export async function chatOnce(configId, messages, opts) {
  calls.push({ configId, messages, opts })
  if (!queue.length) {
    throw new Error('STUB: 纯逻辑测试不调用模型')
  }
  const next = queue.shift()
  if (next instanceof Error) throw next
  // 允许注入 { content } 或裸字符串
  if (next && typeof next === 'object' && 'content' in next) return next
  return { content: String(next) }
}

/** 注入一批按顺序消费的返回值 */
export function __queue(items) {
  queue = [...items]
  calls = []
}

/** 查看已记录的调用 */
export function __calls() {
  return calls
}

/** 清空状态 */
export function __reset() {
  queue = []
  calls = []
}
