import { useEffect, useState, useSyncExternalStore } from 'react'
import { authClient } from '../../lib/auth/client'
import { createSessionList } from './session-list-store'

export function useSessions(
  userId: string | null,
  currentToken: string | null,
) {
  const [store] = useState(() =>
    createSessionList({
      list: (signal) => authClient.listSessions({ fetchOptions: { signal } }),
      revoke: (token) => authClient.revokeSession({ token }),
      revokeOthers: () => authClient.revokeOtherSessions(),
    }),
  )
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  )
  useEffect(() => {
    void store.selectAccount(userId, currentToken)
    return store.deactivate
  }, [currentToken, store, userId])
  // 账号切换的 render 先隐藏旧列表，Effect 再取消旧请求并选择新账号。
  const selected = state.userId === userId
  return {
    sessions: selected ? state.sessions : null,
    error: selected ? state.error : null,
    busy: !selected || state.loading || state.pending !== null,
    pending: selected ? state.pending : null,
    reload: store.reload,
    async revoke(token: string | null) {
      if (!(await store.revoke(token)))
        throw new Error(
          store.getSnapshot().error ?? '设备状态已变化，请重新读取后重试。',
        )
    },
  }
}
