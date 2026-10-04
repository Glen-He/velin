import type { SessionClientMetadata } from './session-client.js'

export type AuthUser = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  twoFactorEnabled: boolean
}

export type AuthState = {
  user: AuthUser | null
  reason?: 'session-expired'
}

export type DesktopSession = {
  id: string
  isCurrent: boolean
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  updatedAt: string
  expiresAt: string
  // 本机自己报的身份，只用于展示；缺失时识别退回 UA，且永不参与授权。
  clientMetadata?: SessionClientMetadata | null
}

export type AuthError = {
  message: string
}

export type AuthIntent = 'sign-in' | 'sign-up'
export type AuthFlow = 'browser' | 'manual-code'

export const authIpcChannels = {
  getState: 'auth:get-state',
  requestSignIn: 'auth:request-sign-in',
  authenticateCode: 'auth:authenticate-code',
  signOut: 'auth:sign-out',
  openSecuritySettings: 'auth:open-security-settings',
  updateDisplayName: 'auth:update-display-name',
  uploadAvatar: 'auth:upload-avatar',
  fetchAvatarImage: 'auth:fetch-avatar-image',
  listSessions: 'auth:list-sessions',
  revokeSession: 'auth:revoke-session',
  revokeOtherSessions: 'auth:revoke-other-sessions',
  stateChanged: 'auth:state-changed',
  internalError: 'velin-auth-internal:error',
} as const
