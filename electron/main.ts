import { createAuthStateSync } from './auth/auth-state-sync'
import { isValidDisplayName } from '@velin/contracts/policy'
import { errorMessage } from '@velin/contracts/error-copy'
import {
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
import {
  authClient,
  authWebUrl,
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
const developmentUrl = process.env.VITE_DEV_SERVER_URL
const developmentOrigin = developmentUrl
  ? new URL(developmentUrl).origin
  : undefined
const productionEntryPath = join(currentDirectory, '../dist/index.html')
const productionEntryUrl = pathToFileURL(productionEntryPath).href
const chatRuntime = new ChatRuntime(() =>
  emitAuthState({ user: null, reason: 'session-expired' }),
)

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
  ipcMain.handle(authIpcChannels.getState, async (event) => ({
    user: isTrustedRenderer(event) ? await getInitialAuthenticatedUser() : null,
  }))

  ipcMain.handle(authIpcChannels.requestSignIn, async (event, intent, flow) => {
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

  ipcMain.handle(authIpcChannels.authenticateCode, async (event, payload) => {
    if (!isTrustedRenderer(event) || typeof payload !== 'string') {
      return
    }

    const code = payload.trim()

    if (code.length === 0 || code.length > 4096) {
      throw new Error('授权码格式无效。')
    }

    const result = await authClient.authenticate({ token: code })

    if (result.error) {
      throw new Error(errorMessage(result.error, '授权码验证失败。'))
    }
  })

  ipcMain.handle(authIpcChannels.signOut, async (event) => {
    if (!isTrustedRenderer(event)) {
      return
    }

    await signOutAuthenticatedUser()
    chatRuntime.stopAll()
    emitAuthState({ user: null })
  })

  ipcMain.handle(authIpcChannels.openSecuritySettings, async (event) => {
    if (!isTrustedRenderer(event)) {
      return
    }

    await shell.openExternal(`${authWebUrl}/security`, { activate: true })
  })

  ipcMain.handle(authIpcChannels.updateDisplayName, async (event, payload) => {
    if (!isTrustedRenderer(event) || typeof payload !== 'string') {
      return
    }

    const name = payload.trim()

    if (!isValidDisplayName(name)) {
      throw new Error('用户名需为 1–32 个可见字符。')
    }

    await updateDisplayName(name)
    await refreshAuthState()
  })

  ipcMain.handle(authIpcChannels.uploadAvatar, async (event, payload) => {
    if (!isTrustedRenderer(event)) {
      return
    }

    if (!(payload instanceof Uint8Array)) {
      throw new Error('头像数据无效，请重新裁剪。')
    }

    await uploadAvatar(payload)
    await refreshAuthState()
  })

  ipcMain.handle(authIpcChannels.fetchAvatarImage, async (event, payload) => {
    if (!isTrustedRenderer(event)) {
      return
    }

    if (typeof payload !== 'string') {
      throw new Error('头像地址无效。')
    }

    return fetchAvatarImage(payload)
  })

  ipcMain.handle(authIpcChannels.listSessions, async (event) => {
    if (!isTrustedRenderer(event)) {
      return []
    }

    return listAuthenticatedSessions()
  })

  ipcMain.handle(authIpcChannels.revokeSession, async (event, payload) => {
    if (!isTrustedRenderer(event) || typeof payload !== 'string') {
      return
    }

    await revokeSessionById(payload)
  })

  ipcMain.handle(authIpcChannels.revokeOtherSessions, async (event) => {
    if (!isTrustedRenderer(event)) {
      return
    }

    await revokeOtherSessions()
    await refreshAuthState()
  })
}

function showUnavailableFeature(message: string, detail: string) {
  const targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow
  const options = {
    type: 'info' as const,
    buttons: ['好'],
    defaultId: 0,
    message,
    detail,
  }

  void (targetWindow
    ? dialog.showMessageBox(targetWindow, options)
    : dialog.showMessageBox(options))
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
          click: () =>
            showUnavailableFeature(
              '暂时无法检查更新',
              '当前开发版本尚未配置更新源。',
            ),
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

    if (!senderFrame) {
      return false
    }

    const senderUrl = new URL(senderFrame.url)

    return (
      (developmentOrigin !== undefined &&
        senderUrl.origin === developmentOrigin) ||
      senderUrl.href === productionEntryUrl
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
  ipcMain.handle(
    chatIpcChannels.openExternalLink,
    async (event, value: unknown) => {
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
        (externalUrl.protocol === 'https:' ||
          externalUrl.protocol === 'http:') &&
        !externalUrl.username &&
        !externalUrl.password
      ) {
        await shell.openExternal(externalUrl.href, { activate: true })
      }
    },
  )

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
  ipcMain.handle(windowIpcChannels.getFullScreenState, (event) => {
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
      preload: join(currentDirectory, 'preload.mjs'),
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

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const navigation = new URL(navigationUrl)
    const isAllowed =
      (developmentOrigin !== undefined &&
        navigation.origin === developmentOrigin) ||
      navigation.href === productionEntryUrl

    if (!isAllowed) {
      event.preventDefault()
    }
  })

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
