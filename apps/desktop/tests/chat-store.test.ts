import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createChatStore } from '../src/renderer/features/chat/chat-store.ts'
import type {
  ConversationHistoryPage,
  ConversationSummary,
} from '@velin/contracts/chat'
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

function summary(overrides: Partial<ConversationSummary> = {}) {
  return {
    id: randomUUID(),
    title: '历史对话',
    model: 'deepseek-flash',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function page(
  conversation: ConversationSummary,
  messages: ConversationHistoryPage['messages'],
  overrides: Partial<ConversationHistoryPage> = {},
): ConversationHistoryPage {
  return {
    revision: '1',
    conversation,
    messages,
    hasMore: false,
    nextBefore: null,
    ...overrides,
  }
}

test('history reads cannot overwrite a newer send, edit or restored branch after completion', () => {
  const { store, sent } = fixture()
  store.send('first')
  const request = sent.at(-1)!
  store.receive({ ...request, type: 'message-start', messageId: 'reply' })
  store.receive({ ...request, type: 'message-complete', messageId: 'reply' })
  const conversation = store.getSnapshot().conversations[0]
  assert.equal(conversation.isPersisted, true)
  const beforeSend = store.captureHistoryRead(conversation.id)
  store.send('second')
  store.completeHistoryLoad(
    conversation.id,
    page(summary({ id: conversation.id }), []),
  )
  store.prependHistory(
    conversation.id,
    page(summary({ id: conversation.id }), [], { revision: '99' }),
  )
  assert.equal(
    store.getSnapshot().conversations[0].messages.at(-1)?.content,
    'second',
  )
  assert.equal(store.getSnapshot().history[conversation.id].status, 'loaded')
  assert.equal(beforeSend(), false)
  assert.equal(store.getSnapshot().conversations[0].isPersisted, true)
  const second = sent.at(-1)!
  store.receive({ ...second, type: 'message-start', messageId: 'reply2' })
  store.receive({ ...second, type: 'message-complete', messageId: 'reply2' })
  assert.equal(beforeSend(), false)
  const beforeEdit = store.captureHistoryRead(conversation.id)
  store.edit(conversation.id, conversation.messages[0].id, 'edited')
  store.stop(conversation.id)
  assert.equal(beforeEdit(), false)
  const beforeRestore = store.captureHistoryRead(conversation.id)
  assert.equal(store.beginHistoryRestore(conversation.id), true)
  assert.equal(beforeRestore(), false)
  assert.equal(store.send('cannot race restore'), false)
  assert.equal(store.beginHistoryLoad(conversation.id), false)
  const restoring = store.captureHistoryRead(conversation.id)
  store.completeHistoryLoad(
    conversation.id,
    page(summary({ id: conversation.id }), []),
  )
  assert.equal(restoring(), false)
  assert.equal(store.getSnapshot().history[conversation.id].status, 'loaded')
})

test('delete and account reset invalidate reads even if the same conversation is loaded again', () => {
  const { store } = fixture()
  const conversation = summary()
  store.hydrateConversations([conversation])
  const read = store.captureHistoryRead(conversation.id)
  store.remove(conversation.id)
  store.hydrateConversations([conversation])
  assert.equal(read(), false)
  const nextRead = store.captureHistoryRead(conversation.id)
  store.reset()
  store.hydrateConversations([conversation])
  assert.equal(nextRead(), false)
})

test('multi-device branch changes never merge earlier pages or retained prefixes from another revision', () => {
  const { store } = fixture()
  const conversation = summary()
  const message = (id: string, content = id) => ({
    id,
    content,
    role: 'user' as const,
    reasoning: '',
    attachments: [],
    createdAt: 1,
    status: 'completed' as const,
  })
  store.hydrateConversations([conversation])
  store.completeHistoryLoad(
    conversation.id,
    page(conversation, [message('old'), message('anchor')], {
      hasMore: true,
      nextBefore: '10',
    }),
  )
  const previousRead = store.captureHistoryRead(conversation.id)
  store.refreshHistory(
    conversation.id,
    page(conversation, [message('anchor', 'edited')], { revision: '2' }),
  )
  assert.equal(previousRead(), false)
  assert.deepEqual(
    store.getSnapshot().conversations[0].messages.map((item) => item.content),
    ['edited'],
  )
  store.prependHistory(
    conversation.id,
    page(conversation, [message('obsolete')], { revision: '1' }),
  )
  assert.equal(store.getSnapshot().history[conversation.id].status, 'idle')
  assert.deepEqual(
    store.getSnapshot().conversations[0].messages.map((item) => item.content),
    ['edited'],
  )
})

test('rejected edit restores history and manual title then requests authoritative reload', () => {
  const { store, sent } = fixture()
  for (let index = 0; index < 2; index += 1) {
    store.send(`question ${index}`)
    const request = sent.at(-1)!
    const messageId = randomUUID()
    store.receive({ ...request, type: 'message-start', messageId })
    store.receive({
      ...request,
      type: 'text-delta',
      messageId,
      delta: 'answer',
    })
    store.receive({ ...request, type: 'message-complete', messageId })
  }
  const conversation = store.getSnapshot().conversations[0]
  store.rename(conversation.id, '手动标题')
  store.edit(conversation.id, conversation.messages[0].id, 'edited')
  store.receive({
    ...sent.at(-1)!,
    type: 'error',
    message: '发送过于频繁，请稍后再试。',
  })
  const restored = store.getSnapshot().conversations[0]
  assert.deepEqual(restored.messages, conversation.messages)
  assert.equal(restored.title, '手动标题')
  assert.equal(store.getSnapshot().history[conversation.id].status, 'idle')
  store.regenerate(conversation.id, conversation.messages[1].id)
  store.receive({ ...sent.at(-1)!, type: 'error', message: '服务暂时不可用。' })
  assert.deepEqual(
    store.getSnapshot().conversations[0].messages,
    conversation.messages,
  )
})

test('truncated replies remain distinguishable from completed replies', () => {
  const { store, sent } = fixture()
  store.send('write a long answer')
  const request = sent[0]
  store.receive({ ...request, type: 'message-start', messageId: 'reply' })
  store.receive({
    ...request,
    type: 'text-delta',
    messageId: 'reply',
    delta: 'partial',
  })
  store.receive({
    ...request,
    type: 'message-complete',
    messageId: 'reply',
    incomplete: true,
  })
  assert.equal(
    store.getSnapshot().conversations[0].messages[1].status,
    'incomplete',
  )
})

test('reasoning-only replies survive both cancellation and failure', () => {
  for (const type of ['message-stopped', 'error'] as const) {
    const { store, sent } = fixture()
    store.send('think before answering')
    const request = sent[0]
    const messageId = randomUUID()
    store.receive({ ...request, type: 'message-start', messageId })
    store.receive({
      ...request,
      type: 'reasoning-delta',
      messageId,
      delta: '部分推理',
    })
    store.receive(
      type === 'error'
        ? { ...request, type, messageId, message: '连接已断开。' }
        : { ...request, type },
    )
    const reply = store.getSnapshot().conversations[0].messages.at(-1)
    assert.equal(reply?.reasoning, '部分推理')
    assert.equal(reply?.status, type === 'error' ? 'failed' : 'cancelled')
  }
})

test('send is accepted once and stream start is idempotent', () => {
  const { store, sent } = fixture()
  assert.equal(store.send('hello'), true)
  assert.equal(store.send('second click'), false)
  const request = sent[0]
  assert.equal(request.content, 'hello')
  assert.equal(
    store.getSnapshot().conversations[0].messages[0].id,
    request.userMessageId,
  )
  store.receive({ ...request, type: 'message-start', messageId: 'reply' })
  store.receive({ ...request, type: 'message-start', messageId: 'reply' })
  store.receive({
    ...request,
    type: 'text-delta',
    messageId: 'reply',
    delta: 'Hi',
  })
  const messages = store.getSnapshot().conversations[0].messages
  assert.equal(messages.length, 2)
  assert.equal(messages[1].content, 'Hi')
  assert.equal(messages[1].status, 'streaming')
  store.receive({ ...request, type: 'message-complete', messageId: 'reply' })
  assert.equal(
    store.getSnapshot().conversations[0].messages[1].status,
    'completed',
  )
  assert.equal(Object.keys(store.getSnapshot().requests).length, 0)
})

test('send carries the selected model and reasoning effort', () => {
  const { store, sent } = fixture()
  assert.equal(
    store.send('hello', {
      model: 'deepseek-v4-pro',
      reasoningEffort: 'high',
    }),
    true,
  )
  assert.equal(sent[0].model, 'deepseek-v4-pro')
  assert.equal(sent[0].reasoningEffort, 'high')
})

test('send carries uploaded attachments to the request and local message', () => {
  const { store, sent } = fixture()
  const attachment = {
    id: randomUUID(),
    kind: 'file' as const,
    name: 'notes.txt',
    mimeType: 'text/plain',
    sizeBytes: 24,
    status: 'ready' as const,
  }

  assert.equal(
    store.send('read this', {
      model: 'deepseek-flash',
      reasoningEffort: 'none',
      attachments: [attachment],
    }),
    true,
  )
  assert.deepEqual(sent[0].attachmentIds, [attachment.id])
  assert.deepEqual(
    store.getSnapshot().conversations[0].messages[0].attachments,
    [attachment],
  )
})

test('reasoning deltas append independently from the answer content', () => {
  const { store, sent } = fixture()
  store.send('think')
  const request = sent[0]
  store.receive({ ...request, type: 'message-start', messageId: 'reply' })
  store.receive({
    ...request,
    type: 'reasoning-delta',
    messageId: 'reply',
    delta: '先想',
  })
  store.receive({
    ...request,
    type: 'reasoning-delta',
    messageId: 'reply',
    delta: '一下',
  })
  store.receive({
    ...request,
    type: 'text-delta',
    messageId: 'reply',
    delta: '答案',
  })
  const reply = store.getSnapshot().conversations[0].messages[1]
  assert.equal(reply.reasoning, '先想一下')
  assert.equal(reply.content, '答案')
})

test('completion can replace the derived title with a generated one', () => {
  const { store, sent } = fixture()
  store.send('帮我规划一个三天的京都旅行')
  const request = sent[0]
  store.receive({ ...request, type: 'message-start', messageId: 'reply' })
  store.receive({
    ...request,
    type: 'text-delta',
    messageId: 'reply',
    delta: '好的',
  })
  store.receive({
    ...request,
    type: 'message-complete',
    messageId: 'reply',
    title: '京都三日游规划',
  })
  assert.equal(store.getSnapshot().conversations[0].title, '京都三日游规划')
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
  const reply = store.getSnapshot().conversations[0].messages[1]
  assert.equal(reply.content, 'partial')
  assert.equal(reply.status, 'cancelled')
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

test('a failed reply with partial content keeps its failed state', () => {
  const { store, sent } = fixture()
  store.send('hello')
  const request = sent[0]
  store.receive({ ...request, type: 'message-start', messageId: 'reply' })
  store.receive({
    ...request,
    type: 'text-delta',
    messageId: 'reply',
    delta: 'partial',
  })
  store.receive({
    ...request,
    type: 'error',
    messageId: 'reply',
    message: 'network lost',
  })
  const reply = store.getSnapshot().conversations[0].messages[1]
  assert.equal(reply.content, 'partial')
  assert.equal(reply.status, 'failed')
})

test('editing truncates following messages and sends the revised prompt', () => {
  const { store, sent } = fixture()
  store.send('original')
  const request = sent[0]
  store.receive({ ...request, type: 'message-stopped' })
  const message = store.getSnapshot().conversations[0].messages[0]
  assert.equal(store.edit(request.conversationId, message.id, 'revised'), true)
  assert.equal(sent[1].content, 'revised')
  assert.equal(sent[1].userMessageId, message.id)
  assert.equal(store.getSnapshot().conversations[0].title, 'original')
  assert.equal(
    store.edit(request.conversationId, message.id, 'duplicate'),
    false,
  )
})

test('regenerate replaces the last reply with a new request for the same user message', () => {
  const { store, sent } = fixture()
  store.send('hello')
  const request = sent[0]
  store.receive({ ...request, type: 'message-start', messageId: 'reply' })
  store.receive({
    ...request,
    type: 'text-delta',
    messageId: 'reply',
    delta: 'old',
  })
  store.receive({ ...request, type: 'message-complete', messageId: 'reply' })
  const assistantId = store.getSnapshot().conversations[0].messages[1].id
  assert.equal(store.regenerate(request.conversationId, assistantId), true)
  assert.equal(sent.length, 2)
  assert.equal(sent[1].userMessageId, request.userMessageId)
  assert.equal(sent[1].content, 'hello')
  assert.deepEqual(
    store.getSnapshot().conversations[0].messages.map((item) => item.content),
    ['hello'],
  )

  store.receive({
    ...sent[1],
    type: 'message-start',
    messageId: 'reply-2',
  })
  store.receive({
    ...sent[1],
    type: 'text-delta',
    messageId: 'reply-2',
    delta: 'new',
  })
  store.receive({
    ...sent[1],
    type: 'message-complete',
    messageId: 'reply-2',
  })
  assert.deepEqual(
    store.getSnapshot().conversations[0].messages.map((item) => item.content),
    ['hello', 'new'],
  )
  assert.equal(store.regenerate(request.conversationId, assistantId), false)
})

test('regenerate is rejected while the conversation is still generating', () => {
  const { store, sent } = fixture()
  store.send('hello')
  const request = sent[0]
  store.receive({ ...request, type: 'message-start', messageId: 'reply' })
  const assistantId = store.getSnapshot().conversations[0].messages[1].id
  assert.equal(store.regenerate(request.conversationId, assistantId), false)
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
    conversationRevision: 0,
    conversations: [],
    activeConversationId: null,
    requests: {},
    errors: {},
    history: {},
  })
})

test('hydration exposes summaries but waits for history before sending', () => {
  const { store, sent } = fixture()
  const conversation = summary()
  store.hydrateConversations([conversation])
  store.select(conversation.id)
  assert.deepEqual(store.getSnapshot().conversations[0].messages, [])
  assert.equal(store.getSnapshot().history[conversation.id].status, 'idle')
  assert.equal(store.send('blocked'), false)

  assert.equal(store.beginHistoryLoad(conversation.id), true)
  assert.equal(store.send('still blocked'), false)
  store.completeHistoryLoad(
    conversation.id,
    page(conversation, [
      {
        id: randomUUID(),
        role: 'user',
        content: 'earlier',
        reasoning: '',
        createdAt: 3,
        status: 'completed',
      },
      {
        id: randomUUID(),
        role: 'assistant',
        content: 'reply',
        reasoning: '',
        createdAt: 4,
        status: 'completed',
      },
    ]),
  )
  assert.equal(store.getSnapshot().history[conversation.id].status, 'loaded')
  assert.equal(store.send('now allowed'), true)
  assert.equal(sent[0].content, 'now allowed')
  assert.equal(store.getSnapshot().conversations[0].messages.length, 3)
})

test('history failure is distinct from an empty conversation and can retry', () => {
  const { store } = fixture()
  const conversation = summary()
  store.hydrateConversations([conversation])
  store.select(conversation.id)
  assert.equal(store.beginHistoryLoad(conversation.id), true)
  store.failHistoryLoad(conversation.id, '历史读取失败')
  assert.equal(store.getSnapshot().history[conversation.id].status, 'error')
  assert.equal(
    store.getSnapshot().history[conversation.id].error,
    '历史读取失败',
  )
  assert.deepEqual(store.getSnapshot().conversations[0].messages, [])
  assert.equal(store.beginHistoryLoad(conversation.id), true)
  store.completeHistoryLoad(conversation.id, page(conversation, []))
  assert.equal(store.getSnapshot().history[conversation.id].status, 'loaded')
})

test('older history pages prepend without duplicating loaded messages', () => {
  const { store } = fixture()
  const conversation = summary()
  const newest = {
    id: randomUUID(),
    role: 'assistant' as const,
    content: 'newest',
    reasoning: '',
    createdAt: 5,
    status: 'completed' as const,
  }
  const older = {
    id: randomUUID(),
    role: 'user' as const,
    content: 'older',
    reasoning: '',
    createdAt: 2,
    status: 'completed' as const,
  }
  store.hydrateConversations([conversation])
  store.beginHistoryLoad(conversation.id)
  store.completeHistoryLoad(
    conversation.id,
    page(conversation, [newest], { hasMore: true, nextBefore: '9' }),
  )
  store.prependHistory(
    conversation.id,
    page(conversation, [older, newest], {
      hasMore: false,
      nextBefore: null,
    }),
  )
  assert.deepEqual(
    store.getSnapshot().conversations[0].messages.map((item) => item.content),
    ['older', 'newest'],
  )
  assert.equal(store.getSnapshot().history[conversation.id].hasMore, false)
})

test('rename updates the title and complete order replaces the visible order', () => {
  const { store } = fixture()
  const first = summary({ title: 'First' })
  const second = summary({ title: 'Second' })
  store.hydrateConversations([first, second])
  store.rename(first.id, 'Renamed')
  assert.equal(
    store.getSnapshot().conversations.find((item) => item.id === first.id)
      ?.title,
    'Renamed',
  )
  store.setConversationOrder([second.id, first.id])
  assert.deepEqual(
    store.getSnapshot().conversations.map((item) => item.id),
    [second.id, first.id],
  )
  store.setConversationOrder([first.id])
  assert.deepEqual(
    store.getSnapshot().conversations.map((item) => item.id),
    [second.id, first.id],
  )
})

test('delete removes conversation history and selects the next conversation', () => {
  const { store } = fixture()
  const first = summary({ title: 'First' })
  const second = summary({ title: 'Second' })
  store.hydrateConversations([first, second])
  store.select(first.id)
  store.remove(first.id)
  assert.deepEqual(
    store.getSnapshot().conversations.map((item) => item.id),
    [second.id],
  )
  assert.equal(store.getSnapshot().activeConversationId, second.id)
  assert.equal(store.getSnapshot().history[first.id], undefined)
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
    conversationRevision: 0,
    conversations: [],
    activeConversationId: null,
    requests: {},
    errors: {},
    history: {},
  })
})
