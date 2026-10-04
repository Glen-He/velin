import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setImmediate as tick } from 'node:timers/promises'
import { test } from 'node:test'
import { ChatStreamRuntime } from '../electron/chat/stream-runtime.ts'
import type {
  ChatEvent,
  SendMessageRequest,
} from '@velin/contracts/chat-protocol'

function request(): SendMessageRequest {
  return {
    requestId: randomUUID(),
    conversationId: randomUUID(),
    messages: [{ role: 'user', content: '你好' }],
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function stream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
    cancel() {
      cancelled = true
    },
  })
  return {
    response: new Response(body, {
      headers: { 'content-type': 'text/event-stream' },
    }),
    send(event: unknown) {
      controller.enqueue(
        new TextEncoder().encode(
          `event: chat\ndata: ${JSON.stringify(event)}\n\n`,
        ),
      )
    },
    close() {
      controller.close()
    },
    get cancelled() {
      return cancelled
    },
  }
}

test('chat streams reject duplicate active conversations and validate event identity', async () => {
  const input = request()
  const source = stream()
  const events: ChatEvent[] = []
  const runtime = new ChatStreamRuntime({
    endpoint: 'https://api.example.test/api/chat',
    getCookie: () => 'fixture',
    onUnauthorized: () => {},
    request: async () => source.response,
  })
  assert.equal(
    runtime.start(input, (event) => events.push(event)),
    true,
  )
  assert.equal(
    runtime.start({ ...input, requestId: randomUUID() }, () => {}),
    false,
  )
  await tick()
  const messageId = randomUUID()
  source.send({
    ...input,
    type: 'text-delta',
    messageId,
    delta: 'invalid extra messages property',
  })
  source.send({
    type: 'text-delta',
    requestId: input.requestId,
    conversationId: input.conversationId,
    messageId,
    delta: 'before start',
  })
  source.send({
    type: 'message-start',
    requestId: input.requestId,
    conversationId: randomUUID(),
    messageId,
  })
  source.send({
    type: 'message-start',
    requestId: input.requestId,
    conversationId: input.conversationId,
    messageId,
  })
  source.send({
    type: 'text-delta',
    requestId: input.requestId,
    conversationId: input.conversationId,
    messageId: randomUUID(),
    delta: 'wrong message',
  })
  source.send({
    type: 'text-delta',
    requestId: input.requestId,
    conversationId: input.conversationId,
    messageId,
    delta: '正确内容',
  })
  source.send({
    type: 'message-complete',
    requestId: input.requestId,
    conversationId: input.conversationId,
    messageId,
  })
  await tick()
  assert.deepEqual(
    events.map((event) => event.type),
    ['message-start', 'text-delta', 'message-complete'],
  )
  assert.ok(source.cancelled)
})

test('a terminal event releases the conversation without waiting for the HTTP body to close', async () => {
  const input = request()
  const first = stream()
  const second = stream()
  let reads = 0
  let restarted = false
  const runtime = new ChatStreamRuntime({
    endpoint: 'https://api.example.test/api/chat',
    getCookie: () => '',
    onUnauthorized: () => {},
    request: async () => (++reads === 1 ? first.response : second.response),
  })
  runtime.start(input, (event) => {
    if (event.type === 'message-stopped')
      restarted = runtime.start(input, () => {})
  })
  await tick()
  first.send({
    type: 'message-stopped',
    requestId: input.requestId,
    conversationId: input.conversationId,
  })
  await tick()
  assert.ok(restarted)
  assert.ok(first.cancelled)
  assert.equal(
    runtime.start(input, () => {}),
    false,
  )
  runtime.stopAll()
  second.close()
  await tick()
})

test('local cancellation emits one stop and a late unauthorized response cannot affect a new task', async () => {
  const input = request()
  const late = deferred<Response>()
  const next = stream()
  let reads = 0
  let unauthorized = 0
  const events: ChatEvent[] = []
  const runtime = new ChatStreamRuntime({
    endpoint: 'https://api.example.test/api/chat',
    getCookie: () => '',
    onUnauthorized: () => unauthorized++,
    request: async () => (++reads === 1 ? late.promise : next.response),
  })
  runtime.start(input, (event) => events.push(event))
  assert.equal(runtime.stop(input.requestId, randomUUID()), false)
  assert.equal(runtime.stop(input.requestId, input.conversationId), true)
  assert.equal(runtime.stop(input.requestId, input.conversationId), false)
  assert.equal(
    runtime.start(input, () => {}),
    true,
  )
  late.resolve(
    new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }),
  )
  await tick()
  assert.equal(unauthorized, 0)
  assert.deepEqual(
    events.map((event) => event.type),
    ['message-stopped'],
  )
  assert.equal(
    runtime.start(input, () => {}),
    false,
  )
  runtime.stopAll()
  next.close()
  await tick()
})

test('a cancelled request cannot invalidate the account while its error body is still arriving', async () => {
  const input = request()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
  })
  let unauthorized = 0
  const runtime = new ChatStreamRuntime({
    endpoint: 'https://api.example.test/api/chat',
    getCookie: () => '',
    onUnauthorized: () => unauthorized++,
    request: async () => new Response(body, { status: 401 }),
  })
  runtime.start(input, () => {})
  await tick()
  runtime.stopAll()
  controller.enqueue(new TextEncoder().encode('{"message":"Unauthorized"}'))
  controller.close()
  await tick()
  assert.equal(unauthorized, 0)
})

test('premature stream endings expose an error rather than a completed reply', async () => {
  const input = request()
  const source = stream()
  const result = deferred<ChatEvent>()
  const runtime = new ChatStreamRuntime({
    endpoint: 'https://api.example.test/api/chat',
    getCookie: () => '',
    onUnauthorized: () => {},
    request: async () => source.response,
  })
  runtime.start(input, result.resolve)
  source.close()
  const event = await result.promise
  assert.equal(event.type, 'error')
  assert.match(event.type === 'error' ? event.message : '', /提前中断/)
})

test('chat timeouts abort the transport and provide a localized terminal error', async () => {
  const result = deferred<ChatEvent>()
  const runtime = new ChatStreamRuntime({
    endpoint: 'https://api.example.test/api/chat',
    getCookie: () => '',
    onUnauthorized: () => {},
    timeoutMs: 5,
    request: async (_url, options) =>
      new Promise((_resolve, reject) => {
        options!.signal!.addEventListener(
          'abort',
          () => reject(new Error('AbortError')),
          { once: true },
        )
      }),
  })
  runtime.start(request(), result.resolve)
  const event = await result.promise
  assert.equal(event.type, 'error')
  assert.equal(
    event.type === 'error' ? event.message : '',
    '生成超时，请重试。',
  )
})
