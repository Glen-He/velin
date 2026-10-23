import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterConversations } from '../src/renderer/features/conversations/filter.ts'
import type { Conversation } from '@velin/contracts/chat'

function conversation(id: string, title: string): Conversation {
  return {
    id,
    title,
    messages: [],
    createdAt: 1,
    updatedAt: 2,
  }
}

test('conversation search is case-insensitive and ignores surrounding spaces', () => {
  const conversations = [
    conversation('1', '京都三日游'),
    conversation('2', 'Kyoto itinerary'),
    conversation('3', '前端重构计划'),
  ]
  assert.deepEqual(
    filterConversations(conversations, ' kyoto ').map((item) => item.id),
    ['2'],
  )
  assert.deepEqual(
    filterConversations(conversations, '京都').map((item) => item.id),
    ['1'],
  )
})

test('empty search preserves the full conversation order', () => {
  const conversations = [conversation('1', 'One'), conversation('2', 'Two')]
  assert.equal(filterConversations(conversations, '   '), conversations)
  assert.deepEqual(filterConversations(conversations, 'missing'), [])
})
