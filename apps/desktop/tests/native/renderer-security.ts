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

// 原生探针验证应用自己声明的权限策略、导航拦截与 Renderer 生命周期。
// 不比较 Chromium 各平台不一致的浏览器内部权限默认值：clipboard-write 由 Chromium
// 自行管理，应用真正申请的是 clipboard-sanitized-write，其允许/拒绝组合由
// tests/renderer-security.test.ts 的单元测试覆盖。
//
// 使用一次性 profile 和本地空白页面，不访问真实账号、文件或剪贴板内容。
const deniedPermissions = [
  'geolocation',
  'camera',
  'microphone',
  'clipboard-read',
] as const

const directory = process.env.VELIN_TEST_DIRECTORY
if (!directory) throw new Error('An isolated test directory is required.')
app.setPath('userData', join(directory, 'profile'))
// 超时是唯一没有断言的退出路径，先写诊断再退出，避免 CI 只拿到空 stderr。
setTimeout(() => {
  process.stderr.write('native renderer security verification timed out\n')
  app.exit(2)
}, 25_000).unref()
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
    const contents = window.webContents
    const entry = pathToFileURL(file).href
    let resets = 0
    installRendererSecurity(
      window,
      (url) => isTrustedRendererUrl(url, entry),
      () => resets++,
    )
    await window.loadFile(file)
    // Chromium 返回加载后的规范 URL，可能与 Node pathToFileURL 的百分号编码不同，
    // 因此以实际加载地址为准，并确认它仍满足应用自己的信任规则。
    const entryUrl = contents.getURL()
    assert.equal(isTrustedRendererUrl(entryUrl, entry), true)
    // geolocation、camera 与 microphone（映射 media）在 Chromium 中的默认状态是
    // prompt；这里读到 denied，说明真实 session 已装载应用安装的权限检查处理器。
    const states: unknown = await contents.executeJavaScript(
      `Promise.all(${JSON.stringify(deniedPermissions)}.map(async name => [name, (await navigator.permissions.query({ name })).state]))`,
    )
    assert.deepEqual(
      states,
      deniedPermissions.map((name) => [name, 'denied']),
    )
    // 新窗口策略只能从被打开的一侧观测：拒绝时 window.open 返回 null，
    // 且不会触发 did-create-window。
    let createdWindows = 0
    contents.on('did-create-window', () => createdWindows++)
    const opened: unknown = await contents.executeJavaScript(
      "window.open('https://invalid.example.test')",
    )
    assert.equal(opened, null)
    assert.equal(createdWindows, 0)
    const navigation = once(contents, 'will-navigate')
    await contents.executeJavaScript(
      "location.href = 'https://invalid.example.test'; undefined",
    )
    const [event] = await navigation
    assert.equal(event.defaultPrevented, true)
    assert.equal(contents.getURL(), entryUrl)
    const beforeReload = resets
    const loaded = once(contents, 'did-finish-load')
    contents.reload()
    await loaded
    assert.ok(resets > beforeReload)
    const beforeCrash = resets
    const gone = once(contents, 'render-process-gone')
    contents.forcefullyCrashRenderer()
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
