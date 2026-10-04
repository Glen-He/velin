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
  return value.map((item): DesktopSession => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !item.id ||
      typeof item.token !== 'string' ||
      !item.token
    )
      throw new Error('登录设备列表返回的数据不完整。')
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
}
