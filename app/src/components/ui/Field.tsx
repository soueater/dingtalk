// src/components/ui/Field.tsx —— 表单行封装
import type { ReactNode } from 'react'

interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  /** 标签右侧插槽，如「测试连接」按钮 */
  extra?: ReactNode
  children: ReactNode
}

export function Field({ label, hint, error, required, extra, children }: FieldProps) {
  return (
    <div className="field">
      {(label || extra) && (
        <div className="field-label">
          <span>
            {label}
            {required && <span className="req"> *</span>}
          </span>
          <span className="flex-1" />
          {extra}
        </div>
      )}
      {children}
      {error ? <div className="field-error">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  )
}

export function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="switch"
      data-on={on}
      disabled={disabled}
      aria-pressed={on}
      onClick={() => onChange(!on)}
    />
  )
}

export function CheckRow({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}
