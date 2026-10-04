import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatSessionClient,
  normalizeSessionClient,
} from '@velin/contracts/session-client'

const safariUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15'
const velinUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Velin/0.1.0 Chrome/152.0.7977.130 Electron/44.4.5 Safari/537.36'
const qoderUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) QoderApp/0.4.3 Chrome/150.0.7871.114 Electron/43.1.1 Safari/537.36'
const zcodeUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ZCode/3.14.3 Chrome/146.0.7680.80 Electron/41.0.3 Safari/537.36'
const chromeUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
const edgeUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91'
const firefoxUserAgent =
  'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'
const iphoneUserAgent =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const androidUserAgent =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36'
const electronWithoutShellUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Electron/30.0.0'

function describeClient(userAgent: string | null) {
  const info = normalizeSessionClient({ userAgent })

  return { ...formatSessionClient(info), info }
}

test('the Velin Electron client is named after itself, not after Desktop', () => {
  const client = describeClient(velinUserAgent)

  assert.equal(client.label, 'Velin • macOS')
  assert.equal(client.info.channel, 'desktop')
  assert.equal(client.info.clientVersion, '0.1.0')
  assert.equal(client.icon, 'desktop')
})

test('a plain browser shows browser and platform', () => {
  assert.equal(describeClient(safariUserAgent).label, 'Safari • macOS')
  assert.equal(describeClient(safariUserAgent).info.channel, 'web')
  assert.equal(describeClient(chromeUserAgent).label, 'Chrome • Windows')
  assert.equal(describeClient(edgeUserAgent).label, 'Edge • macOS')
  assert.equal(describeClient(firefoxUserAgent).label, 'Firefox • Linux')
})

test('mobile browsers keep the browser name and claim the platform', () => {
  assert.equal(describeClient(iphoneUserAgent).label, 'Safari • iOS')
  assert.equal(describeClient(iphoneUserAgent).icon, 'phone')
  assert.equal(describeClient(androidUserAgent).label, 'Chrome • Android')
  assert.equal(describeClient(androidUserAgent).icon, 'phone')
})

test('command line clients are never reported as Web', () => {
  const curl = describeClient('curl/8.7.1')

  assert.equal(curl.label, 'curl • 命令行')
  assert.equal(curl.info.channel, 'cli')
  assert.equal(curl.info.clientVersion, '8.7.1')
  assert.equal(curl.icon, 'terminal')

  for (const [userAgent, name] of [
    ['Wget/1.21.4', 'wget'],
    ['HTTPie/3.2.2', 'HTTPie'],
    ['python-requests/2.32.3', 'Python Requests'],
    ['PostmanRuntime/7.37.3', 'Postman'],
    ['Go-http-client/2.0', 'Go HTTP client'],
  ] as const) {
    const client = describeClient(userAgent)

    assert.equal(client.info.channel, 'cli')
    assert.equal(client.label, `${name} • 命令行`)
  }
})

test('other Electron hosts keep their own product name', () => {
  const qoder = describeClient(qoderUserAgent)

  assert.equal(qoder.label, 'Qoder • macOS')
  assert.equal(qoder.info.channel, 'embedded')
  assert.equal(qoder.info.shellName, 'Qoder')
  assert.equal(qoder.info.shellVersion, '0.4.3')

  const zcode = describeClient(zcodeUserAgent)

  assert.equal(zcode.label, 'ZCode • macOS')
  assert.equal(zcode.info.channel, 'embedded')
  assert.equal(zcode.info.shellName, 'ZCode')
})

test('Electron alone never becomes the Velin desktop client', () => {
  const client = describeClient(electronWithoutShellUserAgent)

  assert.equal(client.info.channel, 'unknown')
  assert.equal(client.info.clientName, null)
  assert.equal(client.label, '未知客户端 • macOS')
})

test('unrecognizable user agents stay unknown instead of guessing Web', () => {
  for (const userAgent of ['SomeRandomThing', '', null]) {
    const client = describeClient(userAgent)

    assert.equal(client.info.channel, 'unknown')
    assert.equal(client.label, '未知客户端')
  }
})

test('explicit client metadata wins over a generic user agent', () => {
  const info = normalizeSessionClient({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    clientMetadata: { name: 'Velin', version: '0.2.0', osName: 'macOS' },
  })

  assert.equal(info.channel, 'desktop')
  assert.equal(info.clientName, 'Velin')
  assert.equal(info.clientVersion, '0.2.0')
  assert.equal(info.osName, 'macOS')
  assert.equal(formatSessionClient(info).label, 'Velin • macOS')
})

test('the underlying browser and engine stay available for detail views', () => {
  const info = normalizeSessionClient({ userAgent: qoderUserAgent })

  assert.equal(info.browserName, 'Electron')
  assert.equal(info.browserVersion, '43.1.1')
  assert.equal(info.osVersion, '10.15.7')
})
