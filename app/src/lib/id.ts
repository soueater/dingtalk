// src/lib/id.ts
// 渲染层短 id 生成 —— 实现已上移到 shared/ids.ts，此处仅做转发。
// 这样做的动因：主进程（复制项目时重排界面/节点 id）也需要同一套算法，
// 而主进程只能使用相对路径导入，无法走 `@/` 别名。
export { uid, slugId, uniqueId } from '@shared/ids'
