import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import {
  accountInitial,
  ownedAvatarPath,
  resolveOwnedAvatarUrl,
} from '@velin/contracts/avatar'
import { fetchOwnedAvatarImage } from '../src/main/auth/avatar-request.ts'
import { createAvatarCache } from '../src/renderer/features/account/avatar-cache.ts'

const path = '/api/avatars/abcdefghijklmnop?v=123'
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 0])

test('owned avatar references use canonical relative paths without legacy URL support', () => {
  assert.equal(ownedAvatarPath(path), path)
  assert.equal(
    resolveOwnedAvatarUrl(path, 'https://api.example.test'),
    `https://api.example.test${path}`,
  )
  for (const source of [
    `https://api.example.test${path}`,
    `http://localhost:3000${path}`,
    `//api.example.test${path}`,
    ` ${path}`,
    `${path}#fragment`,
    `${path}&v=124`,
    `${path}&other=1`,
    '/api/avatars/short',
    '/api/avatars/old/../abcdefghijklmnop',
    '/api/avatars/abcdefghijklmnop?v=text',
  ])
    assert.equal(ownedAvatarPath(source), null, source)
  assert.equal(accountInitial(' 🪐测试', 'test@example.test'), '🪐')
  assert.equal(accountInitial('', 'test@example.test'), 'T')
})

test('avatar transport does not send credentials or follow redirects', async () => {
  const bytes = await fetchOwnedAvatarImage(
    path,
    'https://api.example.test',
    async (url, options) => {
      assert.equal(url, `https://api.example.test${path}`)
      assert.equal(options?.credentials, 'omit')
      assert.equal(options?.redirect, 'error')
      assert.equal(options?.headers, undefined)
      assert.ok(options?.signal)
      return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } })
    },
  )
  assert.deepEqual(bytes, jpeg)
  let called = false
  await assert.rejects(
    fetchOwnedAvatarImage(
      `https://api.example.test${path}`,
      'https://api.example.test',
      async () => {
        called = true
        return new Response(jpeg)
      },
    ),
    /地址无效/,
  )
  assert.equal(called, false)
})

test('avatar reads bound actual bytes and cancel rejected bodies', async () => {
  for (const contentType of ['image/jpeg', 'text/html']) {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(512 * 1024 + 1))
      },
      cancel() {
        cancelled = true
      },
    })
    await assert.rejects(
      fetchOwnedAvatarImage(
        path,
        'https://api.example.test',
        async () =>
          new Response(body, {
            headers: { 'content-type': contentType, 'content-length': '6' },
          }),
      ),
    )
    assert.equal(cancelled, true)
  }
  await assert.rejects(
    fetchOwnedAvatarImage(
      path,
      'https://api.example.test',
      async () =>
        new Response('invalid', { headers: { 'content-type': 'image/jpeg' } }),
    ),
    /格式无效/,
  )
})

test('avatar cache shares a live resource and revokes it after the final consumer leaves', async () => {
  let loads = 0
  const revoked: string[] = []
  const cache = createAvatarCache({
    load: async () => {
      loads++
      return jpeg
    },
    create: () => 'blob:avatar',
    revoke: (url) => revoked.push(url),
  })
  const first = cache.acquire('user:image', path)
  first.release()
  const second = cache.acquire('user:image', path)
  const third = cache.acquire('user:image', path)
  assert.equal(await second.pending, 'blob:avatar')
  third.release()
  third.release()
  await delay(10)
  assert.deepEqual(revoked, [])
  second.release()
  await delay(10)
  assert.deepEqual(revoked, ['blob:avatar'])
  assert.equal(loads, 1)
})

test('a late avatar read cannot create a resource after all consumers have left', async () => {
  let resolve!: (value: Uint8Array) => void
  let created = 0
  const cache = createAvatarCache({
    load: () =>
      new Promise((done) => {
        resolve = done
      }),
    create: () => {
      created++
      return 'blob:late'
    },
    revoke: () => {},
  })
  const handle = cache.acquire('old-user:image', path)
  handle.release()
  await delay(10)
  resolve(jpeg)
  assert.equal(await handle.pending, null)
  assert.equal(created, 0)
})

test('failed avatar reads can be retried without an old release deleting the retry', async () => {
  let loads = 0
  const cache = createAvatarCache({
    load: async () => {
      if (++loads === 1) throw new Error('failed')
      return jpeg
    },
    create: () => 'blob:retry',
    revoke: () => {},
  })
  const first = cache.acquire('user:image', path)
  await assert.rejects(first.pending)
  const retry = cache.acquire('user:image', path)
  first.release()
  await delay(10)
  const concurrent = cache.acquire('user:image', path)
  assert.equal(await retry.pending, 'blob:retry')
  assert.equal(await concurrent.pending, 'blob:retry')
  assert.equal(loads, 2)
  retry.release()
  concurrent.release()
})
