import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buttonWidthTier } from '../src/button-policy.ts'

test('Chinese action labels use even tiers, including odd counts and long labels', () => {
  for (const [label, expected] of [
    ['关闭', 2],
    ['下一步', 4],
    ['安全设置', 4],
    ['退出其他设备', 6],
    ['继续使用当前账号', 8],
    ['继续使用当前账号登录', 10],
  ] as const)
    assert.equal(buttonWidthTier(label), expected)
})
test('graphemes and Latin labels are measured without counting surrogate units', () => {
  assert.equal(buttonWidthTier('👨‍👩‍👧‍👦'), 2)
  assert.equal(buttonWidthTier('👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦'), 4)
  assert.equal(buttonWidthTier('Cancel'), 4)
  assert.equal(buttonWidthTier('  关闭  '), 2)
  assert.equal(buttonWidthTier(''), 2)
})
