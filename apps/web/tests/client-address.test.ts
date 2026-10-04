import assert from 'node:assert/strict'
import { test } from 'node:test'
import { trustedClientAddress } from '../src/lib/http/client-address'

test('untrusted peers cannot choose the authentication rate-limit address', () => {
  assert.equal(
    trustedClientAddress('203.0.113.77', '198.51.100.88', ['127.0.0.1']),
    '203.0.113.77',
  )
  assert.equal(
    trustedClientAddress('::ffff:127.0.0.1', '198.51.100.88, 203.0.113.78', [
      '127.0.0.1',
    ]),
    '203.0.113.78',
  )
  assert.equal(
    trustedClientAddress('127.0.0.1', 'malformed, 198.51.100.88', [
      '127.0.0.1',
    ]),
    '127.0.0.1',
  )
  assert.equal(
    trustedClientAddress(undefined, '198.51.100.88', ['127.0.0.1']),
    null,
  )
})
