import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createResponsesEventReader,
  readResponse,
} from '../src/lib/chat/responses'
import { chatEventSchema } from '@velin/contracts/chat-validation'
import { chatLimits } from '@velin/contracts/policy'
const created = {
  type: 'response.created',
  sequence_number: 0,
  response: { id: 'r1' },
}
test('Responses rejects invalid storage text before emitting or saving it', () => {
  for (const text of ['bad\u0000', 'bad\uD800', 'bad\uDC00']) {
    const reader = createResponsesEventReader()
    reader.read(created)
    assert.throws(() =>
      reader.read({
        type: 'response.output_text.delta',
        sequence_number: 1,
        delta: text,
      }),
    )
    assert.throws(() => readResponse({ id: 'r1', output_text: text }))
  }
  const reader = createResponsesEventReader()
  reader.read(created)
  assert.deepEqual(
    reader.read({
      type: 'response.output_text.delta',
      sequence_number: 1,
      delta: '中文😀',
    }),
    { kind: 'content', delta: '中文😀' },
  )
})
test('Responses validates identity, order, terminal status and authoritative usage', () => {
  const reader = createResponsesEventReader()
  reader.read(created)
  assert.deepEqual(
    reader.read({
      type: 'response.reasoning_text.delta',
      sequence_number: 1,
      delta: '思考',
    }),
    { kind: 'reasoning', delta: '思考' },
  )
  assert.deepEqual(
    reader.read({
      type: 'response.output_text.delta',
      sequence_number: 2,
      delta: '正文',
    }),
    { kind: 'content', delta: '正文' },
  )
  const done = reader.read({
    type: 'response.incomplete',
    sequence_number: 3,
    response: {
      id: 'r1',
      status: 'incomplete',
      output: [],
      usage: { input_tokens: 42, output_tokens: 16 },
    },
  })
  assert.equal(done.kind, 'terminal')
  if (done.kind === 'terminal') {
    assert.equal(done.incomplete, true)
    assert.deepEqual(done.usage, { input_tokens: 42, output_tokens: 16 })
  }
  assert.equal(reader.terminal, true)
  assert.throws(() =>
    reader.read({
      type: 'response.output_text.delta',
      sequence_number: 4,
      delta: 'late',
    }),
  )
  const wrong = createResponsesEventReader()
  wrong.read(created)
  assert.throws(() =>
    wrong.read({
      type: 'response.completed',
      sequence_number: 1,
      response: { id: 'r2', status: 'completed' },
    }),
  )
  assert.throws(() =>
    createResponsesEventReader().read({
      type: 'response.output_text.delta',
      sequence_number: 0,
      delta: 'early',
    }),
  )
  const duplicate = createResponsesEventReader()
  duplicate.read(created)
  assert.throws(() => duplicate.read(created))
})
test('Responses rejects malformed deltas, errors and invalid usage without inventing completion', () => {
  const reader = createResponsesEventReader()
  reader.read(created)
  assert.throws(() =>
    reader.read({
      type: 'response.output_text.delta',
      sequence_number: 1,
      delta: 42,
    }),
  )
  assert.equal(reader.terminal, false)
  const failed = createResponsesEventReader()
  failed.read(created)
  assert.throws(() =>
    failed.read({
      type: 'response.failed',
      sequence_number: 1,
      response: { id: 'r1', status: 'failed' },
    }),
  )
  assert.equal(
    readResponse({
      id: 'r',
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'answer' }] },
      ],
      usage: { input_tokens: -1, output_tokens: 1 },
    }).text,
    'answer',
  )
  assert.equal(
    readResponse({ id: 'r', usage: { input_tokens: -1, output_tokens: 1 } })
      .usage,
    undefined,
  )
})
test('worst-case context metadata fits the desktop SSE parser frame budget', () => {
  const event = chatEventSchema.parse({
    type: 'context-ready',
    model: 'deepseek-flash',
    reasoningEffort: 'none',
    requestId: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
    messageId: crypto.randomUUID(),
    context: {
      policyVersion: 1,
      summaryUsed: true,
      memoryCount: 200,
      retrievalDegraded: true,
      historySources: Array.from({ length: 8 }, () => ({
        conversationId: crypto.randomUUID(),
        messageId: crypto.randomUUID(),
        title: '\u0000'.repeat(200),
        role: 'user',
        createdAt: 0,
        updatedAt: 0,
        excerpt: '\u0000'.repeat(1000),
      })),
      documentPartial: true,
      documentsSummarized: false,
      imagesLimited: true,
      tokenUpperBound: 262144,
      sources: Array.from({ length: 8 }, () => ({
        attachmentId: crypto.randomUUID(),
        name: '\u0000'.repeat(200),
        page: 300,
        excerpt: '\u0000'.repeat(1000),
      })),
    },
  })
  assert.ok(
    JSON.stringify(event).length + 30 < chatLimits.streamBufferCharacters,
  )
})
