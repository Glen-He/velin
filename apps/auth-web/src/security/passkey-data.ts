import { isRecord, normalizeSessionDate } from '@velin/contracts/value'

export type PasskeyInfo = { id: string; name: string | null; createdAt: string }

export function normalizePasskeys(value: unknown): PasskeyInfo[] {
  if (!Array.isArray(value)) throw new Error('通行密钥列表返回的数据不完整。')
  const ids = new Set<string>()
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !item.id ||
      ids.has(item.id)
    )
      throw new Error('通行密钥列表返回的数据不完整。')
    ids.add(item.id)
    return {
      id: item.id,
      name: typeof item.name === 'string' ? item.name : null,
      createdAt: normalizeSessionDate(item.createdAt),
    }
  })
}
