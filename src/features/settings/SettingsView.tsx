import type { ReactNode } from 'react'
import type { SettingsViewProps } from './types'
import { AccountSettings } from '../account/AccountSettings'
import { AppearanceSettings } from './AppearanceSettings'
import {
  GeneralSettings,
  ChatSettings,
  AboutSettings,
} from './PreferenceSettings'

function SettingsView({
  activeSection,
  appearanceMode,
  authUser,
  edgeRevealEnabled,
  fontScale,
  sendOnEnter,
  onAppearanceModeChange,
  onUploadAvatar,
  onChangeDisplayName,
  onEdgeRevealEnabledChange,
  onFontScaleChange,
  onOpenSecuritySettings,
  onSignIn,
  onSendOnEnterChange,
  onSignOut,
}: Omit<SettingsViewProps, 'onBack' | 'onSectionChange'>) {
  let content: ReactNode

  if (activeSection === 'account') {
    content = (
      <AccountSettings
        authUser={authUser}
        onUploadAvatar={onUploadAvatar}
        onChangeDisplayName={onChangeDisplayName}
        onOpenSecuritySettings={onOpenSecuritySettings}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
      />
    )
  } else if (activeSection === 'appearance') {
    content = (
      <AppearanceSettings
        appearanceMode={appearanceMode}
        fontScale={fontScale}
        onAppearanceModeChange={onAppearanceModeChange}
        onFontScaleChange={onFontScaleChange}
      />
    )
  } else if (activeSection === 'chat') {
    content = (
      <ChatSettings
        sendOnEnter={sendOnEnter}
        onSendOnEnterChange={onSendOnEnterChange}
      />
    )
  } else if (activeSection === 'about') {
    content = <AboutSettings />
  } else {
    content = (
      <GeneralSettings
        edgeRevealEnabled={edgeRevealEnabled}
        onEdgeRevealEnabledChange={onEdgeRevealEnabledChange}
      />
    )
  }

  return (
    <main className="settings-page">
      <section className="settings-content">{content}</section>
    </main>
  )
}

export default SettingsView
