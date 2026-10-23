import { invoke } from './invoke'
import {
  memoryIpcChannels,
  type MemoryAction,
  type ConversationVersionRequest,
} from '@velin/contracts/memory'
import { contextBridge, ipcRenderer } from 'electron'
import {
  appMenuIpcChannels,
  type AppMenuAction,
} from '@velin/contracts/app-menu-protocol'
import {
  chatIpcChannels,
  type ChatAttachmentCancelRequest,
  type ChatAttachmentDeleteRequest,
  type ChatAttachmentPickRequest,
  type ChatAttachmentReprocessRequest,
  type ChatAttachmentStatusRequest,
  type ChatAttachmentUploadRequest,
  type ChatEvent,
  type ChatHistoryDeleteRequest,
  type ChatHistoryLoadRequest,
  type ChatOrderRequest,
  type ChatListRequest,
  type ChatPendingAttachmentsRequest,
  type ChatRenameRequest,
  type SendMessageRequest,
  type StopMessageRequest,
} from '@velin/contracts/chat-protocol'
import type {
  AppMenuActionListener,
  ChatEventListener,
  FullScreenStateListener,
  VelinApi,
} from '@velin/contracts/velin-api'
import { windowIpcChannels } from '@velin/contracts/window-protocol'
import {
  authIpcChannels,
  type AuthError,
  type AuthFlow,
  type AuthIntent,
  type AuthState,
} from '@velin/contracts/auth-protocol'
import type {
  AuthErrorListener,
  AuthStateListener,
} from '@velin/contracts/velin-api'

const velinApi: VelinApi = {
  memory: {
    read: () => invoke(memoryIpcChannels.read),
    update: (action: MemoryAction) => invoke(memoryIpcChannels.update, action),
    versions: (input: ConversationVersionRequest) =>
      invoke(memoryIpcChannels.versions, input),
    restoreVersion: (input: ConversationVersionRequest) =>
      invoke(memoryIpcChannels.restoreVersion, input),
  },
  auth: {
    getState() {
      return invoke(authIpcChannels.getState)
    },
    requestSignIn(intent: AuthIntent = 'sign-in', flow: AuthFlow = 'browser') {
      return invoke(authIpcChannels.requestSignIn, intent, flow)
    },
    authenticateCode(code: string) {
      return invoke(authIpcChannels.authenticateCode, code)
    },
    signOut() {
      return invoke(authIpcChannels.signOut)
    },
    openSecuritySettings() {
      return invoke(authIpcChannels.openSecuritySettings)
    },
    updateDisplayName(name: string) {
      return invoke(authIpcChannels.updateDisplayName, name)
    },
    uploadAvatar(image: Uint8Array) {
      return invoke(authIpcChannels.uploadAvatar, image)
    },
    fetchAvatarImage(imageUrl: string) {
      return invoke(authIpcChannels.fetchAvatarImage, imageUrl)
    },
    listSessions() {
      return invoke(authIpcChannels.listSessions)
    },
    revokeSession(sessionId: string) {
      return invoke(authIpcChannels.revokeSession, sessionId)
    },
    revokeOtherSessions() {
      return invoke(authIpcChannels.revokeOtherSessions)
    },
    subscribe(listener: AuthStateListener) {
      const handleState = (
        _event: Electron.IpcRendererEvent,
        state: AuthState,
      ) => listener(state)
      ipcRenderer.on(authIpcChannels.stateChanged, handleState)

      return () => {
        ipcRenderer.removeListener(authIpcChannels.stateChanged, handleState)
      }
    },
    subscribeErrors(listener: AuthErrorListener) {
      const handleError = (
        _event: Electron.IpcRendererEvent,
        error: AuthError,
      ) => listener({ message: error.message })

      ipcRenderer.on(authIpcChannels.internalError, handleError)

      return () => {
        ipcRenderer.removeListener(authIpcChannels.internalError, handleError)
      }
    },
  },
  chat: {
    send(request: SendMessageRequest) {
      ipcRenderer.send(chatIpcChannels.send, request)
    },
    stop(request: StopMessageRequest) {
      ipcRenderer.send(chatIpcChannels.stop, request)
    },
    openExternalLink(url: string) {
      return invoke(chatIpcChannels.openExternalLink, url)
    },
    listConversations(request: ChatListRequest = {}) {
      return invoke(chatIpcChannels.listConversations, request)
    },
    loadConversation(request: ChatHistoryLoadRequest) {
      return invoke(chatIpcChannels.loadConversation, request)
    },
    deleteConversation(request: ChatHistoryDeleteRequest) {
      return invoke(chatIpcChannels.deleteConversation, request)
    },
    renameConversation(request: ChatRenameRequest) {
      return invoke(chatIpcChannels.renameConversation, request)
    },
    reorderConversations(request: ChatOrderRequest) {
      return invoke(chatIpcChannels.reorderConversations, request)
    },
    pickAttachments(request: ChatAttachmentPickRequest) {
      return invoke(chatIpcChannels.pickAttachments, request)
    },
    listPendingAttachments(request: ChatPendingAttachmentsRequest) {
      return invoke(chatIpcChannels.listPendingAttachments, request)
    },
    uploadAttachment(request: ChatAttachmentUploadRequest) {
      return invoke(chatIpcChannels.uploadAttachment, request)
    },
    reprocessAttachment(request: ChatAttachmentReprocessRequest) {
      return invoke(chatIpcChannels.reprocessAttachment, request)
    },
    getAttachmentStatus(request: ChatAttachmentStatusRequest) {
      return invoke(chatIpcChannels.attachmentStatus, request)
    },
    cancelAttachmentProcessing(request: ChatAttachmentCancelRequest) {
      return invoke(chatIpcChannels.cancelAttachmentProcessing, request)
    },
    deleteAttachment(request: ChatAttachmentDeleteRequest) {
      return invoke(chatIpcChannels.deleteAttachment, request)
    },
    subscribe(listener: ChatEventListener) {
      const handleEvent = (
        _event: Electron.IpcRendererEvent,
        event: ChatEvent,
      ) => {
        listener(event)
      }

      ipcRenderer.on(chatIpcChannels.event, handleEvent)

      return () => {
        ipcRenderer.removeListener(chatIpcChannels.event, handleEvent)
      }
    },
  },
  menu: {
    subscribe(listener: AppMenuActionListener) {
      const handleAction = (
        _event: Electron.IpcRendererEvent,
        action: AppMenuAction,
      ) => {
        listener(action)
      }

      ipcRenderer.on(appMenuIpcChannels.action, handleAction)

      return () => {
        ipcRenderer.removeListener(appMenuIpcChannels.action, handleAction)
      }
    },
  },
  window: {
    getFullScreenState() {
      return invoke(windowIpcChannels.getFullScreenState)
    },
    subscribeFullScreenState(listener: FullScreenStateListener) {
      const handleState = (
        _event: Electron.IpcRendererEvent,
        isFullScreen: boolean,
      ) => {
        listener(isFullScreen)
      }

      ipcRenderer.on(windowIpcChannels.fullScreenChanged, handleState)

      return () => {
        ipcRenderer.removeListener(
          windowIpcChannels.fullScreenChanged,
          handleState,
        )
      }
    },
  },
}

contextBridge.exposeInMainWorld('velin', velinApi)
