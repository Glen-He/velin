import assert from 'node:assert/strict'
import { test } from 'node:test'
import { serviceOrigin } from '@velin/contracts/service-url'

test('service origins require HTTPS and reject credentials or hidden paths', () => {
  assert.equal(
    serviceOrigin('https://api.example.test/', false),
    'https://api.example.test',
  )
  for (const url of [
    'http://api.example.test',
    'http://192.168.1.2',
    'https://user:password@api.example.test',
    'https://api.example.test/api',
    'https://api.example.test?key=value',
    'https://api.example.test#fragment',
    ' https://api.example.test',
  ]) {
    assert.throws(() => serviceOrigin(url, true), undefined, url)
  }
})

test('plain HTTP loopback is available only in explicit development mode', () => {
  for (const url of [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ]) {
    assert.equal(serviceOrigin(url, true), url)
    assert.throws(() => serviceOrigin(url, false))
  }
})
