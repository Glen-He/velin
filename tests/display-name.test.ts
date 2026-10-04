import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isValidDisplayName } from '@velin/contracts/policy'

test('display names accept the full Unicode limit rather than a UTF-16 half limit', () => {
  assert.equal(isValidDisplayName('🪐'.repeat(32)), true)
  assert.equal(isValidDisplayName('𠮷'.repeat(32)), true)
  assert.equal(isValidDisplayName('🪐'.repeat(33)), false)
  assert.equal(isValidDisplayName('a'.repeat(33)), false)
})

test('display name writes reject empty input and embedded control characters', () => {
  for (const name of ['', '  ', 'name\nnext', 'name\u0000', 'name\u007f']) {
    assert.equal(isValidDisplayName(name), false)
  }
  assert.equal(isValidDisplayName('  花温酒  '), true)
})
