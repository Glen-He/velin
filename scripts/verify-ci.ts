import { spawnSync } from 'node:child_process'

const database = process.env.VELIN_TEST_DATABASE_URL
if (!database || !/^\/velin_.*test$/.test(new URL(database).pathname))
  throw new Error(
    'CI requires an isolated VELIN_TEST_DATABASE_URL ending in test.',
  )
const environment = {
  ...process.env,
  DATABASE_URL: database,
  VELIN_OCR_LOAD_TEST: '1',
}
for (const args of [
  ['db:migrate'],
  ['test'],
  ['--filter', '@velin/web', 'test:pages'],
]) {
  const result = spawnSync('pnpm', args, {
    env: environment,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
