import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatKeyAction } from '../src/features/chat/keyboard-policy.ts'
const key = {
  key: 'Enter',
  isComposing: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
}
test('composition owns Enter and Escape even with submission modifiers', () => {
  for (const value of ['Enter', 'Escape'])
    for (const send of [true, false]) {
      assert.equal(
        chatKeyAction(
          {
            ...key,
            key: value,
            isComposing: true,
            ctrlKey: true,
            metaKey: true,
          },
          send,
        ),
        'none',
      )
    }
})
test('submission preferences preserve newline and explicit send shortcuts', () => {
  assert.equal(chatKeyAction(key, true), 'submit')
  assert.equal(chatKeyAction({ ...key, shiftKey: true }, true), 'none')
  assert.equal(chatKeyAction(key, false), 'none')
  assert.equal(chatKeyAction({ ...key, metaKey: true }, false), 'submit')
  assert.equal(chatKeyAction({ ...key, ctrlKey: true }, false), 'submit')
  assert.equal(chatKeyAction({ ...key, key: 'Escape' }, false), 'cancel')
})
