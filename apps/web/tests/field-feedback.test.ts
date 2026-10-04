import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authFeedback } from '../src/components/auth/field-feedback.ts'
import { createAuthActionRunner } from '../src/components/auth/auth-action.ts'
import type { AuthFeedback } from '../src/components/auth/field-feedback.ts'

test('field errors preserve server semantics and target the matching credential', () => {
  assert.deepEqual(
    authFeedback('请输入有效的邮箱地址。', { code: 'INVALID_EMAIL' }),
    {
      field: 'email',
      message: '请输入有效的邮箱地址。',
    },
  )
  assert.equal(
    authFeedback('已注册', { code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' })
      .field,
    'email',
  )
  assert.deepEqual(
    authFeedback('邮箱或密码不正确。', { code: 'INVALID_EMAIL_OR_PASSWORD' }),
    {
      field: 'password',
      message: '邮箱或密码不正确。',
    },
  )
  assert.equal(
    authFeedback('密码错误', { code: 'INVALID_PASSWORD' }).field,
    'password',
  )
  assert.equal(authFeedback('验证码过期', { code: 'OTP_EXPIRED' }).field, 'otp')
  assert.equal(
    authFeedback('恢复码错误', { code: 'INVALID_BACKUP_CODE' }).field,
    'otp',
  )
})

test('connection and rate limit failures remain general form feedback', () => {
  for (const cause of [
    new TypeError('Failed to fetch'),
    { code: 'TOO_MANY_REQUESTS' },
    null,
  ]) {
    assert.equal(authFeedback('请稍后重试。', cause).field, null)
  }
})

test('action errors keep the original server code alongside localized feedback', async () => {
  let feedback: AuthFeedback | null = null
  const runner = createAuthActionRunner({
    onPending() {},
    onError: (message, cause) => {
      feedback = authFeedback(message, cause)
    },
  })
  runner.activate()
  await runner.run(async (action) => {
    await action.result(
      Promise.resolve({
        data: null,
        error: {
          code: 'INVALID_EMAIL_OR_PASSWORD',
          message: 'Invalid email or password',
        },
      }),
    )
  }, '登录失败。')
  assert.deepEqual(feedback, {
    field: 'password',
    message: '邮箱或密码不正确。',
  })
  runner.deactivate()
})
