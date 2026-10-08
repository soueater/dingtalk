// src/components/overlays/ToastHost.tsx
import { useUiStore } from '@/stores/ui.store'

export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts)
  if (!toasts.length) return null
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role="status">
          <span className="ico" />
          <span className="msg">{t.message}</span>
        </div>
      ))}
    </div>
  )
}
