import { errorMessage } from '@velin/contracts/error-copy'
import { normalizePasskeys } from './passkey-data.ts'
import type { PasskeyInfo } from './passkey-data.ts'

type ReadPasskeys = (
  signal: AbortSignal,
) => Promise<{ data?: unknown; error?: unknown }>

export function createPasskeyList(read: ReadPasskeys) {
  let generation = 0
  let version = 0
  let controller: AbortController | null = null
  const initialSnapshot = {
    userId: null as string | null,
    passkeys: null as PasskeyInfo[] | null,
    error: null as string | null,
  }
  let snapshot = initialSnapshot
  const listeners = new Set<() => void>()
  function update(patch: Partial<typeof snapshot>) {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach((listener) => listener())
  }
  async function refresh() {
    if (!snapshot.userId) return
    const accountGeneration = generation
    const requestVersion = ++version
    controller?.abort()
    const request = new AbortController()
    controller = request
    try {
      const result = await read(request.signal)
      if (result.error) throw result.error
      const passkeys = normalizePasskeys(result.data)
      if (generation === accountGeneration && version === requestVersion)
        update({ passkeys, error: null })
    } catch (cause) {
      if (generation === accountGeneration && version === requestVersion)
        update({ error: errorMessage(cause, '读取通行密钥失败，请稍后重试。') })
    } finally {
      if (generation === accountGeneration && version === requestVersion)
        controller = null
    }
  }
  function deactivate() {
    generation += 1
    version += 1
    controller?.abort()
    controller = null
    update({ userId: null, passkeys: null, error: null })
  }
  function selectAccount(userId: string | null) {
    deactivate()
    update({ userId })
    return refresh()
  }
  return {
    selectAccount,
    deactivate,
    refresh,
    getSnapshot: () => snapshot,
    // 服务端与 hydration 使用稳定初值，不订阅请求或读取其他账号的状态。
    getServerSnapshot: () => initialSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
