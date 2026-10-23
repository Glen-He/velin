import type { BrowserWindow, Event, WebContents } from 'electron'

/** 解码 file URL 路径；编码的分隔符含义不明确，直接判为不可信。 */
function decodedFilePath(url: URL): string | null {
  if (/%2f|%5c/i.test(url.pathname)) return null
  try {
    return decodeURIComponent(url.pathname)
  } catch {
    return null
  }
}

export function isTrustedRendererUrl(
  value: string,
  productionEntryUrl: string,
  developmentOrigin?: string,
) {
  try {
    const url = new URL(value)
    if (url.username || url.password) return false
    if (developmentOrigin !== undefined && url.origin === developmentOrigin) {
      return true
    }
    const entry = new URL(productionEntryUrl)
    if (url.protocol !== 'file:' || entry.protocol !== 'file:') {
      return url.href === entry.href
    }
    // Chromium 返回加载后的规范 URL，与 Node pathToFileURL 的百分号编码不总是相同：
    // Windows 8.3 短路径中的 ~ 会被 Node 编码为 %7E，而 Chromium 保持 ~。
    // 因此比较解码后的路径与主机，而不是比较原始 href。
    const path = decodedFilePath(url)
    const entryPath = decodedFilePath(entry)
    return (
      path !== null &&
      entryPath !== null &&
      url.host === entry.host &&
      !url.search &&
      !url.hash &&
      path === entryPath
    )
  } catch {
    return false
  }
}

export function installRendererSecurity(
  window: BrowserWindow,
  isTrustedUrl: (url: string) => boolean,
  onReset: () => void,
) {
  const contents = window.webContents
  const session = contents.session
  // 当前产品只需主动复制；摄像头、麦克风、屏幕和后台剪贴板读取均不开放。
  const allowPermission = (
    sender: WebContents | null,
    permission: string,
    details: { isMainFrame: boolean; requestingUrl?: string },
  ) =>
    sender === contents &&
    !contents.isDestroyed() &&
    permission === 'clipboard-sanitized-write' &&
    details.isMainFrame &&
    !!details.requestingUrl &&
    isTrustedUrl(details.requestingUrl) &&
    isTrustedUrl(contents.getURL())
  session.setPermissionCheckHandler((sender, permission, _origin, details) =>
    allowPermission(sender, permission, details),
  )
  session.setPermissionRequestHandler((sender, permission, callback, details) =>
    callback(allowPermission(sender, permission, details)),
  )
  session.setDevicePermissionHandler(() => false)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const preventNavigation = (event: Event<{ url: string }>) => {
    if (!isTrustedUrl(event.url)) event.preventDefault()
  }
  contents.on('will-navigate', preventNavigation)
  contents.on('will-redirect', preventNavigation)
  contents.on('will-attach-webview', (event) => event.preventDefault())
  // 刷新、崩溃与窗口销毁都结束旧 Renderer 发起的模型任务，不能继续后台计费。
  contents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) onReset()
  })
  contents.on('render-process-gone', onReset)
  contents.on('destroyed', onReset)
}
