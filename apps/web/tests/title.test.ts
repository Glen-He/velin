import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeGeneratedTitle } from '@velin/contracts/chat'

test('generated titles strip prefixes, quotes and ending punctuation', () => {
  assert.equal(
    normalizeGeneratedTitle('标题：“京都三日游规划”。'),
    '京都三日游规划',
  )
  assert.equal(
    normalizeGeneratedTitle('  Title:  "Kyoto three-day itinerary"  '),
    'Kyoto three-day itinerary',
  )
  assert.equal(normalizeGeneratedTitle('秋天\n山野散文。'), '秋天 山野散文')
})

test('generated titles reject unusable output and cap long titles', () => {
  assert.equal(normalizeGeneratedTitle('   '), null)
  assert.equal(normalizeGeneratedTitle('。！？'), null)
  assert.equal(normalizeGeneratedTitle('字'.repeat(121)), null)
  assert.equal(normalizeGeneratedTitle('字'.repeat(40)), `${'字'.repeat(30)}…`)
})
