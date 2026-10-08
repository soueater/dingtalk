// scripts/optimize-test-entry.mjs
// 测试专用入口：把 optimize 的公共 API 与可控 client 替身放进**同一个 bundle**，
// 保证断言里拿到的 __queue/__calls 与 optimizePage 内部实际调用的 stub 是同一模块实例。
export * from '../src/services/ai/optimize.ts'
export { __queue, __calls, __reset } from './stub-client.js'
