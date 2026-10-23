import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import {
  conversationTitleLimit,
  isValidConversationTitle,
} from '@velin/contracts/policy'
import {
  chatOrderRequestSchema,
  chatRenameRequestSchema,
} from '@velin/contracts/chat-validation'

test('conversation titles count Unicode code points and reject control characters', () => {
  assert.equal(isValidConversationTitle('京都三日游'), true)
  assert.equal(
    isValidConversationTitle('京'.repeat(conversationTitleLimit)),
    true,
  )
  assert.equal(
    isValidConversationTitle('京'.repeat(conversationTitleLimit + 1)),
    false,
  )
  assert.equal(isValidConversationTitle('   '), false)
  assert.equal(isValidConversationTitle('标题\n换行'), false)
})

test('rename requests trim titles and order requests require unique identities', () => {
  const conversationId = randomUUID()
  const parsedTitle = chatRenameRequestSchema.safeParse({
    conversationId,
    title: '  京都行程  ',
  })
  assert.equal(parsedTitle.success, true)
  assert.equal(parsedTitle.success ? parsedTitle.data.title : '', '京都行程')

  assert.equal(
    chatRenameRequestSchema.safeParse({
      conversationId,
      title: '',
    }).success,
    false,
  )

  const first = randomUUID()
  const second = randomUUID()
  assert.equal(
    chatOrderRequestSchema.safeParse({
      sourceId: first,
      targetId: second,
      placement: 'before',
    }).success,
    true,
  )
  assert.equal(
    chatOrderRequestSchema.safeParse({
      sourceId: first,
      targetId: first,
      placement: 'before',
    }).success,
    false,
  )
  assert.equal(
    chatOrderRequestSchema.safeParse({
      sourceId: first,
      targetId: second,
      placement: 'invalid',
    }).success,
    false,
  )
})
