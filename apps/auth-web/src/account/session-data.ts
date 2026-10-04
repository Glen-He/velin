import { normalizeSessionDate, isRecord } from '@velin/contracts/value'

export type WebSessionInfo = {
  token: string
  isCurrent: boolean
  userAgent: string | null
  updatedAt: string
}

// 网页在认证库边界使用 token；此类型不得进入桌面 Renderer。
export function normalizeSessions(
  data: unknown,
  currentToken: string | null,
): WebSessionInfo[] {
  if (!Array.isArray(data)) throw new Error('登录设备响应格式无效。')
  if (data.length > 0 && !currentToken)
    throw new Error('无法确定当前登录设备，请重新读取。')
  const tokens = new Set<string>()
  const sessions = data.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.token !== 'string' ||
      !item.token ||
      tokens.has(item.token)
    ) {
      throw new Error('登录设备响应不完整。')
    }
    tokens.add(item.token)
    return {
      token: item.token,
      isCurrent: item.token === currentToken,
      userAgent: typeof item.userAgent === 'string' ? item.userAgent : null,
      updatedAt: normalizeSessionDate(item.updatedAt),
    }
  })
  if (sessions.length > 0 && !sessions.some((session) => session.isCurrent))
    throw new Error('无法确定当前登录设备，请重新读取。')
  return sessions
}
