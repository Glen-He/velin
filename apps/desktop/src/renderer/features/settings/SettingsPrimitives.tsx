import type { ReactNode } from 'react'
import { PanelGroup, PanelRow } from '@velin/ui/Panel.tsx'

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
  layout = 'compact',
}: {
  children?: ReactNode
  description?: string
  title: string
  layout?: 'compact' | 'rich'
}) {
  return (
    <PanelRow
      title={title}
      description={description}
      className={`settings-row${layout === 'rich' ? ' is-rich' : ''}`}
    >
      {children}
    </PanelRow>
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
    <PanelGroup title={title} className="settings-group">
      {children}
    </PanelGroup>
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
      <div className="settings-panel-content">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  )
}
