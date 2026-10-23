import { build, Platform, Arch } from 'electron-builder'
import { readFile } from 'node:fs/promises'
import { createPackagingConfiguration } from './packaging-config.ts'

const release = process.argv.includes('--release')
const directory = process.argv.includes('--dir')
if (
  process.argv.slice(2).some((value) => !['--release', '--dir'].includes(value))
)
  throw new Error('Unknown packaging option.')
if (release && directory)
  throw new Error('Release requires installable artifacts.')
if (!['darwin', 'win32'].includes(process.platform))
  throw new Error('Build on macOS ARM or Windows x64.')
if (process.platform === 'darwin' && process.arch !== 'arm64')
  throw new Error('macOS builds require ARM64.')
const platform = process.platform === 'darwin' ? Platform.MAC : Platform.WINDOWS
const configuration = createPackagingConfiguration(process.env, release)
const metadata: unknown = JSON.parse(
  await readFile(
    new URL('../dist-electron/build-config.json', import.meta.url),
    'utf8',
  ),
)
if (
  !metadata ||
  typeof metadata !== 'object' ||
  !('serviceUrl' in metadata) ||
  metadata.serviceUrl !== new URL(process.env.VELIN_API_SERVER_URL!).origin
) {
  throw new Error(
    'Rebuild the desktop app with the same VELIN_API_SERVER_URL before packaging.',
  )
}
await build({
  targets: platform.createTarget(
    directory ? ['dir'] : undefined,
    process.platform === 'darwin' ? Arch.arm64 : Arch.x64,
  ),
  publish: 'never',
  config: configuration,
})
