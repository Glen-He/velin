import { isRecord } from '@velin/contracts/value'
import { actionErrorMessage } from '../api/http'
import { useCallback, useEffect, useRef, useState } from 'react'
import { authClient } from '../auth-client'
import { normalizeSessionDate } from '../shared'

export type PasskeyInfo = {
  id: string
  name: string | null
  createdAt: string
}

function toPasskeyRows(items: unknown): PasskeyInfo[] {
  const rows: PasskeyInfo[] = []

  if (!Array.isArray(items)) throw new Error('通行密钥列表返回的数据不完整。')
  for (const item of items) {
    if (!isRecord(item) || typeof item.id !== 'string') {
      continue
    }

    rows.push({
      id: item.id,
      name: typeof item.name === 'string' ? item.name : null,
      createdAt: normalizeSessionDate(item.createdAt),
    })
  }

  return rows
}

// 总览页要显示「已添加几个」，管理页要列出具体实例，两边读的是同一份数据。
export function usePasskeyList() {
  const [passkeys, setPasskeys] = useState<PasskeyInfo[] | null>(null)

  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++sequence.current
    try {
      const result = await authClient.passkey.listUserPasskeys()
      if (result.error) throw result.error
      const rows = toPasskeyRows(result.data)
      if (request === sequence.current) {
        setPasskeys(rows)
        setError(null)
      }
    } catch (cause) {
      if (request === sequence.current) setError(actionErrorMessage(cause))
    }
  }, [])
  const invalidate = useCallback(() => {
    sequence.current++
  }, [])
  useEffect(() => {
    async function load() {
      await refresh()
    }
    void load()
    return invalidate
  }, [refresh, invalidate])
  return { passkeys, error, refresh }
}
