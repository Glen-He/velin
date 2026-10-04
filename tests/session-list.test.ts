import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSessionList } from '../apps/auth-web/src/account/session-list-store.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const success = { data: [{ token: 'current' }, { token: 'other' }] }

test('API errors and malformed payloads show failure instead of an empty list', async () => {
  for (const result of [{ error: { message: 'failed' } }, { data: null }]) {
    const store = createSessionList({
      list: async () => result,
      revoke: async () => ({}),
      revokeOthers: async () => ({}),
    })
    await store.selectAccount('user', 'current')
    assert.equal(store.getSnapshot().sessions, null)
    assert.ok(store.getSnapshot().error)
    assert.equal(store.getSnapshot().loading, false)
  }
})

test('account changes cancel reads and ignore late results from the previous account', async () => {
  const first = deferred<typeof success>()
  const signals: AbortSignal[] = []
  const store = createSessionList({
    list: (signal) => {
      signals.push(signal)
      return signals.length === 1
        ? first.promise
        : Promise.resolve({ data: [] })
    },
    revoke: async () => ({}),
    revokeOthers: async () => ({}),
  })
  const old = store.selectAccount('old-user', 'current')
  await store.selectAccount('new-user', 'new-token')
  first.resolve(success)
  await old
  assert.equal(signals[0].aborted, true)
  assert.equal(store.getSnapshot().userId, 'new-user')
  assert.deepEqual(store.getSnapshot().sessions, [])
})

test('newer reads win even when older transports disregard cancellation', async () => {
  const first = deferred<typeof success>()
  let reads = 0
  const store = createSessionList({
    list: async () => (++reads === 1 ? first.promise : { data: [] }),
    revoke: async () => ({}),
    revokeOthers: async () => ({}),
  })
  const old = store.selectAccount('user', 'current')
  await store.reload()
  first.resolve(success)
  await old
  assert.deepEqual(store.getSnapshot().sessions, [])
})

test('duplicate mutations are blocked and successful revocation survives a failed refresh', async () => {
  const mutation = deferred<{ data: null }>()
  let reads = 0
  let writes = 0
  const store = createSessionList({
    list: async () =>
      ++reads === 1 ? success : { error: new Error('Network failed') },
    revoke: () => {
      writes += 1
      return mutation.promise
    },
    revokeOthers: async () => ({}),
  })
  await store.selectAccount('user', 'current')
  const first = store.revoke('other')
  await store.revoke('other')
  mutation.resolve({ data: null })
  await first
  assert.equal(writes, 1)
  assert.deepEqual(
    store.getSnapshot().sessions?.map((item) => item.token),
    ['current'],
  )
  assert.match(store.getSnapshot().error!, /已退出.*刷新列表失败/)
  assert.equal(store.getSnapshot().pending, null)
})

test('a late mutation cannot alter the new account or clear its pending operation', async () => {
  const first = deferred<{ data: null }>()
  const second = deferred<{ data: null }>()
  let writes = 0
  const store = createSessionList({
    list: async () => success,
    revoke: () => (++writes === 1 ? first.promise : second.promise),
    revokeOthers: async () => ({}),
  })
  await store.selectAccount('old-user', 'current')
  const old = store.revoke('other')
  await store.selectAccount('new-user', 'current')
  const current = store.revoke('other')
  first.resolve({ data: null })
  await old
  assert.equal(store.getSnapshot().pending, 'revoke:other')
  assert.equal(store.getSnapshot().sessions?.length, 2)
  second.resolve({ data: null })
  await current
  assert.equal(store.getSnapshot().pending, null)
})

test('revocation rejects current or missing devices and distinguishes failure from success', async () => {
  let writes = 0
  const store = createSessionList({
    list: async () => success,
    revoke: async () => {
      writes++
      return { error: new Error('offline') }
    },
    revokeOthers: async () => ({}),
  })
  await store.selectAccount('user', 'current')
  assert.equal(await store.revoke('current'), false)
  assert.equal(await store.revoke('missing'), false)
  assert.equal(writes, 0)
  assert.equal(await store.revoke('other'), false)
  assert.ok(store.getSnapshot().error)
  assert.equal(store.getSnapshot().sessions?.length, 2)
  assert.equal(await store.revoke(null), true)
})
