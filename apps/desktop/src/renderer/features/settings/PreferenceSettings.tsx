import type { SettingsViewProps } from './types'
import {
  SettingsPanel,
  SettingsGroup,
  SettingsRow,
  Toggle,
} from './SettingsPrimitives'

export function GeneralSettings({
  edgeRevealEnabled,
  onEdgeRevealEnabledChange,
}: Pick<SettingsViewProps, 'edgeRevealEnabled' | 'onEdgeRevealEnabledChange'>) {
  return (
    <SettingsPanel title="通用">
      <SettingsGroup title="侧边栏">
        <div className="panel-card">
          <SettingsRow
            title="边缘唤出侧边栏"
            description="侧边栏隐藏时，将指针移到窗口最左侧临时显示。"
          >
            <Toggle
              checked={edgeRevealEnabled}
              label="边缘唤出侧边栏"
              onChange={onEdgeRevealEnabledChange}
            />
          </SettingsRow>
        </div>
      </SettingsGroup>
    </SettingsPanel>
  )
}

export function ChatSettings({
  onSendOnEnterChange,
  sendOnEnter,
}: Pick<SettingsViewProps, 'onSendOnEnterChange' | 'sendOnEnter'>) {
  return (
    <SettingsPanel title="对话">
      <SettingsGroup title="输入">
        <div className="panel-card">
          <SettingsRow
            title="Enter 发送消息"
            description={
              sendOnEnter
                ? 'Shift + Enter 换行。'
                : '使用 Command + Enter 发送。'
            }
          >
            <Toggle
              checked={sendOnEnter}
              label="Enter 发送消息"
              onChange={onSendOnEnterChange}
            />
          </SettingsRow>
        </div>
      </SettingsGroup>
    </SettingsPanel>
  )
}

export function AboutSettings() {
  return (
    <SettingsPanel title="关于">
      <SettingsGroup title="版本信息">
        <div className="panel-card">
          <SettingsRow title="Velin" description="版本 0.1.0" />
        </div>
      </SettingsGroup>
    </SettingsPanel>
  )
}
