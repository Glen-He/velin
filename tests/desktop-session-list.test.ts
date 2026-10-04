import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DesktopSession } from '@velin/contracts/auth-protocol'
import { createDesktopSessionList } from '../src/features/account/session-list-store.ts'
const sessions: DesktopSession[] = ['current', 'other'].map((id) => ({
  id,
  isCurrent: id === 'current',
  ipAddress: null,
  userAgent: null,
  createdAt: '2026-10-04T00:00:00Z',
  updatedAt: '2026-10-04T00:00:00Z',
  expiresAt: '2026-10-05T00:00:00Z',
}))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
test('desktop list failures are retryable and close invalidates old reads', async () => {
  let calls = 0
  const store = createDesktopSessionList({
    listSessions: async () => {
      if (++calls === 1) throw new Error('offline')
      return sessions
    },
    revokeSession: async () => {},
    revokeOtherSessions: async () => {},
  })
  await store.activate()
  assert.equal(store.getSnapshot().sessions, null)
  assert.ok(store.getSnapshot().error)
  assert.equal(store.getSnapshot().loading, false)
  await store.reload()
  assert.deepEqual(store.getSnapshot().sessions, sessions)
  assert.equal(store.getSnapshot().error, null)
  const late = deferred<DesktopSession[]>()
  const closed = createDesktopSessionList({
    listSessions: () => late.promise,
    revokeSession: async () => {},
    revokeOtherSessions: async () => {},
  })
  const read = closed.activate()
  closed.deactivate()
  late.resolve(sessions)
  await read
  assert.equal(closed.getSnapshot().sessions, null)
})
test('desktop revocation excludes current device and serializes single and bulk writes', async () => {
  const operation = deferred<void>()
  let writes = 0
  const store = createDesktopSessionList({
    listSessions: async () => sessions,
    revokeSession: () => {
      writes++
      return operation.promise
    },
    revokeOtherSessions: async () => {
      writes++
    },
  })
  await store.activate()
  await store.revoke('current')
  assert.equal(writes, 0)
  const first = store.revoke('other')
  await store.revoke('other')
  await store.revoke(null)
  assert.equal(writes, 1)
  operation.resolve()
  await first
  assert.equal(store.getSnapshot().pending, null)
})
test('bulk revocation preserves known success when refresh fails', async () => {
  let reads = 0
  const store = createDesktopSessionList({
    listSessions: async () => {
      if (++reads > 1) throw new Error('offline')
      return sessions
    },
    revokeSession: async () => {},
    revokeOtherSessions: async () => {},
  })
  await store.activate()
  await store.revoke(null)
  assert.deepEqual(
    store.getSnapshot().sessions?.map((item) => item.id),
    ['current'],
  )
  assert.match(store.getSnapshot().error!, /已退出.*刷新列表失败/)
  assert.equal(store.getSnapshot().pending, null)
})
test('closing and reopening while a write is pending rejects its old result', async () => {
  const operation = deferred<void>()
  const store = createDesktopSessionList({
    listSessions: async () => sessions,
    revokeSession: () => operation.promise,
    revokeOtherSessions: async () => {},
  })
  await store.activate()
  const pending = store.revoke('other')
  store.deactivate()
  await store.activate()
  operation.resolve()
  await pending
  assert.deepEqual(store.getSnapshot().sessions, sessions)
  assert.equal(store.getSnapshot().error, null)
})

test('failed revocation keeps devices and returns a failure for the confirmation card', async () => {
  const store = createDesktopSessionList({
    listSessions: async () => sessions,
    revokeSession: async () => {
      throw new Error('offline')
    },
    revokeOtherSessions: async () => {},
  })
  await store.activate()
  assert.equal(await store.revoke('other'), false)
  assert.deepEqual(store.getSnapshot().sessions, sessions)
  assert.ok(store.getSnapshot().error)
  assert.equal(await store.revoke(null), true)
})
