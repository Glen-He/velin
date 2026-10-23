import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatOcrPageRange,
  parseOcrPageRange,
} from '@velin/contracts/attachments'

test('OCR page ranges accept common separators and normalize order', () => {
  assert.deepEqual(parseOcrPageRange(' 3-5，8、10 '), {
    ok: true,
    pages: [3, 4, 5, 8, 10],
  })
  assert.deepEqual(parseOcrPageRange('5-3'), {
    ok: true,
    pages: [3, 4, 5],
  })
  assert.equal(parseOcrPageRange('  '), null)
  const fullRange = parseOcrPageRange('1-300')
  assert.equal(fullRange?.ok, true)
  assert.equal(fullRange?.ok ? fullRange.pages.length : 0, 300)
  assert.equal(fullRange?.ok ? fullRange.pages.at(-1) : undefined, 300)
  assert.deepEqual(parseOcrPageRange('1-301'), {
    ok: false,
    error: 'limit',
  })
  assert.deepEqual(parseOcrPageRange('0'), {
    ok: false,
    error: 'format',
  })
  assert.deepEqual(parseOcrPageRange('1,,2'), {
    ok: false,
    error: 'format',
  })
  assert.equal(formatOcrPageRange([5, 3, 4, 8]), '3-5,8')
})
