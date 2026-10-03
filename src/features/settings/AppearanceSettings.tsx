import type { AppearanceMode, SettingsViewProps } from './types'
import {
  SettingsPanel,
  SettingsGroup,
  SettingsRow,
  SegmentedControl,
} from './SettingsPrimitives'

function AppearancePicker({
  onChange,
  value,
}: {
  onChange: (mode: AppearanceMode) => void
  value: AppearanceMode
}) {
  const options: Array<{ label: string; value: AppearanceMode }> = [
    { label: '系统', value: 'system' },
    { label: '浅色', value: 'light' },
    { label: '深色', value: 'dark' },
  ]

  return (
    <div
      className="settings-appearance-picker"
      role="group"
      aria-label="颜色模式"
    >
      {options.map((option) => (
        <button
          key={option.value}
          className="settings-appearance-option"
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          <AppearancePreview mode={option.value} />
          <span className="settings-appearance-label">{option.label}</span>
        </button>
      ))}
    </div>
  )
}

function PreviewWindow({
  className,
  theme,
}: {
  className?: string
  theme: 'light' | 'dark'
}) {
  return (
    <span
      className={`settings-preview-window is-${theme}${
        className ? ` ${className}` : ''
      }`}
    >
      <span className="settings-preview-sidebar" />
      <span className="settings-preview-message" />
      <span className="settings-preview-composer" />
    </span>
  )
}

function AppearancePreview({ mode }: { mode: AppearanceMode }) {
  return (
    <span
      className={`settings-appearance-preview is-${mode}`}
      aria-hidden="true"
    >
      {mode === 'system' ? (
        <>
          <PreviewWindow className="is-system-light" theme="light" />
          <PreviewWindow className="is-system-dark" theme="dark" />
        </>
      ) : (
        <PreviewWindow className="is-single" theme={mode} />
      )}
    </span>
  )
}

export function AppearanceSettings({
  appearanceMode,
  fontScale,
  onAppearanceModeChange,
  onFontScaleChange,
}: Pick<
  SettingsViewProps,
  | 'appearanceMode'
  | 'fontScale'
  | 'onAppearanceModeChange'
  | 'onFontScaleChange'
>) {
  return (
    <SettingsPanel title="外观">
      <SettingsGroup title="主题">
        <div className="settings-card">
          <SettingsRow title="颜色模式">
            <AppearancePicker
              value={appearanceMode}
              onChange={onAppearanceModeChange}
            />
          </SettingsRow>
        </div>
      </SettingsGroup>
      <SettingsGroup title="文字">
        <div className="settings-card">
          <SettingsRow
            title="界面字号"
            description="只调整排版大小，不改变侧边栏和按钮的固定几何。"
          >
            <SegmentedControl
              label="界面字号"
              value={fontScale}
              onChange={onFontScaleChange}
              options={[
                { label: '小', value: 'small' },
                { label: '标准', value: 'default' },
                { label: '大', value: 'large' },
              ]}
            />
          </SettingsRow>
        </div>
      </SettingsGroup>
    </SettingsPanel>
  )
}
