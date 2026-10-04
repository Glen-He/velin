import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createChatEventStream } from '../src/lib/chat/event-stream'

test('native SSE keeps event identity and terminates after completion', async () => {
  const stream = createChatEventStream(new AbortController().signal)
  const text = stream.response.text()
  const identity = {
    requestId: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
    messageId: crypto.randomUUID(),
  }
  await stream.write({ type: 'message-start', ...identity })
  await stream.write({ type: 'text-delta', ...identity, delta: '你好\n世界' })
  await stream.write({ type: 'message-complete', ...identity })
  await stream.close()
  const events = (await text)
    .trim()
    .split('\n\n')
    .map((event) => JSON.parse(event.split('\ndata: ')[1]))
  assert.equal(events.length, 3)
  assert.equal(events[1].delta, '你好\n世界')
  assert.equal(events[2].requestId, identity.requestId)
  assert.equal(events[2].type, 'message-complete')
})

test('consumer cancellation aborts upstream generation even before the first chunk', async () => {
  const stream = createChatEventStream(new AbortController().signal)
  await stream.response.body!.cancel()
  await Promise.resolve()
  assert.equal(stream.signal.reason, 'client-disconnected')
  await stream.close()
})

test('timeout cancels the model while preserving a final localized SSE error', async () => {
  const stream = createChatEventStream(new AbortController().signal, 1)
  const text = stream.response.text()
  await new Promise<void>((resolve) =>
    stream.signal.addEventListener('abort', () => resolve(), { once: true }),
  )
  assert.equal(stream.signal.reason, 'timeout')
  await stream.write({
    type: 'error',
    requestId: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
    messageId: crypto.randomUUID(),
    message: '生成超时，请重试。',
  })
  await stream.close()
  assert.match(await text, /生成超时/)
})
