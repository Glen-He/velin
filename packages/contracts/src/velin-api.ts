import type {
  ChatAttachmentCancelRequest,
  ChatAttachmentDeleteRequest,
  ChatAttachmentPickRequest,
  ChatAttachmentPickResult,
  ChatAttachmentReprocessRequest,
  ChatAttachmentStatusRequest,
  ChatAttachmentUploadRequest,
  ChatEvent,
  ChatPendingAttachmentsRequest,
  ChatHistoryDeleteRequest,
  ChatHistoryLoadRequest,
  ChatOrderRequest,
  ChatListRequest,
  ChatRenameRequest,
  SendMessageRequest,
  StopMessageRequest,
} from './chat-protocol.js'
import type {
  ConversationHistoryPage,
  ConversationListPage,
  MessageAttachment,
} from './chat.js'
import type { AppMenuAction } from './app-menu-protocol.js'
import type {
  MemoryAction,
  MemoryState,
  ConversationVersion,
  ConversationVersionRequest,
} from './memory.js'
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
  memory: {
    read: () => Promise<MemoryState>
    update: (action: MemoryAction) => Promise<MemoryState>
    versions: (
      input: ConversationVersionRequest,
    ) => Promise<ConversationVersion[]>
    restoreVersion: (input: ConversationVersionRequest) => Promise<void>
  }
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
    listConversations: (
      request?: ChatListRequest,
    ) => Promise<ConversationListPage>
    loadConversation: (
      request: ChatHistoryLoadRequest,
    ) => Promise<ConversationHistoryPage>
    deleteConversation: (request: ChatHistoryDeleteRequest) => Promise<void>
    renameConversation: (request: ChatRenameRequest) => Promise<string>
    reorderConversations: (request: ChatOrderRequest) => Promise<void>
    pickAttachments: (
      request: ChatAttachmentPickRequest,
    ) => Promise<ChatAttachmentPickResult>
    listPendingAttachments: (
      request: ChatPendingAttachmentsRequest,
    ) => Promise<MessageAttachment[]>
    uploadAttachment: (
      request: ChatAttachmentUploadRequest,
    ) => Promise<MessageAttachment>
    reprocessAttachment: (
      request: ChatAttachmentReprocessRequest,
    ) => Promise<MessageAttachment>
    getAttachmentStatus: (
      request: ChatAttachmentStatusRequest,
    ) => Promise<MessageAttachment>
    cancelAttachmentProcessing: (
      request: ChatAttachmentCancelRequest,
    ) => Promise<void>
    deleteAttachment: (request: ChatAttachmentDeleteRequest) => Promise<void>
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
