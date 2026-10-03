import type {
  ChatEvent,
  SendMessageRequest,
  StopMessageRequest,
} from './chat-protocol.js'
import type { AppMenuAction } from './app-menu-protocol.js'
import type {
  AuthError,
  AuthFlow,
  AuthIntent,
  AuthState,
  DesktopSession,
} from './auth-protocol.js'

export type ChatEventListener = (event: ChatEvent) => void
export type FullScreenStateListener = (isFullScreen: boolean) => void
export type AppMenuActionListener = (action: AppMenuAction) => void
export type AuthStateListener = (state: AuthState) => void
export type AuthErrorListener = (error: AuthError) => void

export type VelinApi = {
  auth: {
    getState: () => Promise<AuthState>
    requestSignIn: (intent?: AuthIntent, flow?: AuthFlow) => Promise<AuthFlow>
    authenticateCode: (code: string) => Promise<void>
    signOut: () => Promise<void>
    openSecuritySettings: () => Promise<void>
    updateDisplayName: (name: string) => Promise<void>
    uploadAvatar: (image: Uint8Array) => Promise<void>
    fetchAvatarImage: (imageUrl: string) => Promise<Uint8Array<ArrayBuffer>>
    listSessions: () => Promise<DesktopSession[]>
    revokeSession: (sessionId: string) => Promise<void>
    revokeOtherSessions: () => Promise<void>
    subscribe: (listener: AuthStateListener) => () => void
    subscribeErrors: (listener: AuthErrorListener) => () => void
  }
  chat: {
    send: (request: SendMessageRequest) => void
    stop: (request: StopMessageRequest) => void
    openExternalLink: (url: string) => Promise<void>
    subscribe: (listener: ChatEventListener) => () => void
  }
  menu: {
    subscribe: (listener: AppMenuActionListener) => () => void
  }
  window: {
    getFullScreenState: () => Promise<boolean>
    subscribeFullScreenState: (listener: FullScreenStateListener) => () => void
  }
}
