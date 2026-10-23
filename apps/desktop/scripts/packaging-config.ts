import type { Configuration } from 'electron-builder'

function httpsUrl(value: string | undefined, originOnly = false) {
  if (!value) throw new Error('Packaging requires VELIN_API_SERVER_URL.')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Packaging URL is invalid.')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (originOnly && url.pathname !== '/')
  )
    throw new Error(
      'Packaging URLs must use HTTPS without credentials or query parameters.',
    )
  return url.href
}

export function createPackagingConfiguration(
  environment: NodeJS.ProcessEnv,
  release: boolean,
): Configuration {
  httpsUrl(environment.VELIN_API_SERVER_URL, true)
  const updateUrl = environment.VELIN_UPDATE_URL
    ? httpsUrl(environment.VELIN_UPDATE_URL)
    : undefined
  if (release && !updateUrl)
    throw new Error('Release requires VELIN_UPDATE_URL.')
  if (release && !environment.VELIN_WINDOWS_PUBLISHER)
    throw new Error('Release requires VELIN_WINDOWS_PUBLISHER.')
  if (
    release &&
    process.platform === 'darwin' &&
    !(
      environment.APPLE_API_KEY &&
      environment.APPLE_API_KEY_ID &&
      environment.APPLE_API_ISSUER
    )
  )
    throw new Error('macOS release requires notarization credentials.')
  return {
    appId: 'com.velin.desktop',
    productName: 'Velin',
    asar: true,
    directories: { output: 'release' },
    files: [
      'dist/**/*',
      'dist-electron/**/*',
      'package.json',
      '!**/.env*',
      '!**/*.map',
    ],
    extraResources: [
      {
        from: '../../packages/ui/fonts/LICENSE.txt',
        to: 'licenses/han-sans.txt',
      },
      {
        from: '../../packages/ui/fonts/INTER-LICENSE.txt',
        to: 'licenses/inter.txt',
      },
    ],
    protocols: [
      { name: 'Velin authentication', schemes: ['com.velin.desktop'] },
    ],
    forceCodeSigning: release,
    npmRebuild: false,
    mac: {
      target: ['dmg', 'zip'],
      category: 'public.app-category.productivity',
      minimumSystemVersion: '13.0',
      hardenedRuntime: true,
      notarize: release,
    },
    win: {
      target: ['nsis'],
      verifyUpdateCodeSignature: true,
      ...(environment.VELIN_WINDOWS_PUBLISHER
        ? { publisherName: environment.VELIN_WINDOWS_PUBLISHER }
        : {}),
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false,
    },
    publish: updateUrl ? [{ provider: 'generic', url: updateUrl }] : null,
    electronUpdaterCompatibility: '>=6.8.11',
    artifactName: 'Velin-${version}-${os}-${arch}.${ext}',
  }
}
