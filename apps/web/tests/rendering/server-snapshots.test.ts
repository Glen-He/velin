import assert from 'node:assert/strict'
import { createElement } from 'react'
import { test } from 'node:test'
import { renderToString } from 'react-dom/server'
import { usePasskeyList } from '../../src/components/security/passkey-list'
import { useSessions } from '../../src/components/account/useSessions'
import { createPasskeyList } from '../../src/components/security/passkey-list-store'
import { createSessionList } from '../../src/components/account/session-list-store'
import { createSendSlots } from '../../src/components/security/send-slot-store'
import { useSendSlot } from '../../src/components/security/useSendSlot'

function SnapshotProbe({ userId }: { userId: string | null }) {
  const passkeys = usePasskeyList(userId)
  const sessions = useSessions(userId, null)
  const send = useSendSlot('ssr@example.test')
  return createElement(
    'output',
    null,
    JSON.stringify({
      passkeys: passkeys.passkeys,
      sessions: sessions.sessions,
      sent: send.sent,
      pending: send.pending,
      remaining: send.remaining,
    }),
  )
}

test('external stores support server rendering without browser APIs or side effects', () => {
  assert.equal(typeof window, 'undefined')
  const html = renderToString(
    createElement(SnapshotProbe, { userId: 'first-user' }),
  )
  assert.match(html, /passkeys&quot;:null/)
  assert.match(html, /sessions&quot;:null/)
  assert.match(html, /remaining&quot;:0/)
})

test('initial server output is deterministic and isolated across account scopes', () => {
  const render = (userId: string | null) =>
    renderToString(createElement(SnapshotProbe, { userId }))
  assert.equal(render('first-user'), render('second-user'))
  assert.equal(render(null), render('first-user'))
})

test('hydration snapshots remain stable after client reads and cooldown changes', async () => {
  const passkeys = createPasskeyList(async () => ({ data: [] }))
  const sessions = createSessionList({
    list: async () => ({ data: [] }),
    revoke: async () => ({}),
    revokeOthers: async () => ({}),
  })
  const sends = createSendSlots(60_000, () => 1000)
  const snapshots = [
    passkeys.getServerSnapshot(),
    sessions.getServerSnapshot(),
    sends.getServerSnapshot(),
  ]
  await passkeys.selectAccount('fixture-user')
  await sessions.selectAccount('fixture-user', 'fixture-token')
  const ticket = sends.begin('ssr@example.test')!
  sends.delivered(ticket)
  sends.tick()
  for (const [index, store] of [passkeys, sessions, sends].entries()) {
    assert.equal(store.getServerSnapshot(), snapshots[index])
    assert.notEqual(store.getSnapshot(), snapshots[index])
  }
})
