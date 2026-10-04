import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAuthStateSync } from '../electron/auth/auth-state-sync.ts'
import type { AuthState, AuthUser } from '@velin/contracts/auth-protocol'
import { createAuthClient } from 'better-auth/client'
const user: AuthUser = {
  id: 'old',
  name: 'old',
  email: 'old@example.test',
  image: null,
  emailVerified: true,
  twoFactorEnabled: false,
}
function deferred() {
  let resolve!: (value: AuthUser | null) => void
  const promise = new Promise<AuthUser | null>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
test('late refresh cannot restore an expired or signed-out account', async () => {
  for (const state of [
    { user: null },
    { user: null, reason: 'session-expired' },
  ] satisfies AuthState[]) {
    const read = deferred()
    const events: AuthState[] = []
    const sync = createAuthStateSync(
      () => read.promise,
      (event) => events.push(event),
    )
    const pending = sync.refresh()
    sync.emit(state)
    read.resolve(user)
    await pending
    assert.deepEqual(events, [state])
  }
})
test('only latest refresh wins and explicit account changes outrank reads', async () => {
  const reads = [deferred(), deferred()]
  const events: AuthState[] = []
  let index = 0
  const sync = createAuthStateSync(
    () => reads[index++].promise,
    (event) => events.push(event),
  )
  const first = sync.refresh()
  const second = sync.refresh()
  reads[1].resolve(null)
  await second
  reads[0].resolve(user)
  await first
  assert.deepEqual(events, [{ user: null }])
  const late = deferred()
  const accountSync = createAuthStateSync(
    () => late.promise,
    (event) => events.push(event),
  )
  const pending = accountSync.refresh()
  accountSync.emit({ user: { ...user, id: 'new' } })
  late.resolve(user)
  await pending
  assert.equal(events.at(-1)?.user?.id, 'new')
})
test('background read failures preserve state while real signed-out results publish', async () => {
  const events: AuthState[] = []
  const sync = createAuthStateSync(
    async () => {
      throw new Error('offline')
    },
    (event) => events.push(event),
  )
  sync.emit({ user })
  await sync.refresh()
  assert.deepEqual(events, [{ user }])
})

test('Better Auth per-request success callbacks retain the global lifecycle observer', async () => {
  const events: string[] = []
  const client = createAuthClient({
    baseURL: 'http://localhost:3000',
    fetchOptions: {
      customFetchImpl: async () => Response.json({ user }),
      onSuccess(context) {
        assert.ok(
          new URL(context.request.url).pathname.endsWith('/electron/token'),
        )
        assert.equal(context.data.user.id, user.id)
        events.push('global')
      },
    },
  })
  // Electron 授权动作提供独立 onSuccess；它不能遮蔽统一的状态发布入口。
  const result = await client.$fetch('/electron/token', {
    method: 'POST',
    body: {},
    onSuccess() {
      events.push('request')
    },
  })
  assert.equal(result.error, null)
  assert.deepEqual([...events].sort(), ['global', 'request'])
})
