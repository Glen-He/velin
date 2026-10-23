import { handleIpc } from './ipc-handler'
import { createAuthStateSync } from './auth/auth-state-sync'
import { checkForUpdates } from './updates'
import {
  installRendererSecurity,
  isTrustedRendererUrl,
} from './renderer-security'
import { release as systemRelease } from 'node:os'
import { isValidDisplayName } from '@velin/contracts/policy'
import { errorMessage, UserFacingError } from '@velin/contracts/error-copy'
import {
  chatAttachmentCancelRequestSchema,
  chatAttachmentDeleteRequestSchema,
  chatAttachmentPickRequestSchema,
  chatAttachmentReprocessRequestSchema,
  chatAttachmentStatusRequestSchema,
  chatAttachmentUploadRequestSchema,
  chatHistoryDeleteRequestSchema,
  chatPendingAttachmentsRequestSchema,
  chatHistoryLoadRequestSchema,
  chatOrderRequestSchema,
  chatListRequestSchema,
  chatRenameRequestSchema,
  chatRequestSchema,
  chatStopRequestSchema,
} from '@velin/contracts/chat-validation'
import { isRecord } from '@velin/contracts/value'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import type {
  IpcMainEvent,
  IpcMainInvokeEvent,
  MenuItemConstructorOptions,
} from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chatIpcChannels, type ChatEvent } from '@velin/contracts/chat-protocol'
import {
  appMenuIpcChannels,
  type AppMenuAction,
} from '@velin/contracts/app-menu-protocol'
import { windowIpcChannels } from '@velin/contracts/window-protocol'
import { ChatRuntime } from './chat/chat-runtime'
import { ChatHistoryClient } from './chat/history-client'
import { ChatAttachmentClient } from './chat/attachment-client'
import { ChatMemoryClient } from './chat/memory-client'
import {
  memoryIpcChannels,
  memoryActionSchema,
  conversationVersionRequestSchema,
} from '@velin/contracts/memory'
import {
  authClient,
  credentialScope,
  serviceUrl,
  getAuthenticatedUser,
  getInitialAuthenticatedUser,
  requestDesktopAuthentication,
  subscribeAuthenticatedUser,
  signOutAuthenticatedUser,
  updateDisplayName,
  listAuthenticatedSessions,
  revokeOtherSessions,
  revokeSessionById,
} from './auth/auth-client'
import { fetchAvatarImage, uploadAvatar } from './auth/avatar'
import {
  authIpcChannels,
  type AuthFlow,
  type AuthIntent,
} from '@velin/contracts/auth-protocol'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const developmentUrl = app.isPackaged
  ? undefined
  : process.env.VITE_DEV_SERVER_URL
const developmentOrigin = developmentUrl
  ? new URL(developmentUrl).origin
  : undefined
const productionEntryPath = join(currentDirectory, '../dist/index.html')
const productionEntryUrl = pathToFileURL(productionEntryPath).href
const onChatUnauthorized = () => {
  credentialScope.invalidate()
  chatRuntime.stopAll()
  emitAuthState({ user: null, reason: 'session-expired' })
}
const chatRuntime = new ChatRuntime(onChatUnauthorized)
const chatHistory = new ChatHistoryClient(onChatUnauthorized)
const chatMemory = new ChatMemoryClient(onChatUnauthorized)
const chatAttachments = new ChatAttachmentClient(onChatUnauthorized)

let mainWindow: BrowserWindow | null = null
let pendingAppMenuAction: AppMenuAction | null = null

app.setName('Velin')

function emitAppMenuAction(action: AppMenuAction) {
  const targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow

  if (!targetWindow) {
    pendingAppMenuAction = action
    createWindow()
    return
  }

  if (targetWindow.webContents.isLoadingMainFrame()) {
    pendingAppMenuAction = action
    return
  }

  if (!targetWindow.webContents.isDestroyed()) {
    targetWindow.webContents.send(appMenuIpcChannels.action, action)
  }
}

const authStateSync = createAuthStateSync(getAuthenticatedUser, (state) => {
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(authIpcChannels.stateChanged, state)
  }
})
const emitAuthState = authStateSync.emit
const refreshAuthState = authStateSync.refresh
subscribeAuthenticatedUser((user) => emitAuthState({ user }))

