import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import type { BrowserWindow, Session, WebContents } from 'electron'
import {
  installRendererSecurity,
  isTrustedRendererUrl,
} from '../src/main/renderer-security'

const entry = 'file:///Application/Velin/dist/index.html'

test('renderer URL policy rejects other files, credentials, malformed URLs and lookalike origins', () => {
  assert.equal(isTrustedRendererUrl(entry, entry), true)
  for (const url of [
    'invalid',
    'file:///Application/Velin/secret',
    `${entry}?x=1`,
    `${entry}#fragment`,
    'file:///Application/Velin/dist%2Findex.html',
    'https://evil.test',
  ])
    assert.equal(isTrustedRendererUrl(url, entry), false)
  // Node 的 pathToFileURL 把 Windows 8.3 短路径中的 ~ 编码为 %7E，
  // Chromium 的 getURL 保持 ~；两者指向同一文件，必须判为同一来源。
  assert.equal(
    isTrustedRendererUrl(
      'file:///Application/RUNNER~1/index.html',
      'file:///Application/RUNNER%7E1/index.html',
    ),
    true,
  )
  const origin = 'http://localhost:5173'
  assert.equal(isTrustedRendererUrl(`${origin}/`, entry, origin), true)
  for (const url of [
    'http://localhost:51730',
    'http://localhost:5173.evil.test',
    'http://user:secret@localhost:5173',
  ])
    assert.equal(isTrustedRendererUrl(url, entry, origin), false)
})

test('permission requests and checks allow only trusted top-level clipboard writes', () => {
  let check: NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>
  let request: NonNullable<
    Parameters<Session['setPermissionRequestHandler']>[0]
  >
  let device: NonNullable<Parameters<Session['setDevicePermissionHandler']>[0]>
  let openWindow: NonNullable<
    Parameters<WebContents['setWindowOpenHandler']>[0]
  >
  let url = entry
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getURL: () => url,
    setWindowOpenHandler: (handler: typeof openWindow) => {
      openWindow = handler
    },
    session: {
      setPermissionCheckHandler: (handler: typeof check) => {
        check = handler
      },
      setPermissionRequestHandler: (handler: typeof request) => {
        request = handler
      },
      setDevicePermissionHandler: (handler: typeof device) => {
        device = handler
      },
    },
  })
  let resets = 0
  installRendererSecurity(
    { webContents: contents } as unknown as BrowserWindow,
    (value) => value === entry,
    () => resets++,
  )
  const sender = contents as unknown as WebContents
  const details = { isMainFrame: true, requestingUrl: entry }
  for (const permission of [
    'clipboard-sanitized-write',
    'clipboard-read',
    'media',
    'display-capture',
    'geolocation',
    'notifications',
    'unknown',
  ] as const) {
    const allowed = permission === 'clipboard-sanitized-write'
    assert.equal(check!(sender, permission, 'file://', details), allowed)
    request!(
      sender,
      permission,
      (result) => assert.equal(result, allowed),
      details,
    )
  }
  assert.equal(check!(null, 'clipboard-sanitized-write', '', details), false)
  assert.equal(
    check!(sender, 'clipboard-sanitized-write', '', {
      ...details,
      isMainFrame: false,
    }),
    false,
  )
  assert.equal(
    check!(sender, 'clipboard-sanitized-write', '', {
      ...details,
      requestingUrl: 'https://evil.test',
    }),
    false,
  )
  url = 'https://evil.test'
  assert.equal(check!(sender, 'clipboard-sanitized-write', '', details), false)
  assert.equal(
    device!({ deviceType: 'hid', origin: 'file://', device: {}, frame: null }),
    false,
  )
  assert.deepEqual(openWindow!({} as Parameters<typeof openWindow>[0]), {
    action: 'deny',
  })
  contents.emit('did-start-navigation', {
    isMainFrame: false,
    isSameDocument: false,
  })
  contents.emit('did-start-navigation', {
    isMainFrame: true,
    isSameDocument: true,
  })
  assert.equal(resets, 0)
  contents.emit('did-start-navigation', {
    isMainFrame: true,
    isSameDocument: false,
  })
  contents.emit('render-process-gone')
  contents.emit('destroyed')
  assert.equal(resets, 3)
  for (const event of ['will-navigate', 'will-redirect']) {
    let denied = false
    contents.emit(event, {
      url: 'https://evil.test',
      preventDefault: () => {
        denied = true
      },
    })
    assert.equal(denied, true)
  }
})
