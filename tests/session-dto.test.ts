import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toDesktopSessions } from '../electron/auth/session-dto.ts'

test('desktop DTO never carries upstream tokens or unexpected fields', () => {
  const rows = toDesktopSessions(
    [
      {
        id: 'device',
        token: 'bearer-secret',
        refreshToken: 'unexpected-secret',
        createdAt: 'invalid-date',
      },
    ],
    'bearer-secret',
    { name: 'Velin', version: 'test', osName: 'macOS' },
  )
  assert.equal(rows[0].id, 'device')
  assert.equal(rows[0].isCurrent, true)
  assert.equal(rows[0].createdAt, '')
  assert.equal(JSON.stringify(rows).includes('secret'), false)
  assert.equal('token' in rows[0], false)
  assert.equal('refreshToken' in rows[0], false)
})
test('malformed device data is distinct from an empty list', () => {
  const metadata = { name: 'Velin', version: 'test', osName: 'macOS' }
  assert.throws(() => toDesktopSessions(null, null, metadata))
  assert.deepEqual(toDesktopSessions([], null, metadata), [])
  assert.throws(() =>
    toDesktopSessions([{ token: 'missing-id' }], null, metadata),
  )
})

test('ambiguous device identities cannot expose current-device revocation controls', () => {
  const metadata = { name: 'Velin', version: 'test', osName: 'macOS' }
  const current = { id: 'current', token: 'current-token' }
  assert.throws(
    () => toDesktopSessions([current], null, metadata),
    /当前登录设备/,
  )
  assert.throws(
    () => toDesktopSessions([current], 'unmatched-token', metadata),
    /当前登录设备/,
  )
  for (const other of [
    { id: current.id, token: 'other-token' },
    { id: 'other', token: current.token },
  ]) {
    assert.throws(() =>
      toDesktopSessions([current, other], current.token, metadata),
    )
  }
})
