import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { avatarLimits } from '@velin/contracts/policy'
import { limitRequestBody } from '../src/lib/http/body-limit'

function fixture() {
  let parsed = 0
  const handle = async (request: Request) => {
    const bounded = await limitRequestBody(request)
    if (bounded instanceof Response) return bounded
    parsed++
    return Response.json({ size: (await bounded.arrayBuffer()).byteLength })
  }
  const app = {
    request(input: string | Request, init?: RequestInit) {
      return handle(
        typeof input === 'string'
          ? new Request(new URL(input, 'http://localhost'), init)
          : input,
      )
    },
  }
  return { app, handle, parsed: () => parsed }
}
test('body limits measure bytes with absent or misleading length headers before parsing', async () => {
  for (const headers of [
    new Headers(),
    new Headers({ 'content-length': '2' }),
  ]) {
    const { app, parsed } = fixture()
    const response = await app.request('/api/avatars', {
      method: 'POST',
      headers,
      body: new Uint8Array(avatarLimits.uploadBytes + 1),
    })
    assert.equal(response.status, 413)
    assert.equal(parsed(), 0)
    assert.equal((await response.json()).error, 'payload_too_large')
  }
})
test('body budget admits exact boundary and rejects oversized JSON requests', async () => {
  const { app, parsed } = fixture()
  const allowed = await app.request('/api/avatars', {
    method: 'POST',
    body: new Uint8Array(avatarLimits.uploadBytes),
  })
  assert.equal(allowed.status, 200)
  assert.equal((await allowed.json()).size, avatarLimits.uploadBytes)
  const large = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    body: new Uint8Array(1024 * 1024 + 1),
  })
  assert.equal(large.status, 413)
  assert.equal(parsed(), 1)
})
test('chunked over-budget body cancels its stream without invoking the handler', async () => {
  const { app, parsed } = fixture()
  let cancelled = false
  let parts = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      parts++
      controller.enqueue(new Uint8Array(128 * 1024))
    },
    cancel() {
      cancelled = true
    },
  })
  const request = new Request('http://localhost/api/avatars', {
    method: 'POST',
    body,
    duplex: 'half',
  } as RequestInit)
  assert.equal((await app.request(request)).status, 413)
  assert.equal(cancelled, true)
  assert.ok(parts <= 6)
  assert.equal(parsed(), 0)
})
test('actual HTTP chunked upload receives a localized 413 and preserves normal requests', async () => {
  const { handle, parsed } = fixture()
  const server = createServer(async (incoming, outgoing) => {
    const headers = new Headers()
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value)
        headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    }
    const request = new Request(new URL(incoming.url!, 'http://localhost'), {
      method: incoming.method,
      headers,
      body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
      duplex: 'half',
    } as RequestInit)
    const response = await handle(request)
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    outgoing.end(Buffer.from(await response.arrayBuffer()))
  }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const url = `http://127.0.0.1:${address.port}`
  try {
    let parts = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (++parts <= 20) controller.enqueue(new Uint8Array(64 * 1024))
        else controller.close()
      },
    })
    const result = await fetch(`${url}/api/avatars`, {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)
    assert.equal(result.status, 413)
    assert.match((await result.json()).message, /请求内容过大/)
    assert.equal(parsed(), 0)
    const next = await fetch(`${url}/api/auth/test`, {
      method: 'POST',
      body: 'ok',
    })
    assert.equal(next.status, 200)
    assert.deepEqual(await next.json(), { size: 2 })
  } finally {
    if ('closeAllConnections' in server) server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
