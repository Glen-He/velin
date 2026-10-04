import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAuthActionRunner } from '../src/components/auth/auth-action.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture() {
  const pending: boolean[] = []
  const errors: string[] = []
  const runner = createAuthActionRunner({
    onPending: (value) => pending.push(value),
    onError: (value) => errors.push(value),
  })
  runner.activate()
  return { runner, pending, errors }
}

test('authentication actions block overlapping login methods and release occupancy after success', async () => {
  const { runner, pending, errors } = fixture()
  const response = deferred<void>()
  let calls = 0
  const first = runner.run(async (action) => {
    calls++
    await action.wait(response.promise)
  }, '登录失败。')
  await runner.run(async () => {
    calls++
  }, '验证失败。')
  assert.equal(calls, 1)
  assert.ok(runner.isPending())
  response.resolve()
  await first
  assert.deepEqual(pending, [true, false])
  assert.deepEqual(errors, [])
  assert.equal(runner.isPending(), false)
})

test('auth API error objects remain localized and the next attempt can retry', async () => {
  const { runner, errors } = fixture()
  let advanced = false
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
    advanced = true
  }, '登录失败。')
  assert.equal(advanced, false)
  assert.deepEqual(errors, ['邮箱或密码不正确。'])
  await runner.run(async (action) => {
    assert.equal(
      await action.result(Promise.resolve({ data: 'success' })),
      'success',
    )
    advanced = true
  }, '登录失败。')
  assert.ok(advanced)
})

test('unknown diagnostics use the localized fallback instead of exposing transport errors', async () => {
  const { runner, errors } = fixture()
  await runner.run(async () => {
    throw new TypeError('Failed to fetch')
  }, '无法连接服务，请重试。')
  assert.deepEqual(errors, ['无法连接服务，请重试。'])
  assert.equal(runner.isPending(), false)
})

test('leaving the page cancels transport and prevents a late result from starting token exchange', async () => {
  const { runner, pending, errors } = fixture()
  const response = deferred<{ data: string }>()
  let signal!: AbortSignal
  let exchanged = false
  const old = runner.run(async (action) => {
    signal = action.signal
    await action.result(response.promise)
    exchanged = true
  }, '登录失败。')
  runner.deactivate()
  assert.ok(signal.aborted)
  response.resolve({ data: 'late' })
  await old
  assert.equal(exchanged, false)
  assert.deepEqual(errors, [])
  assert.deepEqual(pending, [true])
})

test('Strict Mode cleanup and reactivation do not let an old completion release a new request', async () => {
  const { runner, pending } = fixture()
  const first = deferred<void>()
  const second = deferred<void>()
  const old = runner.run(async (action) => {
    await action.wait(first.promise)
  }, '登录失败。')
  runner.deactivate()
  runner.activate()
  const current = runner.run(async (action) => {
    await action.wait(second.promise)
  }, '登录失败。')
  first.resolve()
  await old
  assert.ok(runner.isPending())
  assert.deepEqual(pending, [true, true])
  second.resolve()
  await current
  assert.deepEqual(pending, [true, true, false])
})

test('inactive authentication pages cannot submit requests', async () => {
  const { runner, pending } = fixture()
  runner.deactivate()
  let started = false
  await runner.run(async () => {
    started = true
  }, '登录失败。')
  assert.equal(started, false)
  assert.deepEqual(pending, [])
})
