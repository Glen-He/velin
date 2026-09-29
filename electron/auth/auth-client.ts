import { electronClient } from '@better-auth/electron/client'
import type { ElectronClientOptions } from '@better-auth/electron/client'
import { storage } from '@better-auth/electron/storage'
import { createAuthClient } from 'better-auth/client'
import type { BetterAuthClientPlugin, User } from 'better-auth'
import type {
  AuthFlow,
  AuthIntent,
  AuthUser,
  DesktopSession,
} from '../../src/shared/auth-protocol'

export const apiServerUrl = (
  process.env.VELIN_AUTH_SERVER_URL ?? 'http://localhost:3000'
).replace(/\/$/, '')

export const authWebUrl = (
  process.env.VELIN_AUTH_WEB_URL ?? 'http://localhost:5174'
).replace(/\/$/, '')

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

// Electron 44's RequestInit includes `duplex: "full"`, while Better Fetch's
// public client type currently narrows it to `"half"`. The runtime contracts
// are compatible; preserve the plugin's concrete action types across that
// upstream declaration mismatch.
const compatibleElectronClient = configuredElectronClient as unknown as
  BetterAuthClientPlugin & typeof configuredElectronClient
const compatibleRegistrationClient = configuredRegistrationClient as unknown as
  BetterAuthClientPlugin & typeof configuredRegistrationClient
const compatibleManualCodeClient = configuredManualCodeClient as unknown as
  BetterAuthClientPlugin & typeof configuredManualCodeClient
const compatibleManualRegistrationClient = configuredManualRegistrationClient as unknown as
  BetterAuthClientPlugin & typeof configuredManualRegistrationClient

export const authClient = createAuthClient({
  baseURL: apiServerUrl,
  plugins: [compatibleElectronClient],
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
    await (intent === 'sign-up'
      ? manualRegistrationAuthClient
      : manualCodeAuthClient).requestAuth()
    return
  }

  await (intent === 'sign-up' ? registrationAuthClient : authClient).requestAuth()
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
  if (typeof error === 'object' && error !== null && 'body' in error) {
    const body = (error as { body: unknown }).body
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = (body as { message: unknown }).message
      if (
        typeof message === 'string' &&
        message.length > 0 &&
        message.length <= 200
      ) {
        return message
      }
    }
  }

  return fallback
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

  if (typeof session !== 'object' || session === null || !('token' in session)) {
    return null
  }

  const token = (session as { token: unknown }).token

  return typeof token === 'string' ? token : null
}

// better-auth 客户端会把日期字段反序列化成 Date 对象，统一转回 ISO 字符串。
function normalizeSessionDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number') {
    return new Date(value).toISOString()
  }

  return ''
}

export async function listAuthenticatedSessions(): Promise<DesktopSession[]> {
  const [listResult, currentResult] = await Promise.all([
    authClient.$fetch('/list-sessions', { method: 'GET' }),
    authClient.$fetch('/get-session', { method: 'GET' }),
  ])

  if (listResult.error) {
    throw new Error(
      readProfileErrorMessage(listResult.error, '读取登录设备失败，请稍后重试。'),
    )
  }

  const currentToken = readCurrentSessionToken(currentResult.data)
  const rawSessions: unknown[] = Array.isArray(listResult.data)
    ? listResult.data
    : []

  const sessions: DesktopSession[] = []

  for (const item of rawSessions) {
    if (typeof item !== 'object' || item === null) {
      continue
    }

    const record = item as Record<string, unknown>
    const token = record.token

    if (typeof token !== 'string' || token.length === 0) {
      continue
    }

    sessions.push({
      token,
      isCurrent: token === currentToken,
      ipAddress: typeof record.ipAddress === 'string' ? record.ipAddress : null,
      userAgent: typeof record.userAgent === 'string' ? record.userAgent : null,
      createdAt: normalizeSessionDate(record.createdAt),
      updatedAt: normalizeSessionDate(record.updatedAt),
      expiresAt: normalizeSessionDate(record.expiresAt),
    })
  }

  return sessions
}

export async function revokeSessionByToken(token: string) {
  const result = await authClient.$fetch('/revoke-session', {
    method: 'POST',
    body: { token },
  })

  if (result.error) {
    throw new Error(
      readProfileErrorMessage(result.error, '退出该设备失败，请稍后重试。'),
    )
  }
}

export async function revokeOtherSessions() {
  const result = await authClient.$fetch('/revoke-sessions', {
    method: 'POST',
    body: {},
  })

  if (result.error) {
    throw new Error(
      readProfileErrorMessage(result.error, '退出其他设备失败，请稍后重试。'),
    )
  }
}
