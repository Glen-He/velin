import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hashPassword } from 'better-auth/crypto'

const enabled = Boolean(process.env.VELIN_TEST_DATABASE_URL)
if (enabled) {
  const url = new URL(process.env.VELIN_TEST_DATABASE_URL!)
  assert.match(url.pathname, /^\/velin_.*test$/)
  Object.assign(process.env, {
    DATABASE_URL: url.href,
    NODE_ENV: 'production',
    BETTER_AUTH_SECRET:
      'velin-production-fixture-secret-at-least-32-characters',
    APP_URL: 'https://velin.example.test',
    GOOGLE_CLIENT_ID: 'fixture-client-id',
    GOOGLE_CLIENT_SECRET: 'fixture-client-secret',
    DEEPSEEK_API_KEY: 'fixture-not-used-for-model-requests',
    EMAIL_TRANSPORT: 'smtp',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '9',
    SMTP_USER: 'fixture',
    SMTP_PASSWORD: 'fixture',
    SMTP_SECURE: 'false',
    TRUSTED_PROXY_ADDRESSES: '127.0.0.1',
  })
}

test(
  'production configuration enforces HTTP limits and hides development codes',
  { skip: !enabled },
  async () => {
    const { createApiFixture } = await import('./request-api')
    const { auth } = await import('../src/lib/auth/server')
    const { databasePool: db } = await import('../src/lib/database/connection')
    const app = await createApiFixture()
    const ctx = await auth.$context
    const email = `production-${crypto.randomUUID()}@example.test`
    const user = await ctx.internalAdapter.createUser(
      { name: email, email, emailVerified: true },
      { method: 'email-password' },
    )
    const password = 'Velin-production-fixture-92482!'
    try {
      await ctx.internalAdapter.createAccount({
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password: await hashPassword(password),
      })
      const post = (path: string, body: unknown, cookie = '') =>
        app.request(
          path,
          {
            method: 'POST',
            headers: {
              origin: 'https://velin.example.test',
              'content-type': 'application/json',
              cookie,
              'x-forwarded-for': '198.51.100.88',
              'x-velin-client-address': '198.51.100.88',
            },
            body: JSON.stringify(body),
          },
          { incoming: { socket: { remoteAddress: '203.0.113.77' } } },
        )
      const login = await post('/api/auth/sign-in/email', { email, password })
      assert.equal(login.status, 200)
      const cookies = login.headers.getSetCookie()
      assert.ok(cookies.some((value) => /;\s*Secure/i.test(value)))
      const cookie = cookies.map((value) => value.split(';', 1)[0]).join('; ')
      const session = await auth.api.getSession({
        headers: new Headers({ cookie }),
      })
      assert.equal(session?.session.ipAddress, '203.0.113.77')
      const proxyLogin = await app.request(
        '/api/auth/sign-in/email',
        {
          method: 'POST',
          headers: {
            origin: 'https://velin.example.test',
            'content-type': 'application/json',
            'x-forwarded-for': '198.51.100.88, 203.0.113.78',
          },
          body: JSON.stringify({ email, password }),
        },
        { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
      )
      assert.equal(proxyLogin.status, 200)
      const proxyCookie = proxyLogin.headers
        .getSetCookie()
        .map((value) => value.split(';', 1)[0])
        .join('; ')
      assert.equal(
        (
          await auth.api.getSession({
            headers: new Headers({ cookie: proxyCookie }),
          })
        )?.session.ipAddress,
        '203.0.113.78',
      )
      const integer = await db.query<{ value: bigint }>(
        'select 9007199254740993::bigint as value',
      )
      assert.equal(integer.rows[0].value, 9007199254740993n)
      let limitedLogin: Response | undefined
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await app.request(
          '/api/auth/sign-in/email',
          {
            method: 'POST',
            headers: {
              origin: 'https://velin.example.test',
              'content-type': 'application/json',
              'x-velin-client-address': `198.51.100.${attempt + 10}`,
              'x-forwarded-for': `198.51.100.${attempt + 10}`,
            },
            body: JSON.stringify({
              email,
              password: 'invalid-fixture-password',
            }),
          },
          { incoming: { socket: { remoteAddress: '203.0.113.77' } } },
        )
        if (response.status === 429) {
          limitedLogin = response
          break
        }
      }
      assert.ok(
        limitedLogin,
        'spoofed address headers must not bypass login limits',
      )
      const retryAfter = Number(limitedLogin.headers.get('Retry-After'))
      assert.ok(retryAfter > 0 && retryAfter <= 60)
      assert.equal((await limitedLogin.json()).code, 'RATE_LIMITED')
      const capabilities = await (
        await app.request('/api/auth/capabilities')
      ).json()
      assert.equal(capabilities.developmentEmailPreview, false)
      const directDelivery = await post(
        '/api/auth/email-otp/send-verification-otp',
        { email, type: 'email-verification' },
        cookie,
      )
      assert.equal(directDelivery.status, 500)
      assert.equal((await directDelivery.json()).code, 'EMAIL_DELIVERY_FAILED')
      assert.equal(
        (await post('/api/security/step-up/email-code', {})).status,
        401,
      )

      // 生产必须使用 SMTP；传输不可用时不能报告投递成功。
      for (let attempt = 0; attempt < 3; attempt++) {
        const failed = await post(
          '/api/security/step-up/email-code',
          {},
          cookie,
        )
        assert.equal(failed.status, 400)
        const body = await failed.json()
        assert.equal(body.code, 'EMAIL_DELIVERY_FAILED')
        assert.equal(body.devOtp, undefined)
        assert.equal(body.sent, undefined)
      }
      const limitedSend = await post(
        '/api/security/step-up/email-code',
        {},
        cookie,
      )
      assert.equal(limitedSend.status, 429)
      assert.ok(Number(limitedSend.headers.get('Retry-After')) > 0)

      const intent = {
        operation: 'changeEmail',
        target: '',
        method: 'emailOtp',
        code: '999999',
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        assert.equal(
          (await post('/api/security/step-up', intent, cookie)).status,
          401,
        )
      }
      const limitedVerify = await post('/api/security/step-up', intent, cookie)
      assert.equal(limitedVerify.status, 429)
      assert.equal((await limitedVerify.json()).code, 'RATE_LIMITED')
      assert.ok(Number(limitedVerify.headers.get('Retry-After')) > 0)
      assert.equal(
        (
          await db.query(
            'select id from security_operation_grant where user_id = $1',
            [user.id],
          )
        ).rowCount,
        0,
      )
    } finally {
      await db.query('delete from "user" where id = $1', [user.id])
      await db.query('delete from "rateLimit" where key like $1', [
        `velin:security:%:${user.id}`,
      ])
      await db.query('delete from "rateLimit" where key like $1', [
        '203.0.113.77|%',
      ])
      await db.query('delete from "rateLimit" where key like $1', [
        '203.0.113.78|%',
      ])
      await db.end()
    }
  },
)
