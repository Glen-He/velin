import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPackagingConfiguration } from '../scripts/packaging-config'

test('packaging requires a fixed HTTPS origin and release signing configuration', () => {
  assert.throws(
    () => createPackagingConfiguration({}, false),
    /VELIN_API_SERVER_URL/,
  )
  for (const value of [
    'http://localhost:3000',
    'https://user:secret@example.test',
    'https://example.test/api',
    'https://example.test/?token=fixture',
  ]) {
    assert.throws(
      () =>
        createPackagingConfiguration({ VELIN_API_SERVER_URL: value }, false),
      /HTTPS/,
    )
  }
  const environment = { VELIN_API_SERVER_URL: 'https://velin.example.test' }
  assert.throws(
    () => createPackagingConfiguration(environment, true),
    /VELIN_UPDATE_URL/,
  )
  assert.throws(
    () =>
      createPackagingConfiguration(
        {
          ...environment,
          VELIN_UPDATE_URL: 'https://updates.example.test/stable',
        },
        true,
      ),
    /VELIN_WINDOWS_PUBLISHER/,
  )
  const configuration = createPackagingConfiguration(environment, false)
  assert.equal(configuration.asar, true)
  assert.deepEqual(configuration.protocols, [
    { name: 'Velin authentication', schemes: ['com.velin.desktop'] },
  ])
  assert.equal(configuration.win?.verifyUpdateCodeSignature, true)
})
