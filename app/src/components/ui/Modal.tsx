// src/components/ui/Modal.tsx
import { useEffect, type ReactNode } from 'react'
import { IconClose } from './Icons'
import { Button } from './Button'

interface Props {
  open: boolean
  title: string
  subtitle?: string
  width?: number | string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** 是否显示右上角关闭按钮 */
  closable?: boolean
}

export function Modal({
  open,
  title,
  subtitle,
  width = 560,
  onClose,
  children,
  footer,
  closable = true,
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closable) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closable, onClose])

  if (!open) return null

  return (
    <div className="mask" onMouseDown={(e) => e.target === e.currentTarget && closable && onClose()}>
      <div
        className="modal"
        style={{ width: typeof width === 'number' ? `${width}px` : width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <div>
            <div className="title">{title}</div>
            {subtitle && <div className="subtitle">{subtitle}</div>}
          </div>
          <div className="flex-1" />
          {closable && (
            <Button variant="ghost" size="sm" iconOnly onClick={onClose} aria-label="关闭">
              <IconClose size={14} />
            </Button>
          )}
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
