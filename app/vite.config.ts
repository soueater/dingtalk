import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // 相对路径，保证打包后以 file:// 协议加载资源正常
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist/renderer',
    // 清理交由 `prebuild:renderer`（scripts/clean-renderer.mjs）尽力而为地做：
    // vite 自己的 emptyOutDir 在被 safe-delete 守卫拦截时会**直接判构建失败**，
    // 而那时模块其实已经转译完了，纯属被清理步骤带崩。
    emptyOutDir: false,
    target: 'chrome130',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    port: 5273,
    strictPort: true,
  },
  // 主进程侧不使用 vite，此处仅为渲染层
  optimizeDeps: {
    include: ['react', 'react-dom', 'zustand'],
  },
})
