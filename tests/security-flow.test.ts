import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  initialSecurityHistory,
  securityHistoryReducer,
  usableChannels,
} from '../apps/auth-web/src/security/flow-policy.ts'

test('back navigation preserves every visited step and stops at the dialog entry', () => {
  let history = initialSecurityHistory('changePassword')
  for (const stage of ['methods', 'verify', 'newPassword'] as const)
    history = securityHistoryReducer(history, { type: 'advance', stage })
  assert.deepEqual(history, ['password', 'methods', 'verify', 'newPassword'])
  history = securityHistoryReducer(history, { type: 'back' })
  assert.equal(history.at(-1), 'verify')
  history = securityHistoryReducer(history, { type: 'back' })
  assert.equal(history.at(-1), 'methods')
  history = securityHistoryReducer(history, { type: 'password-route' })
  assert.deepEqual(securityHistoryReducer(history, { type: 'back' }), [
    'password',
  ])
})
test('steps with side effects cannot be rewound', () => {
  for (const stage of ['running', 'backupCodes'] as const) {
    const history = securityHistoryReducer(
      initialSecurityHistory('addPasskey'),
      { type: 'advance', stage },
    )
    assert.equal(securityHistoryReducer(history, { type: 'back' }), history)
  }
})
test('recovery remains available with two-factor enabled; missing factors never appear', () => {
  const methods = ['emailOtp', 'totp', 'backupCode', 'passkey'] as const
  assert.deepEqual(usableChannels(methods, false, true), [
    'emailOtp',
    'totp',
    'backupCode',
  ])
  assert.deepEqual(usableChannels(methods, false, false), ['emailOtp'])
  assert.deepEqual(usableChannels(['passkey'], false, false), [])
  assert.deepEqual(usableChannels(['passkey'], true, false), ['passkey'])
})
