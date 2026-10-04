import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import {
  chatStopRequestSchema,
  chatRequestSchema,
} from '@velin/contracts/chat-validation'

test('chat cancellation accepts only the same UUID identity contract as message submission', () => {
  const identity = { requestId: randomUUID(), conversationId: randomUUID() }
  assert.ok(chatStopRequestSchema.safeParse(identity).success)
  assert.ok(
    chatRequestSchema.safeParse({
      ...identity,
      messages: [{ role: 'user', content: '你好' }],
    }).success,
  )
  for (const value of [
    null,
    [],
    {},
    { ...identity, requestId: '' },
    { ...identity, conversationId: 'invalid' },
    { ...identity, extra: true },
  ]) {
    assert.equal(chatStopRequestSchema.safeParse(value).success, false)
  }
})
