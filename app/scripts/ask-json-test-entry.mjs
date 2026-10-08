// scripts/ask-json-test-entry.mjs
// 测试专用入口：把 ask-json 的公共 API 与可控 client 替身放在**同一个 bundle** 里导出，
// 保证断言里拿到的 __calls 与 ask-json 内部实际调用的 stub 是同一模块实例。
export * from '../src/services/ai/ask-json.ts'
export { __queue, __calls, __reset } from './stub-client.js'
