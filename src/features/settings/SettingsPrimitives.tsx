import type { ReactNode } from 'react'

export function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      className="settings-switch"
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-switch-thumb" />
    </button>
  )
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Array<{ label: string; value: T }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="settings-segmented-control" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          className="settings-segmented-option"
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function SettingsRow({
  children,
  description,
  title,
}: {
  children?: ReactNode
  description?: string
  title: string
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
        {description ? (
          <div className="settings-row-description">{description}</div>
        ) : null}
      </div>
      {children ? <div className="settings-row-control">{children}</div> : null}
    </div>
  )
}

export function SettingsGroup({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <section className="settings-group">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export function SettingsPanel({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <div className="settings-panel">
      <h1>{title}</h1>
      {children}
    </div>
  )
}
