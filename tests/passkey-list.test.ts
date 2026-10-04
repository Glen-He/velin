import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPasskeyList } from '../apps/auth-web/src/security/passkey-list-store.ts'

test('passkey lists distinguish malformed data from a successful empty result', async () => {
  for (const data of [
    null,
    {},
    [{ id: '' }],
    [{ id: 'same' }, { id: 'same' }],
  ]) {
    const store = createPasskeyList(async () => ({ data }))
    await store.selectAccount('user')
    assert.equal(store.getSnapshot().passkeys, null)
    assert.ok(store.getSnapshot().error)
  }
  const store = createPasskeyList(async () => ({ data: [] }))
  await store.selectAccount('user')
  assert.deepEqual(store.getSnapshot().passkeys, [])
  assert.equal(store.getSnapshot().error, null)
})

test('passkey reads abort on account changes and ignore late results', async () => {
  let resolve!: (value: { data: unknown }) => void
  const signals: AbortSignal[] = []
  const store = createPasskeyList((signal) => {
    signals.push(signal)
    return signals.length === 1
      ? new Promise((done) => {
          resolve = done
        })
      : Promise.resolve({ data: [] })
  })
  await store.selectAccount(null)
  assert.equal(signals.length, 0)
  const old = store.selectAccount('old')
  await store.selectAccount('new')
  resolve({ data: [{ id: 'old-key' }] })
  await old
  assert.ok(signals[0].aborted)
  assert.equal(store.getSnapshot().userId, 'new')
  assert.deepEqual(store.getSnapshot().passkeys, [])
  store.deactivate()
  assert.equal(store.getSnapshot().passkeys, null)
})

test('failed refreshes preserve known passkeys while exposing a localized error', async () => {
  let reads = 0
  const store = createPasskeyList(async () =>
    ++reads === 1
      ? { data: [{ id: 'key', name: '我的密钥' }] }
      : { error: new Error('Failed to fetch') },
  )
  await store.selectAccount('user')
  await store.refresh()
  assert.equal(store.getSnapshot().passkeys?.[0].id, 'key')
  assert.match(store.getSnapshot().error!, /读取通行密钥失败/)
})
