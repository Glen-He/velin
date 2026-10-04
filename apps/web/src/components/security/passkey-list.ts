import { useEffect, useState, useSyncExternalStore } from 'react'
import { authClient } from '../../lib/auth/client'
import { createPasskeyList } from './passkey-list-store'
export type { PasskeyInfo } from './passkey-data'

export function usePasskeyList(userId: string | null) {
  const [store] = useState(() =>
    createPasskeyList((signal) =>
      authClient.passkey.listUserPasskeys({ fetchOptions: { signal } }),
    ),
  )
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  )
  useEffect(() => {
    void store.selectAccount(userId)
    return store.deactivate
  }, [store, userId])
  const selected = state.userId === userId
  return {
    passkeys: selected ? state.passkeys : null,
    error: selected ? state.error : null,
    refresh: store.refresh,
  }
}
