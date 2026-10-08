// src/services/project/quota.ts
// 界面配额（F-PM-05）的渲染层入口。
//
// 实现已上移到 `shared/quota.ts`（主进程的 MCP 工具也要校验配额），
// 此处只做转发，保持 `@/services/project/quota` 这一稳定引用路径。
export * from '@shared/quota'
