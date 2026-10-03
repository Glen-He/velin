export type AppMenuAction = 'new-conversation' | 'open-settings' | 'sign-out'

export const appMenuIpcChannels = {
  action: 'velin:app-menu:action',
} as const
