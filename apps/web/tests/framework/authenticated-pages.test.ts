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
    const password = 'Velin SSR fixture phrase 20261004!'
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
        const html = await response.text()
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