function registerAuthIpcHandlers() {
  handleIpc(authIpcChannels.getState, async (event) => ({
    user: isTrustedRenderer(event) ? await getInitialAuthenticatedUser() : null,
  }))

  handleIpc(authIpcChannels.requestSignIn, async (event, intent, flow) => {
    if (
      !isTrustedRenderer(event) ||
      (intent !== 'sign-in' && intent !== 'sign-up') ||
      (flow !== 'browser' && flow !== 'manual-code')
    ) {
      return
    }

    const effectiveFlow: AuthFlow =
      flow === 'manual-code' ||
      !app.isPackaged ||
      !app.isDefaultProtocolClient('com.velin.desktop')
        ? 'manual-code'
        : 'browser'

    await requestDesktopAuthentication(intent as AuthIntent, effectiveFlow)
    return effectiveFlow
  })

  handleIpc(authIpcChannels.authenticateCode, async (event, payload) => {
    if (!isTrustedRenderer(event) || typeof payload !== 'string') {
      return
    }

    const code = payload.trim()

    if (code.length === 0 || code.length > 4096) {
      throw new UserFacingError('授权码格式无效。')
    }

    const result = await authClient.authenticate({ token: code })

    if (result.error) {
      throw new UserFacingError(errorMessage(result.error, '授权码验证失败。'))
    }
  })

  handleIpc(authIpcChannels.signOut, async (event) => {
    if (!isTrustedRenderer(event)) {
      return
    }

    await signOutAuthenticatedUser()
    chatRuntime.stopAll()
    emitAuthState({ user: null })
  })

  handleIpc(authIpcChannels.openSecuritySettings, async (event) => {
    if (!isTrustedRenderer(event)) {
      return
    }

    await shell.openExternal(`${serviceUrl}/security`, { activate: true })
  })

  handleIpc(authIpcChannels.updateDisplayName, async (event, payload) => {
    if (!isTrustedRenderer(event) || typeof payload !== 'string') {
      return
    }

    const name = payload.trim()

    if (!isValidDisplayName(name)) {
      throw new UserFacingError('用户名需为 1–32 个可见字符。')
    }

    await updateDisplayName(name)
    await refreshAuthState()
  })

  handleIpc(authIpcChannels.uploadAvatar, async (event, payload) => {
    if (!isTrustedRenderer(event)) {
      return
    }

    if (!(payload instanceof Uint8Array)) {
      throw new UserFacingError('头像数据无效，请重新裁剪。')
    }

    await uploadAvatar(payload)
    await refreshAuthState()
  })

  handleIpc(authIpcChannels.fetchAvatarImage, async (event, payload) => {
    if (!isTrustedRenderer(event)) {
      return
    }

    if (typeof payload !== 'string') {
      throw new UserFacingError('头像地址无效。')
    }

    return fetchAvatarImage(payload)
  })

  handleIpc(authIpcChannels.listSessions, async (event) => {
    if (!isTrustedRenderer(event)) {
      return []
    }

    return listAuthenticatedSessions()
  })

  handleIpc(authIpcChannels.revokeSession, async (event, payload) => {
    if (!isTrustedRenderer(event) || typeof payload !== 'string') {
      return
    }

    await revokeSessionById(payload)
  })

  handleIpc(authIpcChannels.revokeOtherSessions, async (event) => {
    if (!isTrustedRenderer(event)) {
      return
    }

    await revokeOtherSessions()
    await refreshAuthState()
  })
}

function installApplicationMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Velin',
      submenu: [
        {
          label: '设置',
          accelerator: 'CommandOrControl+,',
          click: () => emitAppMenuAction('open-settings'),
        },
        {
          label: '检查更新',
          click: () => void checkForUpdates(),
        },
        {
          label: '退出登录',
          click: () => emitAppMenuAction('sign-out'),
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '文件',
      submenu: [
        {
          label: '新建对话',
          accelerator: 'CommandOrControl+N',
          click: () => emitAppMenuAction('new-conversation'),
        },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
        { role: 'delete', label: '删除' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '显示',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isTrustedRenderer(event: IpcMainEvent | IpcMainInvokeEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return false
  }

  try {
    const senderFrame = event.senderFrame

    if (!senderFrame || senderFrame !== mainWindow.webContents.mainFrame) {
      return false
    }

    return isTrustedRendererUrl(
      senderFrame.url,
      productionEntryUrl,
      developmentOrigin,
    )
  } catch {
    return false
  }
}

function emitChatEvent(sender: Electron.WebContents, event: ChatEvent) {
  if (!sender.isDestroyed()) {
    sender.send(chatIpcChannels.event, event)
  }
}

function emitError(
  sender: Electron.WebContents,
  requestId: string,
  conversationId: string,
  message: string,
) {
  emitChatEvent(sender, {
    type: 'error',
    requestId,
    conversationId,
    message,
  })
}

function registerChatIpcHandlers() {
  handleIpc(memoryIpcChannels.read, async (event) => {
    if (!isTrustedRenderer(event)) throw new UserFacingError('请求来源无效。')
    return chatMemory.read()
  })
  handleIpc(memoryIpcChannels.update, async (event, payload) => {
    if (!isTrustedRenderer(event)) throw new UserFacingError('请求来源无效。')
    const parsed = memoryActionSchema.safeParse(payload)
    if (!parsed.success) throw new UserFacingError('记忆内容无效。')
    return chatMemory.update(parsed.data)
  })
  handleIpc(memoryIpcChannels.versions, async (event, payload) => {
    if (!isTrustedRenderer(event)) throw new UserFacingError('请求来源无效。')
    const parsed = conversationVersionRequestSchema.safeParse(payload)
    if (!parsed.success) throw new UserFacingError('版本请求无效。')
    return chatMemory.versions(parsed.data)
  })
  handleIpc(memoryIpcChannels.restoreVersion, async (event, payload) => {
    if (!isTrustedRenderer(event)) throw new UserFacingError('请求来源无效。')
    const parsed = conversationVersionRequestSchema.safeParse(payload)
    if (!parsed.success || !parsed.data.versionId)
      throw new UserFacingError('版本请求无效。')
    await chatMemory.restore(parsed.data)
  })
  handleIpc(chatIpcChannels.listConversations, async (event, payload) => {
    if (!isTrustedRenderer(event)) throw new UserFacingError('请求来源无效。')
    const parsed = chatListRequestSchema.safeParse(payload ?? {})
    if (!parsed.success) throw new UserFacingError('对话列表参数无效。')
    return chatHistory.listConversations(parsed.data)
  })

  handleIpc(chatIpcChannels.loadConversation, async (event, payload) => {
    if (!isTrustedRenderer(event)) {
      throw new UserFacingError('请求来源无效。')
    }

    const parsed = chatHistoryLoadRequestSchema.safeParse(payload)

    if (!parsed.success) {
      throw new UserFacingError('对话请求格式无效。')
    }

    return chatHistory.loadConversation(parsed.data)
  })

  handleIpc(chatIpcChannels.deleteConversation, async (event, payload) => {
    if (!isTrustedRenderer(event)) {
      throw new UserFacingError('请求来源无效。')
    }

    const parsed = chatHistoryDeleteRequestSchema.safeParse(payload)

    if (!parsed.success) {
      throw new UserFacingError('对话请求格式无效。')
    }

    await chatHistory.deleteConversation(parsed.data)
  })

  handleIpc(chatIpcChannels.renameConversation, async (event, payload) => {
    if (!isTrustedRenderer(event)) {
      throw new UserFacingError('请求来源无效。')
    }

    const parsed = chatRenameRequestSchema.safeParse(payload)

    if (!parsed.success) {
      throw new UserFacingError('对话请求格式无效。')
    }

    return chatHistory.renameConversation(parsed.data)
  })

  handleIpc(chatIpcChannels.reorderConversations, async (event, payload) => {
    if (!isTrustedRenderer(event)) {
      throw new UserFacingError('请求来源无效。')
    }

    const parsed = chatOrderRequestSchema.safeParse(payload)

    if (!parsed.success) {
      throw new UserFacingError('对话请求格式无效。')
    }

    await chatHistory.reorderConversations(parsed.data)
  })

  handleIpc(
    chatIpcChannels.pickAttachments,
    async (event, payload: unknown) => {
      if (!isTrustedRenderer(event)) {
        throw new UserFacingError('请求来源无效。')
      }

      const parsed = chatAttachmentPickRequestSchema.safeParse(payload)
      if (!parsed.success) {
        throw new UserFacingError('附件请求格式无效。')
      }

      return chatAttachments.pick(
        parsed.data.kind,
        parsed.data.remaining,
        BrowserWindow.getFocusedWindow() ?? mainWindow,
        parsed.data.accountId,
        parsed.data.conversationId,
      )
    },
  )

  handleIpc(
    chatIpcChannels.listPendingAttachments,
    async (event, payload: unknown) => {
      if (!isTrustedRenderer(event)) {
        throw new UserFacingError('请求来源无效。')
      }

      const parsed = chatPendingAttachmentsRequestSchema.safeParse(payload)
      if (!parsed.success) {
        throw new UserFacingError('附件请求格式无效。')
      }
      return chatAttachments.listPending(parsed.data.conversationId)
    },
  )

  handleIpc(
    chatIpcChannels.uploadAttachment,
    async (event, payload: unknown) => {
      if (!isTrustedRenderer(event) || !isRecord(payload)) {
        throw new UserFacingError('附件请求格式无效。')
      }

      if (!(payload.bytes instanceof Uint8Array)) {
        throw new UserFacingError('附件数据无效。')
      }

      const parsed = chatAttachmentUploadRequestSchema.safeParse({
        accountId: payload.accountId,
        name: payload.name,
        mimeType: payload.mimeType,
        ...(payload.pageRange !== undefined
          ? { pageRange: payload.pageRange }
          : {}),
        ...(payload.conversationId !== undefined
          ? { conversationId: payload.conversationId }
          : {}),
      })
      if (!parsed.success) {
        throw new UserFacingError('附件请求格式无效。')
      }

      return chatAttachments.upload(
        parsed.data.name,
        parsed.data.mimeType,
        payload.bytes,
        {
          accountId: parsed.data.accountId,
          pageRange: parsed.data.pageRange,
          conversationId: parsed.data.conversationId,
        },
      )
    },
  )

  handleIpc(
    chatIpcChannels.reprocessAttachment,
    async (event, payload: unknown) => {
      if (!isTrustedRenderer(event)) {
        throw new UserFacingError('请求来源无效。')
      }

      const parsed = chatAttachmentReprocessRequestSchema.safeParse(payload)
      if (!parsed.success) {
        throw new UserFacingError('附件请求格式无效。')
      }

      return chatAttachments.reprocess(
        parsed.data.attachmentId,
        parsed.data.pageRange,
      )
    },
  )

  handleIpc(
    chatIpcChannels.attachmentStatus,
    async (event, payload: unknown) => {
      if (!isTrustedRenderer(event)) {
        throw new UserFacingError('请求来源无效。')
      }

      const parsed = chatAttachmentStatusRequestSchema.safeParse(payload)
      if (!parsed.success) {
        throw new UserFacingError('附件请求格式无效。')
      }
      return chatAttachments.getStatus(parsed.data.attachmentId)
    },
  )

  handleIpc(
    chatIpcChannels.cancelAttachmentProcessing,
    async (event, payload: unknown) => {
      if (!isTrustedRenderer(event)) {
        throw new UserFacingError('请求来源无效。')
      }

      const parsed = chatAttachmentCancelRequestSchema.safeParse(payload)
      if (!parsed.success) {
        throw new UserFacingError('附件请求格式无效。')
      }
      await chatAttachments.cancel(parsed.data.attachmentId)
    },
  )

  handleIpc(
    chatIpcChannels.deleteAttachment,
    async (event, payload: unknown) => {
      if (!isTrustedRenderer(event)) {
        throw new UserFacingError('请求来源无效。')
      }

      const parsed = chatAttachmentDeleteRequestSchema.safeParse(payload)
      if (!parsed.success) {
        throw new UserFacingError('附件请求格式无效。')
      }

      await chatAttachments.delete(parsed.data.attachmentId)
    },
  )

  handleIpc(chatIpcChannels.openExternalLink, async (event, value: unknown) => {
    if (
      !isTrustedRenderer(event) ||
      typeof value !== 'string' ||
      value.length > 2048
    ) {
      return
    }

    let externalUrl: URL
    try {
      externalUrl = new URL(value)
    } catch {
      return
    }

    if (
      (externalUrl.protocol === 'https:' || externalUrl.protocol === 'http:') &&
      !externalUrl.username &&
      !externalUrl.password
    ) {
      await shell.openExternal(externalUrl.href, { activate: true })
    }
  })

  ipcMain.on(chatIpcChannels.send, (event, payload: unknown) => {
    if (!isTrustedRenderer(event)) {
      return
    }

    const parsed = chatRequestSchema.safeParse(payload)

    if (!parsed.success) {
      const payloadRecord = isRecord(payload) ? payload : {}
      const requestId = isNonEmptyString(payloadRecord.requestId)
        ? payloadRecord.requestId
        : crypto.randomUUID()
      const conversationId = isNonEmptyString(payloadRecord.conversationId)
        ? payloadRecord.conversationId
        : 'unknown-conversation'

      emitError(event.sender, requestId, conversationId, '聊天请求格式无效。')
      return
    }

    const request = parsed.data
    const started = chatRuntime.start(request, (chatEvent) => {
      emitChatEvent(event.sender, chatEvent)
    })

    if (!started) {
      emitError(
        event.sender,
        request.requestId,
        request.conversationId,
        '该对话正在生成回复，请先停止当前请求。',
      )
    }
  })

  ipcMain.on(chatIpcChannels.stop, (event, payload: unknown) => {
    if (!isTrustedRenderer(event)) {
      return
    }

    const parsed = chatStopRequestSchema.safeParse(payload)

    if (parsed.success) {
      chatRuntime.stop(parsed.data.requestId, parsed.data.conversationId)
    }
  })
}

function emitFullScreenState() {
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(
      windowIpcChannels.fullScreenChanged,
      mainWindow.isFullScreen(),
    )
  }
}

function registerWindowIpcHandlers() {
  handleIpc(windowIpcChannels.getFullScreenState, (event) => {
    return isTrustedRenderer(event)
      ? (mainWindow?.isFullScreen() ?? false)
      : false
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '',
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 14, y: 15 },
          roundedCorners: true,
        }
      : {}),
    webPreferences: {
      preload: join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.on('closed', () => {
    chatRuntime.stopAll()
    mainWindow = null
  })
  mainWindow.on('enter-full-screen', emitFullScreenState)
  mainWindow.on('leave-full-screen', emitFullScreenState)
  mainWindow.on('focus', () => void refreshAuthState())
  mainWindow.webContents.on('did-finish-load', () => {
    emitFullScreenState()

    if (pendingAppMenuAction && mainWindow) {
      const action = pendingAppMenuAction
      pendingAppMenuAction = null
      mainWindow.webContents.send(appMenuIpcChannels.action, action)
    }
  })
  mainWindow.on('page-title-updated', (event) => event.preventDefault())

  installRendererSecurity(
    mainWindow,
    (url) => isTrustedRendererUrl(url, productionEntryUrl, developmentOrigin),
    () => chatRuntime.stopAll(),
  )

  if (developmentUrl) {
    void mainWindow.loadURL(developmentUrl)
  } else {
    void mainWindow.loadFile(productionEntryPath)
  }
}

registerChatIpcHandlers()
registerWindowIpcHandlers()
registerAuthIpcHandlers()

authClient.setupMain({
  getWindow: () => mainWindow,
  bridges: false,
  // 显式配置各能力；传入配置对象后，库不会自动启用省略的 scheme/csp。
  scheme: app.isPackaged,
  csp: false,
})

void app.whenReady().then(() => {
  if (
    app.isPackaged &&
    process.platform === 'win32' &&
    Number(systemRelease().split('.')[2] ?? 0) < 22000
  ) {
    dialog.showErrorBox(
      '系统版本不受支持',
      'Velin 需要 Windows 11 或更新版本。',
    )
    app.quit()
    return
  }
  installApplicationMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
