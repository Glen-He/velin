import assert from 'node:assert/strict'
import { test } from 'node:test'
import { errorMessage } from '@velin/contracts/error-copy'
import { normalizeSessions } from '../apps/auth-web/src/account/session-data.ts'

test('display errors use codes, preserve localized feedback and hide unknown diagnostics', () => {
  assert.equal(
    errorMessage({ code: 'INVALID_PASSWORD', message: 'Unknown detail' }),
    '密码不正确，请重新输入。',
  )
  assert.equal(
    errorMessage(new Error('Too many requests')),
    '尝试次数过多，请稍后再试。',
  )
  assert.equal(
    errorMessage(new Error('验证码发送失败，请稍后重试。')),
    '验证码发送失败，请稍后重试。',
  )
  assert.equal(
    errorMessage(new Error('Fetch failed at internal-service')),
    '操作没有完成，请稍后重试。',
  )
  assert.equal(errorMessage(null, '读取失败。'), '读取失败。')
})

test('malformed session responses remain distinct from an empty list', () => {
  assert.deepEqual(normalizeSessions([], null), [])
  assert.throws(() => normalizeSessions(null, null))
  assert.throws(() => normalizeSessions([{ token: '' }], null))
  assert.throws(() => normalizeSessions([{ token: 'valid' }, {}], null))
  assert.equal(
    normalizeSessions([{ token: 'current' }], 'current')[0].isCurrent,
    true,
  )
})
