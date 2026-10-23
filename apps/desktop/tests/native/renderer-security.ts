import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  installRendererSecurity,
  isTrustedRendererUrl,
} from '../../src/main/renderer-security'

// 使用一次性 profile 和本地空白页面，不访问真实账号、文件或剪贴板内容。
const directory = process.env.VELIN_TEST_DIRECTORY
if (!directory) throw new Error('An isolated test directory is required.')
app.setPath('userData', join(directory, 'profile'))
setTimeout(() => app.exit(2), 25_000).unref()
void app.whenReady().then(async () => {
  let window: BrowserWindow | undefined
  let exitCode = 1
  try {
    const file = join(directory, 'index.html')
    await writeFile(
      file,
      '<!doctype html><title>Isolated security verification</title>',
    )
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'security-verification',
      },
    })
    const entry = pathToFileURL(file).href
    let resets = 0
    installRendererSecurity(
      window,
      (url) => isTrustedRendererUrl(url, entry),
      () => resets++,
    )
    await window.loadFile(file)
    const states: unknown = await window.webContents.executeJavaScript(
      `Promise.all(['geolocation', 'camera', 'microphone', 'clipboard-read', 'clipboard-write'].map(async name => [name, (await navigator.permissions.query({name})).state]))`,
    )
    assert.deepEqual(states, [
      ['geolocation', 'denied'],
      ['camera', 'denied'],
      ['microphone', 'denied'],
      ['clipboard-read', 'denied'],
      ['clipboard-write', 'granted'],
    ])
    const navigation = once(window.webContents, 'will-navigate')
    await window.webContents.executeJavaScript(
      "location.href = 'https://invalid.example.test'; undefined",
    )
    const [event] = await navigation
    assert.equal(event.defaultPrevented, true)
    assert.equal(window.webContents.getURL(), entry)
    const beforeReload = resets
    const loaded = once(window.webContents, 'did-finish-load')
    window.webContents.reload()
    await loaded
    assert.ok(resets > beforeReload)
    const beforeCrash = resets
    const gone = once(window.webContents, 'render-process-gone')
    window.webContents.forcefullyCrashRenderer()
    await gone
    assert.ok(resets > beforeCrash)
    await writeFile(
      join(directory, 'result.json'),
      JSON.stringify({
        permissions: true,
        navigation: true,
        reload: true,
        crash: true,
      }),
    )
    exitCode = 0
  } finally {
    window?.destroy()
    app.exit(exitCode)
  }
})
