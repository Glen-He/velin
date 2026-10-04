import { serviceOrigin } from '@velin/contracts/service-url'
import { errorMessage } from '@velin/contracts/error-copy'
import { isRecord } from '@velin/contracts/value'
import { toDesktopSessions } from './session-dto'
import { electronClient } from '@better-auth/electron/client'
import type { ElectronClientOptions } from '@better-auth/electron/client'
import { storage } from '@better-auth/electron/storage'
import { createAuthClient } from 'better-auth/client'
import { app } from 'electron'
import type { BetterAuthClientPlugin, User } from 'better-auth'
import type {
  AuthFlow,
  AuthIntent,
  AuthUser,
  DesktopSession,
} from '@velin/contracts/auth-protocol'
import type { SessionClientMetadata } from '@velin/contracts/session-client'

export const apiServerUrl = serviceOrigin(
  process.env.VELIN_AUTH_SERVER_URL ?? 'http://localhost:3000',
  !app.isPackaged,
)

export const authWebUrl = serviceOrigin(
  process.env.VELIN_AUTH_WEB_URL ?? 'http://localhost:5174',
  !app.isPackaged,
)

function toAuthUser(user: Record<string, unknown>): AuthUser {
  return {
    id: typeof user.id === 'string' ? user.id : '',
    name: typeof user.name === 'string' ? user.name : '',
    email: typeof user.email === 'string' ? user.email : '',
    emailVerified: user.emailVerified === true,
    image: typeof user.image === 'string' ? user.image : null,
    twoFactorEnabled: user.twoFactorEnabled === true,
  }
}

function sanitizeUser(user: User & Record<string, unknown>) {
  const sanitizedUser = toAuthUser(user)

  return {
    ...sanitizedUser,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

const authenticationListeners = new Set<(user: AuthUser) => void>()

export function subscribeAuthenticatedUser(listener: (user: AuthUser) => void) {
  authenticationListeners.add(listener)
  return () => {
    authenticationListeners.delete(listener)
  }
}

const electronClientOptions = {
  clientID: 'velin-desktop',
  signInURL: `${authWebUrl}/sign-in`,
  protocol: { scheme: 'com.velin.desktop' },
  callbackPath: '/auth/callback',
  storage: storage({
    projectName: 'Velin',
    configName: 'auth-session',
  }),
  storagePrefix: 'velin-auth',
  cookiePrefix: 'velin-auth',
  channelPrefix: 'velin-auth-internal',
  // 头像经受限的自有 IPC 获取，不注册绕过 CSP 的额外图片代理协议。
  userImageProxy: { enabled: false },
  sanitizeUser,
} satisfies ElectronClientOptions

const configuredElectronClient = electronClient(electronClientOptions)
const configuredRegistrationClient = electronClient({
  ...electronClientOptions,
  signInURL: `${authWebUrl}/sign-in?mode=sign-up`,
})
const configuredManualCodeClient = electronClient({
  ...electronClientOptions,
  signInURL: `${authWebUrl}/sign-in?flow=manual-code`,
})
const configuredManualRegistrationClient = electronClient({
  ...electronClientOptions,
  signInURL: `${authWebUrl}/sign-in?mode=sign-up&flow=manual-code`,
})

// Electron 44 的 RequestInit 允许 duplex: "full"；Better Fetch 的
// 公开类型目前只允许 "half"。实际运行协议兼容，
// 因此在上游声明不一致的边界保留插件的具体动作类型，
// 避免把不匹配扩散到调用方。
const compatibleElectronClient =
  configuredElectronClient as unknown as BetterAuthClientPlugin &
    typeof configuredElectronClient
const compatibleRegistrationClient =
  configuredRegistrationClient as unknown as BetterAuthClientPlugin &
    typeof configuredRegistrationClient
const compatibleManualCodeClient =
  configuredManualCodeClient as unknown as BetterAuthClientPlugin &
    typeof configuredManualCodeClient
const compatibleManualRegistrationClient =
  configuredManualRegistrationClient as unknown as BetterAuthClientPlugin &
    typeof configuredManualRegistrationClient

export const authClient = createAuthClient({
  baseURL: apiServerUrl,
  plugins: [compatibleElectronClient],
  fetchOptions: {
    onSuccess(context) {
      // 授权交接的成功入口涵盖手动授权码与深链；仅发布白名单资料。
      if (
        new URL(context.request.url).pathname.endsWith('/electron/token') &&
        isRecord(context.data) &&
        isRecord(context.data.user)
      ) {
        const user = toAuthUser(context.data.user)
        if (user.id)
          authenticationListeners.forEach((listener) => listener(user))
      }
    },
  },
})

const registrationAuthClient = createAuthClient({
  baseURL: apiServerUrl,
  plugins: [compatibleRegistrationClient],
})
const manualCodeAuthClient = createAuthClient({
  baseURL: apiServerUrl,
  plugins: [compatibleManualCodeClient],
})
const manualRegistrationAuthClient = createAuthClient({
  baseURL: apiServerUrl,
  plugins: [compatibleManualRegistrationClient],
})

export async function requestDesktopAuthentication(
  intent: AuthIntent,
  flow: AuthFlow,
) {
  if (flow === 'manual-code') {
    await (
      intent === 'sign-up' ? manualRegistrationAuthClient : manualCodeAuthClient
    ).requestAuth()
    return
  }

  await (
    intent === 'sign-up' ? registrationAuthClient : authClient
  ).requestAuth()
}

export async function getAuthenticatedUser(): Promise<AuthUser | null> {
  const result = await authClient.$fetch('/get-session', { method: 'GET' })

  if (result.error) {
    if (result.error.status === 401) {
      return null
    }

    throw new Error('读取登录状态失败，请稍后重试。')
  }

  if (
    !result.data ||
    typeof result.data !== 'object' ||
    !('user' in result.data) ||
    !result.data.user ||
    typeof result.data.user !== 'object'
  ) {
    return null
  }

  return toAuthUser(result.data.user as Record<string, unknown>)
}

const initialSessionAttempts = 4
const initialSessionRetryDelayMs = 500

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

// 没有会话返回 null；服务或传输失败会抛出。并发启动时认证服务可能
// 晚于窗口就绪，这里做有限次重试，避免首帧误报连接不可用。
export async function getInitialAuthenticatedUser(): Promise<AuthUser | null> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await getAuthenticatedUser()
    } catch (error) {
      if (attempt >= initialSessionAttempts) {
        throw error
      }

      await delay(initialSessionRetryDelayMs)
    }
  }
}

