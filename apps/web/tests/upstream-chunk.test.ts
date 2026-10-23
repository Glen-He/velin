import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatLimits } from '@velin/contracts/policy'
import { chatEventSchema } from '@velin/contracts/chat-validation'
import { boundedDelta, splitChatDelta } from '../src/lib/chat/upstream-chunk'

test('response limits and delta splitting preserve surrogate pairs', () => {
  const boundary = chatLimits.responseCharacters
  assert.deepEqual(boundedDelta('😀end', boundary - 1), {
    text: '',
    limited: true,
  })
  assert.deepEqual(boundedDelta('😀', boundary - 2), {
    text: '😀',
    limited: false,
  })
  const original =
    'x'.repeat(chatLimits.deltaCharacters - 1) + '😀尾'.repeat(8_000)
  const parts = [...splitChatDelta(original)]
  assert.equal(parts.join(''), original)
  assert.ok(
    parts.every(
      (part) =>
        part.length <= chatLimits.deltaCharacters &&
        !/[\uD800-\uDBFF]$/.test(part),
    ),
  )
})

test('even worst-case JSON escaping stays inside the client SSE frame budget', () => {
  const identity = {
    requestId: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
    messageId: crypto.randomUUID(),
  }
  for (const delta of splitChatDelta(
    '\u0000'.repeat(chatLimits.responseCharacters),
  )) {
    const event = chatEventSchema.parse({
      type: 'text-delta',
      ...identity,
      delta,
    })
    const frame = `event: chat\ndata: ${JSON.stringify(event)}\n\n`
    assert.ok(frame.length < chatLimits.streamBufferCharacters)
  }
})
