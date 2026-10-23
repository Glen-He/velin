import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCredentialScope } from '../src/main/auth/request-scope'
import { protectedStorage } from '../src/main/auth/protected-storage'

test('credential scope rejects account changes and returning to the same cookie', () => {
  let cookie = 'account-a'
  const scope = createCredentialScope(() => cookie)
  const a = scope.capture()
  cookie = 'account-b'
  assert.equal(a.isCurrent(), false)
  scope.invalidate()
  cookie = 'account-a'
  assert.equal(a.isCurrent(), false)
  assert.equal(scope.capture().isCurrent(), true)
})

test('unavailable secure storage removes persisted secrets and uses memory', () => {
  const disk = new Map<string, unknown>([['session', 'old-secret']])
  const store = protectedStorage(
    {
      getItem: (key) => disk.get(key) ?? null,
      setItem: (key, value) => {
        disk.set(key, value)
      },
    },
    () => false,
  )
  assert.equal(store.getItem('session'), null)
  assert.equal(disk.get('session'), null)
  store.setItem('session', 'current-secret')
  assert.equal(disk.get('session'), null)
  assert.equal(store.getItem('session'), 'current-secret')
  store.setItem('session', null)
  assert.equal(store.getItem('session'), null)
})
