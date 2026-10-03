import type { AuthUser } from '@velin/contracts/auth-protocol'

export type SettingsSection =
  | 'account'
  | 'general'
  | 'appearance'
  | 'chat'
  | 'about'
export type AppearanceMode = 'system' | 'light' | 'dark'
export type InterfaceFontScale = 'small' | 'default' | 'large'

export type SettingsViewProps = {
  activeSection: SettingsSection
  authUser: AuthUser | null
  appearanceMode: AppearanceMode
  edgeRevealEnabled: boolean
  fontScale: InterfaceFontScale
  sendOnEnter: boolean
  onAppearanceModeChange: (mode: AppearanceMode) => void
  onUploadAvatar: (image: Uint8Array) => Promise<void>
  onChangeDisplayName: (name: string) => Promise<void>
  onOpenSecuritySettings: () => void
  onSignIn: () => void
  onBack: () => void
  onEdgeRevealEnabledChange: (enabled: boolean) => void
  onFontScaleChange: (scale: InterfaceFontScale) => void
  onSectionChange: (section: SettingsSection) => void
  onSendOnEnterChange: (enabled: boolean) => void
  onSignOut: () => void
}
