import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const command = process.argv[2]
if (command !== 'build' && command !== 'typegen')
  throw new Error('Next command must be build or typegen.')
const applicationDirectory = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)

// 生成文件可能被本地同步工具复制为冲突副本；从源文件完整重建，不能改写生成类型。
if (command === 'build')
  await rm(resolve(applicationDirectory, '.next'), {
    recursive: true,
    force: true,
  })
else {
  await rm(resolve(applicationDirectory, '.next/types'), {
    recursive: true,
    force: true,
  })
  await rm(resolve(applicationDirectory, '.next/dev/types'), {
    recursive: true,
    force: true,
  })
}

function run(entry: string, args: string[]) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: applicationDirectory,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run(require.resolve('next/dist/bin/next'), [command])
