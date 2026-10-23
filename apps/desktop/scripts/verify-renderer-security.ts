import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const directory = await mkdtemp(join(tmpdir(), 'velin-renderer-security-'))
try {
  const electronPath: unknown = createRequire(import.meta.url)('electron')
  assert.equal(typeof electronPath, 'string')
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    VELIN_TEST_DIRECTORY: directory,
  }
  delete environment.ELECTRON_RUN_AS_NODE
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      outDir: directory,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: fileURLToPath(
          new URL('../tests/native/renderer-security.ts', import.meta.url),
        ),
        formats: ['es'],
        fileName: () => 'probe.mjs',
      },
      rolldownOptions: { external: ['electron', /^node:/] },
    },
  })
  const result = spawnSync(
    electronPath as string,
    [join(directory, 'probe.mjs')],
    {
      env: environment,
      timeout: 30_000,
      encoding: 'utf8',
    },
  )
  if (result.error) throw result.error
  assert.equal(
    result.status,
    0,
    `Electron security verification failed: ${result.stderr}`,
  )
  const evidence: unknown = JSON.parse(
    await readFile(join(directory, 'result.json'), 'utf8'),
  )
  assert.deepEqual(evidence, {
    permissions: true,
    navigation: true,
    reload: true,
    crash: true,
  })
  process.stdout.write(
    'Electron permissions, navigation and renderer lifecycle verified.\n',
  )
} finally {
  // 等 Electron 子进程退出后再回收临时配置，兼容 Windows 的文件占用。
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
}
