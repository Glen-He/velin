import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

function loadConfig(
  databaseUrl?: string,
  overrides: Record<string, string> = {},
) {
  const configUrl = new URL('../src/lib/config.ts', import.meta.url).href
  return spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `const { config } = await import(${JSON.stringify(configUrl)}); process.exitCode = config.databaseUrl === process.env.DATABASE_URL && config.passkeyRpId === new URL(config.appUrl).hostname ? 0 : 2;`,
    ],
    {
      encoding: 'utf8',
      timeout: 10_000,
      // 独立环境验证启动边界，不继承开发者的数据库或凭据配置。
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        BETTER_AUTH_SECRET:
          'velin-config-fixture-secret-at-least-32-characters',
        ...(databaseUrl === undefined ? {} : { DATABASE_URL: databaseUrl }),
        ...overrides,
      },
    },
  )
}

test('database configuration is required and rejects empty or non-PostgreSQL URLs', () => {
  for (const value of [undefined, '', 'not-a-url', 'https://example.test/db']) {
    const result = loadConfig(value)
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(
      result.stderr,
      /Invalid web server configuration:\nDATABASE_URL:/,
    )
  }
})

test('service origins cannot carry credentials or hidden paths, and RP ID follows the configured host', () => {
  const database = 'postgresql://localhost/velin_config_test'
  for (const url of [
    'https://private-user:private-password@example.test',
    'https://example.test/path',
    'https://example.test/?token=fixture',
    'http://example.test',
  ]) {
    const result = loadConfig(database, { APP_URL: url })
    assert.equal(result.status, 1)
    assert.doesNotMatch(result.stderr, /private-user|private-password/)
  }
  assert.equal(
    loadConfig(database, { APP_URL: 'https://example.test' }).status,
    0,
  )
  const invalidRp = loadConfig(database, {
    APP_URL: 'https://example.test',
    PASSKEY_RP_ID: 'localhost',
  })
  assert.equal(invalidRp.status, 1)
  assert.match(invalidRp.stderr, /PASSKEY_RP_ID must match/)
})

test('both PostgreSQL URL schemes preserve the explicitly configured connection', () => {
  for (const scheme of ['postgres', 'postgresql']) {
    const result = loadConfig(
      `${scheme}://fixture:fixture@localhost:5432/velin_config_test`,
    )
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
  }
})

test('invalid connection configuration never prints database credentials', () => {
  const result = loadConfig(
    'https://private-user:private-password@example.test/db',
  )
  assert.equal(result.status, 1)
  assert.doesNotMatch(result.stderr, /private-user|private-password/)
})
