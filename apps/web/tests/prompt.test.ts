import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  selectRecentTurns,
  tokenUpperBound,
  retrievalTerms,
  splitDocument,
  messageForContext,
  type ContextMessage,
} from '../src/lib/chat/context-policy'

const message = (
  role: 'user' | 'assistant',
  content: string,
  sequence: number,
): ContextMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
  sequence: String(sequence),
  status: 'completed',
})
test('context retains whole turns and never starts with an orphan assistant', () => {
  const selected = selectRecentTurns([
    message('assistant', 'orphan', 0),
    message('user', 'constraints', 1),
    message('assistant', '长'.repeat(36000), 2),
    message('user', 'continue', 3),
  ])
  assert.deepEqual(
    selected.map((item) => item.content),
    ['continue'],
  )
  assert.equal(tokenUpperBound('中😀'), 15)
  assert.equal(
    messageForContext({
      ...message('assistant', 'partial', 2),
      status: 'cancelled',
    }).includes('已停止'),
    true,
  )
})
test('recent context preserves alternating messages and complete latest turn', () => {
  const source = [
    message('user', 'question', 1),
    message('assistant', 'answer', 2),
    message('user', 'followup', 3),
  ]
  assert.deepEqual(selectRecentTurns(source), source)
})
test('Chinese retrieval indexes internal words and document pages including the tail', () => {
  assert.ok(retrievalTerms('请核对合同终止条款').includes('终止'))
  const chunks = splitDocument(
    '[第 1 页]\n' + '开头'.repeat(1500) + '\n[第 28 页]\n尾部证据 SUPERVALUE',
  )
  assert.ok(chunks.length > 3)
  assert.equal(chunks.at(-1)?.page, 28)
  assert.ok(chunks.at(-1)?.terms.includes('supervalue'))
  assert.ok(chunks.every((item) => item.content.length <= 1000))
  const unicode = splitDocument('头'.repeat(999) + '😀证据'.repeat(600))
  assert.ok(
    unicode.every(
      (chunk) => chunk.content.isWellFormed() && chunk.content.length <= 1000,
    ),
  )
  assert.ok(unicode.some((chunk) => chunk.content.includes('😀证据')))
  const supplementary = retrievalTerms('𠮷野家𠮷野家')
  assert.ok(supplementary.includes('𠮷野'))
  assert.ok(supplementary.every((term) => term.isWellFormed()))
  assert.ok(retrievalTerms('𠮷野家'.repeat(1000)).length <= 500)
})
