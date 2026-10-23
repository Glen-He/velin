import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  contextDate,
  recallPlanSchema,
  recallQueries,
  fuseRecallCandidates,
  selectRecallEvidence,
  type RecallCandidate,
} from '../src/lib/chat/recall-policy'
import { memoryActionSchema } from '@velin/contracts/memory'

const candidate = (
  id: string,
  content = '用户确认的原始证据',
): RecallCandidate => ({
  id,
  messageId: crypto.randomUUID(),
  conversationId: crypto.randomUUID(),
  title: 'Fixture',
  role: 'user',
  createdAt: 0,
  updatedAt: 0,
  content,
  revision: '1',
  sequence: '1',
  position: 0,
})
test('recall planning rejects invalid time windows and privilege parameters', () => {
  assert.equal(
    contextDate('Asia/Shanghai', new Date('2026-03-01T23:30:00Z')),
    '2026-03-02',
  )
  assert.equal(
    contextDate('America/New_York', new Date('2026-03-01T23:30:00Z')),
    '2026-03-01',
  )
  assert.equal(
    recallPlanSchema.safeParse({
      queries: [],
      after: '2026-12-01',
      before: '2026-01-01',
    }).success,
    false,
  )
  assert.equal(
    recallPlanSchema.safeParse({
      queries: [],
      after: '2026-02-30',
      before: null,
    }).success,
    false,
  )
  assert.equal(
    recallPlanSchema.safeParse({
      queries: [],
      after: null,
      before: null,
      userId: 'another-account',
    }).success,
    false,
  )
  assert.deepEqual(
    recallQueries('原始查询', {
      queries: ['同义检索', '原始查询'],
      after: null,
      before: null,
    }),
    ['原始查询', '同义检索'],
  )
  assert.equal(
    memoryActionSchema.safeParse({ action: 'settings' }).success,
    false,
  )
  assert.equal(
    memoryActionSchema.safeParse({
      action: 'settings',
      referenceHistory: false,
    }).success,
    true,
  )
})
test('rank fusion cannot amplify a repeated candidate inside one search channel', () => {
  const first = candidate('first'),
    second = candidate('second')
  const combined = fuseRecallCandidates([
    [first, first, first, second],
    [second],
  ])
  assert.equal(combined[0].id, second.id)
  assert.equal(combined.length, 2)
})
test('semantic selection cannot invent source identities or rewrite evidence', () => {
  const source = candidate('one', '编号 ＡＢＣ-731，已确认，不能修改原话。')
  assert.deepEqual(
    selectRecallEvidence([source], {
      evidence: [
        { id: 'invented', quote: '伪造' },
        { id: 'one', quote: '编号 ABC-731' },
        { id: 'one', quote: '已确认' },
        { id: 'one', quote: '不能修改' },
      ],
    }),
    [source],
  )
})
