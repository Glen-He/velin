import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLogger } from '../apps/auth-server/src/logging.ts'

test('structured logs keep English events and whitelist error fields', () => {
  const lines: string[] = []
  const logger = createLogger((_level, line) => lines.push(line))
  const error = Object.assign(new Error('密码 secret-value'), {
    code: 'ECONNRESET',
    cookie: 'session-secret',
    password: 'password-secret',
  })
  logger.error('database.pool_error', { error })
  const entry = JSON.parse(lines[0])
  assert.equal(entry.event, 'database.pool_error')
  assert.equal(entry.level, 'error')
  assert.deepEqual(entry.error, { name: 'Error', code: 'ECONNRESET' })
  assert.doesNotMatch(lines[0], /secret|密码/)
})

test('runtime objects and unknown field names cannot leak into a log', () => {
  const lines: string[] = []
  const logger = createLogger((_level, line) => lines.push(line))
  const fields = {
    signal: 'SIGTERM',
    cookie: 'secret',
    error: { message: 'secret' },
  }
  logger.info('server.shutdown_requested', fields)
  assert.equal(JSON.parse(lines[0]).signal, 'SIGTERM')
  assert.deepEqual(JSON.parse(lines[0]).error, { name: 'UnknownError' })
  assert.doesNotMatch(lines[0], /secret|cookie/)
})
