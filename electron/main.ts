import { app, BrowserWindow } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const developmentUrl = process.env.VITE_DEV_SERVER_URL
const developmentOrigin = developmentUrl ? new URL(developmentUrl).origin : undefined
const productionEntryPath = join(currentDirectory, '../dist/index.html')
const productionEntryUrl = pathToFileURL(productionEntryPath).href

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Relay',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: join(currentDirectory, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const navigation = new URL(navigationUrl)
    const isAllowed =
      (developmentOrigin !== undefined && navigation.origin === developmentOrigin) ||
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

void app.whenReady().then(() => {
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
