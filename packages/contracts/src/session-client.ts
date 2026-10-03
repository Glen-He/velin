import Bowser from 'bowser'

/*
 * 会话客户端识别。raw User-Agent 和 client metadata 都可以被伪造，这里的结果
 * 只用于展示、调试和分析，不得参与授权、MFA、设备信任等任何安全判断。
 */

export type SessionClientChannel =
  | 'desktop'
  | 'web'
  | 'cli'
  | 'embedded'
  | 'unknown'

export type SessionClientIcon = 'desktop' | 'phone' | 'tablet' | 'terminal'

export type SessionClientMetadata = {
  name: string
  version?: string | null
  osName?: string | null
}

export type SessionClientInfo = {
  channel: SessionClientChannel
  clientName: string | null
  clientVersion: string | null
  browserName: string | null
  browserVersion: string | null
  shellName: string | null
  shellVersion: string | null
  osName: string | null
  osVersion: string | null
}

const velinProductName = 'velin'

// 命令行 / HTTP 客户端。命中即确定不是浏览器，禁止 fallback 成 Web。
const cliClientNames = new Map([
  ['curl', 'curl'],
  ['wget', 'wget'],
  ['httpie', 'HTTPie'],
  ['paw', 'Paw'],
  ['postmanruntime', 'Postman'],
  ['insomnia', 'Insomnia'],
  ['python-requests', 'Python Requests'],
  ['python-urllib', 'Python urllib'],
  ['aiohttp', 'aiohttp'],
  ['httpx', 'httpx'],
  ['node-fetch', 'node-fetch'],
  ['undici', 'undici'],
  ['axios', 'Axios'],
  ['got', 'got'],
  ['okhttp', 'OkHttp'],
  ['apache-httpclient', 'Apache HttpClient'],
  ['reactornetty', 'Reactor Netty'],
  ['go-http-client', 'Go HTTP client'],
  ['java', 'Java'],
  ['powershell', 'PowerShell'],
  ['invoke-webrequest', 'PowerShell'],
])

// 浏览器与运行时自带的通用 token，不能当成宿主产品名。
const runtimeTokens = new Set([
  'android',
  'applewebkit',
  'brave',
  'chrome',
  'chromewebview',
  'crios',
  'darwin',
  'edge',
  'edga',
  'edgios',
  'electron',
  'firefox',
  'gecko',
  'googleapp',
  'iphone',
  'ipad',
  'ipod',
  'macintosh',
  'macos',
  'mobile',
  'mozilla',
  'opr',
  'fxios',
  'rv',
  'safari',
  'samsungbrowser',
  'version',
  'vivaldi',
  'windows',
  'x11',
])

// 宿主产品 token 与实际产品名不一致时只在这里登记，其余直接沿用 token。
const embeddedShellNames = new Map([['qoderapp', 'Qoder']])

const browserDisplayNames = new Map([['microsoft edge', 'Edge']])

const unknownGenericNames = new Set(['', 'other', 'unknown'])

function toDisplayName(
  rawName: string | undefined,
  names?: Map<string, string>,
) {
  if (rawName === undefined) {
    return null
  }

  const trimmedName = rawName.trim()

  if (unknownGenericNames.has(trimmedName.toLowerCase())) {
    return null
  }

  return names?.get(trimmedName.toLowerCase()) ?? trimmedName
}

function extractProductToken(userAgent: string) {
  for (const [, name, version] of userAgent.matchAll(
    /([A-Za-z][A-Za-z0-9._-]{1,31})\/(\d[A-Za-z0-9.+-]{0,23})/g,
  )) {
    if (runtimeTokens.has(name.toLowerCase())) {
      continue
    }

    return { name, version }
  }

  return null
}

function isElectronHost(userAgent: string) {
  return /\belectron\//i.test(userAgent)
}

type GenericClientNames = {
  browserName: string | null
  browserVersion: string | null
  osName: string | null
  osVersion: string | null
}

function createInfo(
  channel: SessionClientChannel,
  fields: Partial<Omit<SessionClientInfo, 'channel'>>,
  generic: GenericClientNames,
): SessionClientInfo {
  return {
    channel,
    clientName: fields.clientName ?? null,
    clientVersion: fields.clientVersion ?? null,
    browserName: generic.browserName,
    browserVersion: generic.browserVersion,
    shellName: fields.shellName ?? null,
    shellVersion: fields.shellVersion ?? null,
    osName: fields.osName ?? generic.osName,
    osVersion: generic.osVersion,
  }
}

export function normalizeSessionClient(input: {
  userAgent: string | null
  clientMetadata?: SessionClientMetadata | null
}): SessionClientInfo {
  const { userAgent, clientMetadata = null } = input
  const parser = userAgent ? Bowser.getParser(userAgent) : null
  const generic = {
    browserName: parser
      ? toDisplayName(parser.getBrowser().name, browserDisplayNames)
      : null,
    browserVersion: parser?.getBrowser().version || null,
    osName: parser ? toDisplayName(parser.getOS().name) : null,
    osVersion: parser?.getOS().version || null,
  }

  // 能自己说明身份的客户端优先，UA 只作为拿不到 metadata 时的兼容回退。
  if (clientMetadata) {
    return createInfo(
      'desktop',
      {
        clientName: clientMetadata.name,
        clientVersion: clientMetadata.version ?? null,
        osName: clientMetadata.osName ?? null,
      },
      generic,
    )
  }

  if (!userAgent) {
    return createInfo('unknown', {}, generic)
  }

  const productToken = extractProductToken(userAgent)
  const electronHost = isElectronHost(userAgent)

  if (productToken) {
    const tokenKey = productToken.name.toLowerCase()
    const cliClientName = cliClientNames.get(tokenKey)

    if (cliClientName) {
      return createInfo(
        'cli',
        {
          clientName: cliClientName,
          clientVersion: productToken.version,
        },
        generic,
      )
    }

    if (tokenKey === velinProductName) {
      return createInfo(
        'desktop',
        {
          clientName: productToken.name,
          clientVersion: productToken.version,
        },
        generic,
      )
    }

    // Electron 只是运行技术：认得出宿主产品才算嵌入式客户端。
    if (electronHost) {
      const shellName = embeddedShellNames.get(tokenKey) ?? productToken.name

      return createInfo(
        'embedded',
        {
          clientName: shellName,
          clientVersion: productToken.version,
          shellName,
          shellVersion: productToken.version,
        },
        generic,
      )
    }
  }

  // 只带 Electron token 又认不出宿主：宁可未知，也不冒充桌面客户端。
  if (electronHost || !generic.browserName) {
    return createInfo('unknown', {}, generic)
  }

  return createInfo('web', { clientName: generic.browserName }, generic)
}

export function formatSessionClient(info: SessionClientInfo) {
  const title = info.clientName ?? '未知客户端'
  // 命令行没有“操作系统”可言，第二段直接说明它是命令行客户端。
  const context = info.channel === 'cli' ? '命令行' : info.osName

  return {
    label: context ? `${title} • ${context}` : title,
    icon: pickSessionClientIcon(info),
  }
}

function pickSessionClientIcon(info: SessionClientInfo): SessionClientIcon {
  if (info.channel === 'cli') {
    return 'terminal'
  }

  if (info.channel === 'desktop' || info.channel === 'embedded') {
    return 'desktop'
  }

  if (info.osName === 'iOS' || info.osName === 'Android') {
    return 'phone'
  }

  if (info.osName === 'iPadOS') {
    return 'tablet'
  }

  return 'desktop'
}

export function formatSessionActivity(iso: string) {
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return `${date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })} ${date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`
}
