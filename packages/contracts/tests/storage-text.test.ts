import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  chatRequestSchema,
  chatListRequestSchema,
} from '@velin/contracts/chat-validation'
import { memoryWriteSchema } from '@velin/contracts/memory'
import {
  isValidStorageText,
  isValidDisplayName,
  isValidConversationTitle,
  truncateText,
  splitText,
} from '@velin/contracts/policy'

test('stored text rejects NUL and lone surrogates while preserving multilingual content', () => {
  const request = {
    requestId: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
    userMessageId: crypto.randomUUID(),
    content: '中文和 emoji 😀\n第二行',
  }
  assert.equal(chatRequestSchema.safeParse(request).success, true)
  assert.equal(
    memoryWriteSchema.safeParse({ topic: '偏好😀', content: request.content })
      .success,
    true,
  )
  for (const character of ['\u0000', '\uD800', '\uDC00']) {
    const text = `内容${character}`
    assert.equal(isValidStorageText(text), false)
    assert.equal(isValidDisplayName(text), false)
    assert.equal(isValidConversationTitle(text), false)
    assert.equal(
      chatRequestSchema.safeParse({ ...request, content: text }).success,
      false,
    )
    assert.equal(
      chatListRequestSchema.safeParse({ search: text }).success,
      false,
    )
    assert.equal(
      memoryWriteSchema.safeParse({ topic: text, content: '内容' }).success,
      false,
    )
    assert.equal(
      memoryWriteSchema.safeParse({ topic: '主题', content: text }).success,
      false,
    )
  }
})

test('UTF-16 prefix budgets never split supplementary code points', () => {
  assert.equal(truncateText('a😀b', 2), 'a')
  assert.equal(truncateText('a😀b', 3), 'a😀')
  assert.equal(truncateText('a😀b', 20), 'a😀b')
  assert.equal(truncateText('a😀b', 0), '')
  assert.deepEqual([...splitText('a😀b', 2)], ['a', '😀', 'b'])
  assert.equal(
    [...splitText('中文😀'.repeat(100), 7)].join(''),
    '中文😀'.repeat(100),
  )
  assert.throws(() => [...splitText('😀', 1)], RangeError)
})
