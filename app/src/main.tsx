import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useThemeStore } from './stores/theme.store'

const el = document.getElementById('root')
if (!el) throw new Error('找不到 #root 挂载点')

/* 在首次渲染前恢复主题，避免深/浅色闪烁 */
useThemeStore.getState().init()

createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
