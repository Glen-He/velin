import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build, createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import desktopConfig from '../vite.config.ts'

test('renderer builds never trust development servers, including development build mode', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'velin-renderer-csp-'))
  let server: ViteDevServer | undefined
  context.after(async () => {
    await server?.close()
    await rm(root, { recursive: true, force: true })
  })
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  await writeFile(
    join(root, 'index.html'),
    html.replace('/src/renderer/main.tsx', '/entry.js'),
  )
  await writeFile(
    join(root, 'entry.js'),
    'document.getElementById("root").textContent = "Velin"',
  )
  assert.equal(typeof desktopConfig, 'function')
  // 使用项目真实 CSP 与 React 插件；此夹具不启动 Electron Main。
  for (const mode of ['production', 'development']) {
    const config = await desktopConfig({ command: 'build', mode })
    const outDir = `dist-${mode}`
    await build({
      root,
      configFile: false,
      mode,
      html: config.html,
      plugins: config.plugins?.slice(0, 2),
      logLevel: 'silent',
      build: { outDir },
    })
    const output = await readFile(join(root, outDir, 'index.html'), 'utf8')
    assert.match(output, /script-src 'self';/)
    assert.match(output, /connect-src 'self';/)
    assert.doesNotMatch(
      output,
      /localhost|127\.0\.0\.1|ws:\/\/|wss:\/\/|nonce-/,
    )
  }

  const config = await desktopConfig({ command: 'serve', mode: 'development' })
  server = await createServer({
    root,
    configFile: false,
    html: config.html,
    plugins: config.plugins?.slice(0, 2),
    logLevel: 'silent',
    server: { ...config.server, host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const origin = server.resolvedUrls?.local[0]
  assert.ok(origin)
  const response = await fetch(origin)
  assert.equal(response.status, 200)
  assert.equal(
    response.headers.get('content-security-policy'),
    "frame-ancestors 'none'",
  )
  const developmentHtml = await response.text()
  const nonce = config.html?.cspNonce
  assert.ok(nonce)
  assert.ok(developmentHtml.includes(`script-src 'self' 'nonce-${nonce}'`))
  assert.ok(
    developmentHtml.includes(
      `connect-src 'self' ${origin.replace(/^http/, 'ws').replace(/\/$/, '')};`,
    ),
  )
  assert.ok(developmentHtml.includes(`nonce="${nonce}"`))
  assert.doesNotMatch(developmentHtml, /localhost:5173/)
})

test('renderer development entry serves the shared font CSS and referenced WOFF2 files', async (context) => {
  const cache = await mkdtemp(join(tmpdir(), 'velin-renderer-fonts-'))
  let server: ViteDevServer | undefined
  context.after(async () => {
    await server?.close()
    await rm(cache, { recursive: true, force: true })
  })
  assert.equal(typeof desktopConfig, 'function')
  const config = await desktopConfig({ command: 'serve', mode: 'development' })
  // 编译真实 Renderer 入口，覆盖共享 CSS 的嵌套 import；不启动 Electron Main。
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: false,
    cacheDir: cache,
    html: config.html,
    plugins: config.plugins?.slice(0, 2),
    logLevel: 'silent',
    server: { ...config.server, host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const origin = server.resolvedUrls?.local[0]
  assert.ok(origin)
  const response = await fetch(
    new URL('/src/renderer/index.css?direct', origin),
  )
  assert.equal(response.status, 200)
  const css = await response.text()
  const fonts = [
    ...css.matchAll(
      /url\(["']?([^\s)"']*(han-sans-common|inter-latin-normal|inter-latin-italic)-[^\s)"']*\.woff2)["']?\)/g,
    ),
  ]
  assert.deepEqual(fonts.map((match) => match[2]).sort(), [
    'han-sans-common',
    'inter-latin-italic',
    'inter-latin-normal',
  ])
  for (const [, font] of fonts) {
    const resource = await fetch(new URL(font, origin))
    assert.equal(resource.status, 200, font)
    const bytes = Buffer.from(await resource.arrayBuffer())
    assert.equal(bytes.subarray(0, 4).toString(), 'wOF2')
  }
})
