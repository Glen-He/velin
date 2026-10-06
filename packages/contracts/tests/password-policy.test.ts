import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isValidNewPassword,
  passwordPolicy,
  newPasswordError,
} from '@velin/contracts/policy'

test('new passwords retain the product length range across all entry points', () => {
  assert.deepEqual(passwordPolicy, { minimum: 8, maximum: 32 })
  assert.equal(isValidNewPassword('a'.repeat(7)), false)
  assert.equal(isValidNewPassword('a'.repeat(8)), true)
  assert.equal(isValidNewPassword('a'.repeat(32)), true)
  assert.equal(isValidNewPassword('a'.repeat(33)), false)
  assert.match(newPasswordError('short'), /8–32/)
})

test('passwords allow printable English characters and reject non-English or whitespace', () => {
  for (const value of ['Abc123!?', 'a'.repeat(8), '12345678', '!@#$%^&*']) {
    assert.equal(isValidNewPassword(value), true)
  }
  for (const value of [
    '中文密码测试八位',
    'password中文',
    '🔐'.repeat(8),
    'test pass phrase',
    ' testpass',
    'testpass ',
    'test\npass',
    'test\tpass',
    'test\u00a0pass',
    'test\u200bpass',
  ]) {
    assert.equal(isValidNewPassword(value), false, JSON.stringify(value))
  }
})