export async function signOutAuthenticatedUser() {
  const result = await authClient.$fetch('/sign-out', {
    method: 'POST',
    body: {},
  })

  if (result.error) {
    throw new Error('退出登录失败，请稍后重试。')
  }
}

function readProfileErrorMessage(error: unknown, fallback: string) {
  const body = isRecord(error) && isRecord(error.body) ? error.body : error
  return errorMessage(body, fallback)
}

export async function updateDisplayName(name: string) {
  const result = await authClient.$fetch('/update-user', {
    method: 'POST',
    body: { name },
  })

  if (result.error) {
    throw new Error(
      readProfileErrorMessage(result.error, '更新用户名失败，请稍后重试。'),
    )
  }
}

function readCurrentSessionToken(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('session' in data)) {
    return null
  }

  const session = (data as { session: unknown }).session

  if (
    typeof session !== 'object' ||
    session === null ||
    !('token' in session)
  ) {
    return null
  }

  const token = (session as { token: unknown }).token

  return typeof token === 'string' ? token : null
}

// 本机自己就是产品，不必再从 UA 猜身份；这份 metadata 只用于展示。
function currentClientMetadata(): SessionClientMetadata {
  if (process.platform === 'darwin') {
    return { name: app.getName(), version: app.getVersion(), osName: 'macOS' }
  }

  if (process.platform === 'win32') {
    return { name: app.getName(), version: app.getVersion(), osName: 'Windows' }
  }

  return { name: app.getName(), version: app.getVersion(), osName: 'Linux' }
}

export async function listAuthenticatedSessions(): Promise<DesktopSession[]> {
  const [listResult, currentResult] = await Promise.all([
    authClient.$fetch('/list-sessions', { method: 'GET' }),
    authClient.$fetch('/get-session', { method: 'GET' }),
  ])

  if (listResult.error) {
    throw new Error(
      readProfileErrorMessage(
        listResult.error,
        '读取登录设备失败，请稍后重试。',
      ),
    )
  }

  if (currentResult.error) throw new Error('无法确定当前登录设备，请稍后重试。')
  return toDesktopSessions(
    listResult.data,
    readCurrentSessionToken(currentResult.data),
    currentClientMetadata(),
  )
}

export async function revokeSessionById(sessionId: string) {
  const sessions = await authClient.$fetch('/list-sessions', { method: 'GET' })
  if (sessions.error || !Array.isArray(sessions.data))
    throw new Error('读取登录设备失败。')
  const target = sessions.data.find(
    (item: unknown) =>
      typeof item === 'object' &&
      item !== null &&
      'id' in item &&
      item.id === sessionId,
  )
  if (
    !target ||
    typeof target !== 'object' ||
    !('token' in target) ||
    typeof target.token !== 'string'
  ) {
    throw new Error('该设备不存在或已退出。')
  }
  const result = await authClient.$fetch('/revoke-session', {
    method: 'POST',
    body: { token: target.token },
  })

  if (result.error) {
    throw new Error(
      readProfileErrorMessage(result.error, '退出该设备失败，请稍后重试。'),
    )
  }
}

export async function revokeOtherSessions() {
  const result = await authClient.$fetch('/revoke-other-sessions', {
    method: 'POST',
    body: {},
  })

  if (result.error) {
    throw new Error(
      readProfileErrorMessage(result.error, '退出其他设备失败，请稍后重试。'),
    )
  }
}
