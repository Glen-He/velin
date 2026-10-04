import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createChatStore,
  promptMessages,
} from '../src/features/chat/chat-store.ts'
import type {
  SendMessageRequest,
  StopMessageRequest,
} from '@velin/contracts/chat-protocol'

function fixture() {
  const sent: SendMessageRequest[] = []
  const stopped: StopMessageRequest[] = []
  const store = createChatStore({
    send: (item) => {
      sent.push(item)
    },
    stop: (item) => {
      stopped.push(item)
    },
  })
  return { store, sent, stopped }
}

test('send is accepted once and stream start is idempotent', () => {
  const { store, sent } = fixture()
  assert.equal(store.send('hello'), true)
  assert.equal(store.send('second click'), false)
  const request = sent[0]
  store.receive({ ...request, type: 'message-start', messageId: 'reply' })
  store.receive({ ...request, type: 'message-start', messageId: 'reply' })
  store.receive({
    ...request,
    type: 'text-delta',
    messageId: 'reply',
    delta: 'Hi',
  })
  assert.equal(store.getSnapshot().conversations[0].messages.length, 2)
  assert.equal(store.getSnapshot().conversations[0].messages[1].content, 'Hi')
  store.receive({ ...request, type: 'message-complete', messageId: 'reply' })
  assert.equal(Object.keys(store.getSnapshot().requests).length, 0)
})

test('cancel invalidates request before IPC and ignores late deltas', () => {
  const { store, sent, stopped } = fixture()
  store.send('hello')
  const request = sent[0]
  store.receive({ ...request, type: 'message-start', messageId: 'reply' })
  store.receive({
    ...request,
    type: 'text-delta',
    messageId: 'reply',
    delta: 'partial',
  })
  store.stop(request.conversationId)
  store.receive({
    ...request,
    type: 'text-delta',
    messageId: 'reply',
    delta: ' late',
  })
  store.receive({ ...request, type: 'error', message: 'late failure' })
  assert.equal(stopped.length, 1)
  assert.equal(
    store.getSnapshot().conversations[0].messages[1].content,
    'partial',
  )
  assert.equal(store.getSnapshot().errors[request.conversationId], undefined)
})

test('failure removes empty reply but keeps the user message and error', () => {
  const { store, sent } = fixture()
  store.send('hello')
  const request = sent[0]
  store.receive({ ...request, type: 'message-start', messageId: 'empty' })
  store.receive({ ...request, type: 'error', message: 'network lost' })
  assert.equal(store.getSnapshot().conversations[0].messages.length, 1)
  assert.equal(
    store.getSnapshot().errors[request.conversationId],
    'network lost',
  )
  assert.equal(store.send('retry'), true)
  assert.equal(store.getSnapshot().errors[request.conversationId], undefined)
  store.receive({ ...request, type: 'error', message: 'old request' })
  assert.equal(store.getSnapshot().errors[request.conversationId], undefined)
})

test('editing truncates following messages and sends the revised prompt', () => {
  const { store, sent } = fixture()
  store.send('original')
  const request = sent[0]
  store.receive({ ...request, type: 'message-stopped' })
  const message = store.getSnapshot().conversations[0].messages[0]
  assert.equal(store.edit(request.conversationId, message.id, 'revised'), true)
  assert.equal(sent[1].messages[0].content, 'revised')
  assert.equal(store.getSnapshot().conversations[0].title, 'revised')
  assert.equal(
    store.edit(request.conversationId, message.id, 'duplicate'),
    false,
  )
})

test('account reset stops every request and removes all account state', () => {
  const { store, sent, stopped } = fixture()
  store.send('first account')
  store.select(null)
  store.send('another request')
  store.reset()
  for (const request of sent)
    store.receive({ ...request, type: 'message-start', messageId: 'late' })
  assert.equal(stopped.length, 2)
  assert.deepEqual(store.getSnapshot(), {
    conversations: [],
    activeConversationId: null,
    requests: {},
    errors: {},
  })
})

test('failed IPC dispatch restores state so Composer can retain its draft', () => {
  const store = createChatStore({
    send: () => {
      throw new Error('unavailable preload')
    },
    stop: () => {},
  })
  assert.equal(store.send('draft'), false)
  assert.equal(store.getSnapshot().conversations.length, 0)
  assert.equal(store.send('  '), false)
  assert.equal(store.send('x'.repeat(8001)), false)
})

test('failed cancellation retains local invalidation and reports undelivered stop', () => {
  const sent: SendMessageRequest[] = []
  const store = createChatStore({
    send: (request) => {
      sent.push(request)
    },
    stop: () => {
      throw new Error('transport unavailable')
    },
  })
  store.send('draft')
  const request = sent[0]
  assert.doesNotThrow(() => store.stop(request.conversationId))
  store.receive({ ...request, type: 'message-start', messageId: 'late' })
  assert.equal(store.getSnapshot().conversations[0].messages.length, 1)
  assert.deepEqual(store.getSnapshot().requests, {})
  assert.match(store.getSnapshot().errors[request.conversationId]!, /未送达/)
  assert.doesNotThrow(() => store.remove(request.conversationId))
  assert.deepEqual(store.getSnapshot().conversations, [])
})

test('account cleanup attempts every cancellation even when first IPC fails', () => {
  const stopped: StopMessageRequest[] = []
  const store = createChatStore({
    send: () => {},
    stop: (request) => {
      stopped.push(request)
      if (stopped.length === 1) throw new Error('transport unavailable')
    },
  })
  store.send('first')
  store.select(null)
  store.send('second')
  assert.doesNotThrow(() => store.reset())
  assert.equal(stopped.length, 2)
  assert.deepEqual(store.getSnapshot(), {
    conversations: [],
    activeConversationId: null,
    requests: {},
    errors: {},
  })
})

test('prompt budget keeps newest nonempty content within the server limits', () => {
  const prompt = promptMessages(
    Array.from({ length: 40 }, (_, index) => ({
      id: `${index}`,
      role: 'user',
      content: `${index}`.padEnd(1000, 'x'),
      createdAt: index,
    })),
  )
  assert.equal(prompt.length, 32)
  assert.ok(prompt[0].content.startsWith('8'))
  assert.equal(
    prompt.reduce((total, item) => total + item.content.length, 0),
    32000,
  )
})
