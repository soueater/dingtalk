// scripts/autofill-test-entry.mjs
// 测试专用入口：把渲染层的 states 输出与 autofill 服务层放进同一个 bundle，
// 保证断言拿到的 normalizeFlows 与 autofill 内部使用的是同一模块实例。
export * from '../src/services/ai/autofill.ts'
export * from '../src/services/render/node.ts'
export * from '../src/services/render/tokens.ts'
export { normalizeFlows, repairPagePayload } from '../src/services/ai/parse.ts'
