import { contextBridge, ipcRenderer } from 'electron'
import {
  appMenuIpcChannels,
  type AppMenuAction,
} from '@velin/contracts/app-menu-protocol'
import {
  chatIpcChannels,
  type ChatEvent,
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
  auth: {
    getState() {
      return ipcRenderer.invoke(authIpcChannels.getState)
    },
    requestSignIn(intent: AuthIntent = 'sign-in', flow: AuthFlow = 'browser') {
      return ipcRenderer.invoke(authIpcChannels.requestSignIn, intent, flow)
    },
    authenticateCode(code: string) {
      return ipcRenderer.invoke(authIpcChannels.authenticateCode, code)
    },
    signOut() {
      return ipcRenderer.invoke(authIpcChannels.signOut)
    },
    openSecuritySettings() {
      return ipcRenderer.invoke(authIpcChannels.openSecuritySettings)
    },
    updateDisplayName(name: string) {
      return ipcRenderer.invoke(authIpcChannels.updateDisplayName, name)
    },
    uploadAvatar(image: Uint8Array) {
      return ipcRenderer.invoke(authIpcChannels.uploadAvatar, image)
    },
    fetchAvatarImage(imageUrl: string) {
      return ipcRenderer.invoke(authIpcChannels.fetchAvatarImage, imageUrl)
    },
    listSessions() {
      return ipcRenderer.invoke(authIpcChannels.listSessions)
    },
    revokeSession(sessionId: string) {
      return ipcRenderer.invoke(authIpcChannels.revokeSession, sessionId)
    },
    revokeOtherSessions() {
      return ipcRenderer.invoke(authIpcChannels.revokeOtherSessions)
    },
    subscribe(listener: AuthStateListener) {
      const handleState = (
        _event: Electron.IpcRendererEvent,
        state: AuthState,
      ) => listener(state)
      const handleAuthenticated = (
        _event: Electron.IpcRendererEvent,
        user: AuthState['user'],
      ) => listener({ user })

      ipcRenderer.on(authIpcChannels.stateChanged, handleState)
      ipcRenderer.on(authIpcChannels.internalAuthenticated, handleAuthenticated)

      return () => {
        ipcRenderer.removeListener(authIpcChannels.stateChanged, handleState)
        ipcRenderer.removeListener(
          authIpcChannels.internalAuthenticated,
          handleAuthenticated,
        )
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
      return ipcRenderer.invoke(chatIpcChannels.openExternalLink, url)
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
      return ipcRenderer.invoke(windowIpcChannels.getFullScreenState)
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
