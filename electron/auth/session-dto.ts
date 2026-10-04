import type { SessionClientMetadata } from '@velin/contracts/session-client'
import type { DesktopSession } from '@velin/contracts/auth-protocol'
import { isRecord, normalizeSessionDate } from '@velin/contracts/value'

// Main → Renderer 边界使用明确允许的字段，禁止展开上游数据。
export function toDesktopSessions(
  value: unknown,
  currentToken: string | null,
  metadata: SessionClientMetadata,
): DesktopSession[] {
  if (!Array.isArray(value)) throw new Error('登录设备列表返回的数据不完整。')
  if (value.length > 0 && !currentToken)
    throw new Error('无法确定当前登录设备，请重新读取。')
  const ids = new Set<string>()
  const tokens = new Set<string>()
  const sessions = value.map((item): DesktopSession => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !item.id ||
      ids.has(item.id) ||
      typeof item.token !== 'string' ||
      !item.token ||
      tokens.has(item.token)
    )
      throw new Error('登录设备列表返回的数据不完整。')
    ids.add(item.id)
    tokens.add(item.token)
    const isCurrent = item.token === currentToken
    return {
      id: item.id,
      isCurrent,
      ipAddress: typeof item.ipAddress === 'string' ? item.ipAddress : null,
      userAgent: typeof item.userAgent === 'string' ? item.userAgent : null,
      createdAt: normalizeSessionDate(item.createdAt),
      updatedAt: normalizeSessionDate(item.updatedAt),
      expiresAt: normalizeSessionDate(item.expiresAt),
      clientMetadata: isCurrent ? metadata : null,
    }
  })
  if (sessions.length > 0 && !sessions.some((session) => session.isCurrent))
    throw new Error('无法确定当前登录设备，请重新读取。')
  return sessions
}
