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
  token: string
  isCurrent: boolean
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  updatedAt: string
  expiresAt: string
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
  internalAuthenticated: 'velin-auth-internal:authenticated',
  internalError: 'velin-auth-internal:error',
} as const
