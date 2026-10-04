import { errorMessage } from '@velin/contracts/error-copy'
import type { DesktopSession } from '@velin/contracts/auth-protocol'
import type { VelinApi } from '@velin/contracts/velin-api'

type SessionGateway = Pick<
  VelinApi['auth'],
  'listSessions' | 'revokeSession' | 'revokeOtherSessions'
>

// IPC 不提供取消句柄；按弹窗生命周期和读取序号丢弃迟到结果。
export function createDesktopSessionList(gateway: SessionGateway) {
  let active = false
  let generation = 0
  let readVersion = 0
  let snapshot = {
    sessions: null as DesktopSession[] | null,
    loading: false,
    pending: null as string | null,
    error: null as string | null,
  }
  const listeners = new Set<() => void>()
  function update(patch: Partial<typeof snapshot>) {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach((listener) => listener())
  }
  async function read() {
    if (!active) return
    const scope = generation
    const version = ++readVersion
    update({ loading: true, error: null })
    try {
      const sessions = await gateway.listSessions()
      if (active && generation === scope && version === readVersion) {
        update({ sessions })
      }
    } catch (cause) {
      if (active && generation === scope && version === readVersion) {
        update({ error: errorMessage(cause, '读取登录设备失败，请稍后重试。') })
      }
    } finally {
      if (active && generation === scope && version === readVersion) {
        update({ loading: false })
      }
    }
  }
  function deactivate() {
    active = false
    generation += 1
    readVersion += 1
    update({ sessions: null, loading: false, pending: null, error: null })
  }
  async function revoke(sessionId: string | null) {
    if (!active || snapshot.pending || snapshot.loading || !snapshot.sessions)
      return false
    if (
      sessionId &&
      !snapshot.sessions.some(
        (item) => item.id === sessionId && !item.isCurrent,
      )
    )
      return false
    if (!sessionId && !snapshot.sessions.some((item) => !item.isCurrent))
      return false
    const scope = generation
    update({ pending: sessionId ?? 'others', error: null })
    try {
      if (sessionId) await gateway.revokeSession(sessionId)
      else await gateway.revokeOtherSessions()
      if (!active || generation !== scope) return false
      // 写入成功即反映已知结果；刷新失败不能把已退出设备重新显示为有效会话。
      update({
        sessions:
          snapshot.sessions?.filter((item) =>
            sessionId ? item.id !== sessionId : item.isCurrent,
          ) ?? null,
      })
      await read()
      if (active && generation === scope && snapshot.error) {
        update({ error: '设备已退出，但刷新列表失败，请重新读取。' })
      }
      return true
    } catch (cause) {
      if (active && generation === scope) {
        update({ error: errorMessage(cause, '退出设备失败，请稍后重试。') })
      }
      return false
    } finally {
      if (active && generation === scope) update({ pending: null })
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
    activate() {
      deactivate()
      active = true
      return read()
    },
    deactivate,
    reload() {
      return snapshot.pending ? Promise.resolve() : read()
    },
    revoke,
  }
}
