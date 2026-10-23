import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import {
  chatEventSchema,
  chatStopRequestSchema,
  chatRequestSchema,
} from '@velin/contracts/chat-validation'

test('chat cancellation accepts only the same UUID identity contract as message submission', () => {
  const identity = { requestId: randomUUID(), conversationId: randomUUID() }
  assert.ok(chatStopRequestSchema.safeParse(identity).success)
  const request = {
    ...identity,
    userMessageId: randomUUID(),
    content: '你好',
  }
  const parsedRequest = chatRequestSchema.safeParse(request)
  assert.equal(parsedRequest.success, true)
  assert.equal(
    parsedRequest.success ? parsedRequest.data.model : '',
    'deepseek-flash',
  )
  assert.equal(
    parsedRequest.success ? parsedRequest.data.reasoningEffort : '',
    'none',
  )
  for (const value of [
    null,
    [],
    {},
    { ...identity, requestId: '' },
    { ...identity, conversationId: 'invalid' },
    { ...request, userMessageId: 'invalid' },
    { ...request, content: '   ' },
    { ...request, model: 'invalid-model' },
    { ...request, reasoningEffort: 'invalid-effort' },
    { ...request, timeZone: 'Mars/Olympus' },
    { ...request, timeZone: '+08:00' },
    { ...request, extra: true },
  ]) {
    assert.equal(chatRequestSchema.safeParse(value).success, false)
  }
  assert.equal(
    chatRequestSchema.parse({ ...request, timeZone: 'Asia/Shanghai' }).timeZone,
    'Asia/Shanghai',
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

test('completion events may carry a generated title without changing identity', () => {
  const identity = {
    requestId: randomUUID(),
    conversationId: randomUUID(),
    messageId: randomUUID(),
  }
  assert.ok(
    chatEventSchema.safeParse({
      ...identity,
      type: 'message-complete',
      title: '京都三日游规划',
    }).success,
  )
  assert.ok(
    chatEventSchema.safeParse({ ...identity, type: 'message-complete' })
      .success,
  )
  assert.equal(
    chatEventSchema.safeParse({
      ...identity,
      type: 'message-complete',
      title: '',
    }).success,
    false,
  )
  assert.ok(
    chatEventSchema.safeParse({
      ...identity,
      type: 'reasoning-delta',
      delta: '先分析',
    }).success,
  )
})
