import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { hashPassword } from 'better-auth/crypto'

const databaseUrl = process.env.VELIN_TEST_DATABASE_URL
if (databaseUrl) assert.match(new URL(databaseUrl).pathname, /^\/velin_.*test$/)

test(
  'authenticated Next.js pages complete SSR without a client-rendering bailout',
  { skip: !databaseUrl, timeout: 45_000 },
  async () => {
    const reservation = createServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    const address = reservation.address()
    assert.ok(address && typeof address === 'object')
    const port = address.port
    await new Promise<void>((resolve) => reservation.close(() => resolve()))
    const origin = `https://velin.example.test`
    const baseUrl = `http://127.0.0.1:${port}`
    Object.assign(process.env, {
      NODE_ENV: 'production',
      DATABASE_URL: databaseUrl,
      APP_URL: origin,
      HOST: '127.0.0.1',
      PORT: String(port),
      BETTER_AUTH_SECRET: 'velin-ssr-fixture-secret-at-least-32-characters',
      PASSKEY_RP_ID: 'velin.example.test',
      GOOGLE_CLIENT_ID: 'fixture',
      GOOGLE_CLIENT_SECRET: 'fixture',
      EMAIL_TRANSPORT: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '9',
      SMTP_USER: 'fixture',
      SMTP_PASSWORD: 'fixture',
      SMTP_SECURE: 'false',
      DEEPSEEK_API_KEY: 'fixture-not-used',
      TRUSTED_PROXY_ADDRESSES: '',
    })
    const { auth } = await import('../../src/lib/auth/server')
    const { databasePool } = await import('../../src/lib/database/connection')
    const context = await auth.$context
    const email = `ssr-${crypto.randomUUID()}@example.test`
    const password = 'Velin-SSR-fixture-20261004!'
    const user = await context.internalAdapter.createUser(
      { name: 'SSR 测试账号', email, emailVerified: true },
      { method: 'email-password' },
    )
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'scripts/web-server.ts', 'production'],
      { env: { ...process.env }, stdio: 'ignore' },
    )
    const stopped = once(child, 'exit')
    try {
      await context.internalAdapter.createAccount({
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password: await hashPassword(password),
      })
      let ready = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        assert.equal(
          child.exitCode,
          null,
          'Next.js fixture exited during startup',
        )
        try {
          ready = (await fetch(`${baseUrl}/api/health`)).ok
        } catch {
          /* 启动期间等待监听端口。 */
        }
        if (ready) break
        await delay(100)
      }
      assert.ok(ready, 'Next.js fixture did not become ready')
      const login = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      assert.equal(login.status, 200)
      const credentials = (await login.json()) as { token: string }
      assert.equal(typeof credentials.token, 'string')
      const cookie = login.headers
        .getSetCookie()
        .map((value) => value.split(';', 1)[0])
        .join('; ')
      assert.ok(cookie)
      // 穿过真实 Node/Next HTTP 入口，非法文本不能占用模型额度。
      const requestId = crypto.randomUUID()
      const invalidMessage = await fetch(`${baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId,
          conversationId: crypto.randomUUID(),
          userMessageId: crypto.randomUUID(),
          content: 'invalid\u0000',
        }),
      })
      assert.equal(invalidMessage.status, 400)
      assert.ok(invalidMessage.headers.get('x-request-id'))
      assert.equal(
        (
          await databasePool.query(
            'select 1 from chat_request_usage where request_id=$1',
            [requestId],
          )
        ).rowCount,
        0,
      )
      for (const path of [
        '/security',
        '/security/passkeys',
        '/account/sessions',
        '/account',
      ]) {
        const response = await fetch(baseUrl + path, {
          headers: { cookie },
          redirect: 'manual',
        })
        assert.equal(response.status, 200, path)
        const policy = response.headers.get('content-security-policy') ?? ''
        assert.match(policy, /frame-ancestors 'none'/, path)
        const nonce = policy.match(
          /script-src 'self' 'nonce-([^']+)' 'strict-dynamic'/,
        )?.[1]
        assert.ok(nonce, path)
        assert.doesNotMatch(
          policy,
          /unsafe-eval|script-src[^;]*unsafe-inline/,
          path,
        )
        assert.equal(response.headers.get('x-frame-options'), 'DENY', path)
        const html = await response.text()
        for (const script of html.matchAll(/<script\b[^>]*>/g)) {
          assert.ok(
            script[0].includes(`nonce="${nonce}"`),
            script[0].slice(0, 100),
          )
        }
        assert.doesNotMatch(
          html,
          /Missing getServerSnapshot|Switched to client rendering|<template[^>]*data-(?:msg|dgst)=/,
          path,
        )
        assert.equal(
          html.includes(credentials.token),
          false,
          'SSR must not serialize session credentials',
        )
        if (path === '/account') {
          // 验证真实发布 URL 与缓存，不把源码中的字体文件存在视为资源已发布。
          const stylesheets = new Set(
            [...html.matchAll(/href="([^"\s]+\.css)"/g)].map(
              (match) => match[1],
            ),
          )
          const checkedFonts = new Set<string>()
          for (const stylesheet of stylesheets) {
            const cssResponse = await fetch(new URL(stylesheet, baseUrl))
            assert.equal(cssResponse.status, 200)
            const css = await cssResponse.text()
            const fonts = css.matchAll(
              /url\(["']?([^\s)"']*(han-sans-common|inter-latin-normal|inter-latin-italic)-[^\s)"']*\.woff2)["']?\)/g,
            )
            for (const [, font, family] of fonts) {
              const fontUrl = new URL(font, cssResponse.url)
              const fontResponse = await fetch(fontUrl)
              assert.equal(fontResponse.status, 200, fontUrl.href)
              assert.match(
                fontResponse.headers.get('content-type') ?? '',
                /font\/woff2/,
              )
              assert.match(
                fontResponse.headers.get('cache-control') ?? '',
                /immutable/,
              )
              const bytes = Buffer.from(await fontResponse.arrayBuffer())
              assert.equal(bytes.subarray(0, 4).toString(), 'wOF2')
              checkedFonts.add(family)
            }
          }
          assert.deepEqual(
            [...checkedFonts].sort(),
            ['han-sans-common', 'inter-latin-italic', 'inter-latin-normal'],
            'Published CSS must serve both shared font families and real italic',
          )
        }
      }
    } finally {
      child.kill('SIGTERM')
      const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000)
      await stopped
      clearTimeout(deadline)
      await databasePool.query('delete from "user" where id = $1', [user.id])
      await databasePool.query('delete from "rateLimit" where key = $1', [
        '127.0.0.1|/sign-in/email',
      ])
      await databasePool.end()
    }
  },
)
