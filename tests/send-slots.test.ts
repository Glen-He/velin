import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSendSlots } from '../apps/auth-web/src/security/send-slot-store.ts'

test('delivery and cooldown belong to recipients, including a return to the previous one', () => {
  let now = 1000
  const store = createSendSlots(60000, () => now)
  const first = store.begin('old@example.test')!
  assert.ok(first)
  assert.equal(store.begin('old@example.test'), null)
  store.delivered(first)
  store.settle(first)
  const second = store.begin('new@example.test')!
  assert.ok(second)
  assert.equal(store.getSnapshot().slots['new@example.test'].sent, false)
  assert.equal(store.begin('old@example.test'), null)
  now += 60000
  store.tick()
  assert.ok(store.begin('old@example.test'))
})

test('failed sends do not start cooldown; old tickets cannot settle new requests', () => {
  const store = createSendSlots(60000)
  const first = store.begin('address')!
  store.settle(first)
  assert.equal(store.getSnapshot().slots.address.sent, false)
  const second = store.begin('address')!
  store.delivered(first)
  store.settle(first)
  assert.equal(store.getSnapshot().slots.address.sent, false)
  assert.equal(store.getSnapshot().slots.address.pending, true)
  store.delivered(second)
  store.settle(second)
  assert.equal(store.getSnapshot().slots.address.sent, true)
  assert.equal(store.getSnapshot().slots.address.pending, false)
})
