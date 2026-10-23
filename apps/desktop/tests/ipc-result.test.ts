import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UserFacingError } from '@velin/contracts/error-copy'
import { executeIpc } from '../src/main/ipc-result'

test('IPC transport preserves successful values and void actions', async () => {
  const report = () => assert.fail('success cannot log a failure')
  assert.deepEqual(await executeIpc(() => ({ user: null }), report), {
    ok: true,
    value: { user: null },
  })
  assert.deepEqual(await executeIpc(() => {}, report), {
    ok: true,
    value: undefined,
  })
})

test('IPC errors never serialize diagnostic objects or arbitrary Chinese messages', async () => {
  const names: string[] = []
  const diagnostic = Object.assign(new Error('密码 secret-token'), {
    cookie: 'private-cookie',
    cause: { password: 'private-password' },
  })
  const result = await executeIpc(
    () => {
      throw diagnostic
    },
    (name) => names.push(name),
  )
  assert.deepEqual(names, ['Error'])
  assert.deepEqual(result, {
    ok: false,
    error: { message: '操作暂时无法完成，请稍后重试。' },
  })
  assert.doesNotMatch(
    JSON.stringify(result),
    /secret-token|private-|cause|cookie/,
  )
  assert.deepEqual(
    await executeIpc(
      () => {
        throw new UserFacingError('请先登录后再发送消息。')
      },
      () => {},
    ),
    { ok: false, error: { message: '请先登录后再发送消息。' } },
  )
})
