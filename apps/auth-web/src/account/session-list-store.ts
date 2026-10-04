import { errorMessage } from '@velin/contracts/error-copy'
import { normalizeSessions } from './session-data.ts'
import type { WebSessionInfo } from './session-data.ts'

type ApiResult = { data?: unknown; error?: unknown }
type SessionApi = {
  list: (signal: AbortSignal) => Promise<ApiResult>
  revoke: (token: string) => Promise<ApiResult>
  revokeOthers: () => Promise<ApiResult>
}

export function createSessionList(api: SessionApi) {
  let generation = 0
  let readVersion = 0
  let readController: AbortController | null = null
  let currentToken: string | null = null
  let snapshot = {
    userId: null as string | null,
    sessions: null as WebSessionInfo[] | null,
    loading: false,
    pending: null as string | null,
    error: null as string | null,
  }
  const listeners = new Set<() => void>()
  function update(patch: Partial<typeof snapshot>) {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach((listener) => listener())
  }

  async function reload() {
    if (!snapshot.userId) return
    const accountGeneration = generation
    const version = ++readVersion
    readController?.abort()
    const controller = new AbortController()
    readController = controller
    update({ loading: true, error: null })
    try {
      const result = await api.list(controller.signal)
      if (result.error) throw result.error
      const sessions = normalizeSessions(result.data, currentToken)
      if (generation === accountGeneration && version === readVersion) {
        update({ sessions })
      }
    } catch {
      if (generation === accountGeneration && version === readVersion) {
        update({ error: '读取登录设备失败，请稍后重试。' })
      }
    } finally {
      if (generation === accountGeneration && version === readVersion) {
        readController = null
        update({ loading: false })
      }
    }
  }

  function deactivate() {
    generation += 1
    readVersion += 1
    readController?.abort()
    readController = null
    currentToken = null
    update({
      userId: null,
      sessions: null,
      loading: false,
      pending: null,
      error: null,
    })
  }

  function selectAccount(userId: string | null, token: string | null) {
    deactivate()
    currentToken = token
    update({ userId })
    return reload()
  }

  async function revoke(token: string | null) {
    if (!snapshot.userId || snapshot.pending || snapshot.loading) return false
    if (
      !snapshot.sessions ||
      !snapshot.sessions.some(
        (item) => !item.isCurrent && (!token || item.token === token),
      )
    )
      return false
    const accountGeneration = generation
    const key = token ? `revoke:${token}` : 'others'
    update({ pending: key, error: null })
    try {
      const result = token ? await api.revoke(token) : await api.revokeOthers()
      if (result.error) throw result.error
      if (generation !== accountGeneration) return false
      // 写入成功后先反映已知结果；后续读取失败仍明确显示，不能恢复已退出设备。
      update({
        sessions:
          snapshot.sessions?.filter((item) =>
            token ? item.token !== token : item.isCurrent,
          ) ?? null,
      })
      await reload()
      if (generation === accountGeneration && snapshot.error) {
        update({ error: '设备已退出，但刷新列表失败，请重新读取。' })
      }
      return true
    } catch (cause) {
      if (generation === accountGeneration) {
        update({ error: errorMessage(cause, '退出设备失败，请稍后重试。') })
      }
      return false
    } finally {
      if (generation === accountGeneration) update({ pending: null })
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    selectAccount,
    deactivate,
    reload,
    revoke,
  }
}
