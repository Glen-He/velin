import type { BrowserWindow, Event, WebContents } from 'electron'

export function isTrustedRendererUrl(
  value: string,
  productionEntryUrl: string,
  developmentOrigin?: string,
) {
  try {
    const url = new URL(value)
    return (
      !url.username &&
      !url.password &&
      ((developmentOrigin !== undefined && url.origin === developmentOrigin) ||
        url.href === productionEntryUrl)
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
