import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { hashPassword } from 'better-auth/crypto'
import { operationGrantHeader } from '@velin/contracts/security'
import type { VerificationIntent } from '@velin/contracts/security'

// Explicitly opt into a disposable database; never run fixtures on user data.
const enabled = Boolean(process.env.VELIN_TEST_DATABASE_URL)
if (enabled) {
  const url = new URL(process.env.VELIN_TEST_DATABASE_URL!)
  assert.match(
    url.pathname,
    /^\/velin_.*test$/,
    'Integration database name must be velin_*test',
  )
  process.env.DATABASE_URL = url.href
  process.env.BETTER_AUTH_SECRET =
    'velin-integration-secret-with-at-least-32-characters'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.AUTH_WEB_URL = 'http://localhost:5174'
  process.env.NODE_ENV = 'test'
  process.env.EMAIL_TRANSPORT = 'console'
}

test(
  'security HTTP boundaries and atomic operation grants',
  { skip: !enabled },
  async (suite) => {
    const { createApp } = await import('../src/app.js')
    const { auth } = await import('../src/auth.js')
    const { databasePool: db } = await import('../src/database.js')
    const { operationGrants } = await import('../src/security/grants.js')
    const { readDevCode } = await import('../src/email.js')
    const app = createApp()
    const password = 'Velin testing phrase 94728!'
    const ids: string[] = []
    type Identity = {
      userId: string
      sessionId: string
      cookie: string
      email: string
    }
    async function request(
      path: string,
      body: unknown,
      cookie = '',
      extra: Record<string, string> = {},
    ) {
      return app.request(path, {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5174',
          'content-type': 'application/json',
          cookie,
          ...extra,
        },
        body: JSON.stringify(body),
      })
    }
    async function fixture(email: string): Promise<Identity> {
      const ctx = await auth.$context
      const user = await ctx.internalAdapter.createUser(
        { name: email, email, emailVerified: true },
        { method: 'email-password' },
      )
      ids.push(user.id)
      await ctx.internalAdapter.createAccount({
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password: await hashPassword(password),
      })
      return login(user.id, email)
    }
    async function login(userId: string, email: string): Promise<Identity> {
      const response = await request('/api/auth/sign-in/email', {
        email,
        password,
      })
      assert.equal(response.status, 200)
      const cookie = response.headers
        .getSetCookie()
        .map((item) => item.split(';', 1)[0])
        .join('; ')
      const session = await auth.api.getSession({
        headers: new Headers({ cookie }),
      })
      assert.ok(session)
      return { userId, email, cookie, sessionId: session.session.id }
    }
    let first: Identity
    let second: Identity
    let otherUser: Identity
    before(async () => {
      first = await fixture(`refactor-${crypto.randomUUID()}@example.test`)
      second = await login(first.userId, first.email)
      otherUser = await fixture(`refactor-${crypto.randomUUID()}@example.test`)
    })
    after(async () => {
      await db.query('delete from "rateLimit" where key = ANY($1)', [
        ids.flatMap((id) =>
          ['send', 'verify', 'passkey-options'].map(
            (scope) => `velin:security:${scope}:${id}`,
          ),
        ),
      ])
      await db.query('delete from "user" where id = ANY($1)', [ids])
      await db.end()
    })
    const intent: VerificationIntent = {
      operation: 'removePasskey',
      target: 'fixture-key',
    }
    await suite.test(
      'unverified direct credential write is blocked even for a strong login',
      async () => {
        await db.query('update "session" set amr = $2 where id = $1', [
          first.sessionId,
          'passkey',
        ])
        const response = await request(
          '/api/auth/password/set',
          { password: 'New Velin test phrase 28394!' },
          first.cookie,
        )
        assert.equal(response.status, 401)
        assert.equal((await response.json()).code, 'STEP_UP_REQUIRED')
        assert.equal(
          (await request('/api/auth/password/set', { password }, '')).status,
          401,
        )
      },
    )
    await suite.test(
      'custom routes reject missing/foreign origin and non-JSON requests',
      async () => {
        for (const origin of ['', 'https://attacker.example']) {
          assert.equal(
            (
              await request(
                '/api/security/step-up/email-code',
                {},
                first.cookie,
                { origin },
              )
            ).status,
            403,
          )
        }
        assert.equal(
          (
            await request(
              '/api/security/step-up/email-code',
              {},
              first.cookie,
              { 'content-type': 'text/plain' },
            )
          ).status,
          403,
        )
      },
    )
    await suite.test(
      'grants bind account, session, operation and target',
      async () => {
        const grant = await operationGrants.issue(first, intent, 'emailOtp')
        const claim = { ...first, ...intent, id: grant.id }
        assert.equal(
          await operationGrants.consume({ ...claim, userId: otherUser.userId }),
          false,
        )
        assert.equal(
          await operationGrants.consume({
            ...claim,
            sessionId: second.sessionId,
          }),
          false,
        )
        assert.equal(
          await operationGrants.consume({ ...claim, operation: 'addPasskey' }),
          false,
        )
        assert.equal(
          await operationGrants.consume({ ...claim, target: 'different-key' }),
          false,
        )
        assert.equal(await operationGrants.consume(claim), true)
        assert.equal(await operationGrants.consume(claim), false)
      },
    )
    await suite.test(
      'only one concurrent consumer succeeds; expired grants fail',
      async () => {
        const grant = await operationGrants.issue(first, intent, 'emailOtp')
        const results = await Promise.all(
          Array.from({ length: 10 }, () =>
            operationGrants.consume({ ...first, ...intent, id: grant.id }),
          ),
        )
        assert.equal(results.filter(Boolean).length, 1)
        const expired = await operationGrants.issue(first, intent, 'emailOtp')
        await db.query(
          "update security_operation_grant set expires_at = now() - interval '1 second' where id = $1",
          [expired.id],
        )
        assert.equal(
          await operationGrants.consume({
            ...first,
            ...intent,
            id: expired.id,
          }),
          false,
        )
      },
    )
    await suite.test(
      'email verification consumes the code; reuse cannot issue another grant',
      async () => {
        assert.equal(
          (await request('/api/security/step-up/email-code', {}, first.cookie))
            .status,
          200,
        )
        const code = readDevCode(first.email)
        assert.ok(code)
        const body = {
          method: 'emailOtp',
          code,
          operation: 'addPasskey',
          target: '',
        }
        const response = await request(
          '/api/security/step-up',
          body,
          first.cookie,
        )
        assert.equal(response.status, 200)
        assert.ok((await response.json()).id)
        assert.equal(
          (await request('/api/security/step-up', body, first.cookie)).status,
          401,
        )
      },
    )
    await suite.test(
      'delete endpoint consumes a matching grant and rejects its replay',
      async () => {
        const keyId = 'fixture-key'
        await db.query(
          'insert into passkey (id,"publicKey","userId","credentialID",counter,"deviceType","backedUp") values ($1,$2,$3,$4,0,$5,false)',
          [keyId, 'unused', first.userId, 'unused-fixture', 'singleDevice'],
        )
        const grant = await operationGrants.issue(first, intent, 'emailOtp')
        const headers = { [operationGrantHeader]: grant.id }
        assert.equal(
          (
            await request(
              '/api/auth/passkey/delete-passkey',
              { id: keyId },
              first.cookie,
              headers,
            )
          ).status,
          200,
        )
        assert.equal(
          (
            await request(
              '/api/auth/passkey/delete-passkey',
              { id: keyId },
              first.cookie,
              headers,
            )
          ).status,
          401,
        )
      },
    )
    await suite.test(
      'backup recovery code is accepted once without trusting the device',
      async () => {
        const grant = await operationGrants.issue(
          first,
          { operation: 'enableTwoFactor', target: '' },
          'emailOtp',
        )
        const response = await request(
          '/api/auth/two-factor/enable',
          { password, issuer: 'Velin' },
          first.cookie,
          { [operationGrantHeader]: grant.id },
        )
        assert.equal(response.status, 200)
        const enrollment = await response.json()
        assert.ok(enrollment.backupCodes?.length)
        // Fixture represents a completed enrollment without generating TOTP ourselves.
        await db.query(
          'update "user" set "twoFactorEnabled" = true where id = $1',
          [first.userId],
        )
        await db.query(
          'update "twoFactor" set verified = true where "userId" = $1',
          [first.userId],
        )
        const body = {
          method: 'backupCode',
          code: enrollment.backupCodes[0],
          operation: 'disableTwoFactor',
          target: '',
        }
        const verified = await request(
          '/api/security/step-up',
          body,
          first.cookie,
        )
        assert.equal(verified.status, 200)
        assert.ok((await verified.json()).id)
        assert.ok(
          verified.headers
            .getSetCookie()
            .every((cookie) => !cookie.includes('trust_device')),
        )
        assert.equal(
          (await request('/api/security/step-up', body, first.cookie)).status,
          401,
        )
        await db.query(
          'update "user" set "twoFactorEnabled" = false where id = $1',
          [first.userId],
        )
        await db.query('delete from "twoFactor" where "userId" = $1', [
          first.userId,
        ])
      },
    )
    await suite.test(
      'account verification limits count concurrent attempts atomically',
      async () => {
        const { createVerificationLimiter } = await import(
          '../src/security/verification-limiter.js'
        )
        const limiter = createVerificationLimiter(db)
        const outcomes = await Promise.all(
          Array.from({ length: 10 }, () =>
            limiter.attempt(first.userId, 'verify'),
          ),
        )
        assert.equal(outcomes.filter((item) => item.allowed).length, 5)
        assert.ok(
          outcomes.every(
            (item) =>
              item.retryAfterSeconds >= 1 && item.retryAfterSeconds <= 60,
          ),
        )
        assert.equal(
          (await limiter.attempt(otherUser.userId, 'verify')).allowed,
          true,
        )
        await db.query(
          'update "rateLimit" set "lastRequest" = $2 where key = $1',
          [`velin:security:verify:${first.userId}`, Date.now() - 61000],
        )
        assert.equal(
          (await limiter.attempt(first.userId, 'verify')).allowed,
          true,
        )
      },
    )
    await suite.test(
      'revoke other sessions keeps current device and unrelated account',
      async () => {
        assert.equal(
          (await request('/api/auth/revoke-other-sessions', {}, first.cookie))
            .status,
          200,
        )
        assert.ok(
          await auth.api.getSession({
            headers: new Headers({ cookie: first.cookie }),
          }),
        )
        assert.equal(
          await auth.api.getSession({
            headers: new Headers({ cookie: second.cookie }),
          }),
          null,
        )
        assert.ok(
          await auth.api.getSession({
            headers: new Headers({ cookie: otherUser.cookie }),
          }),
        )
      },
    )
    await suite.test(
      'credential change invalidates all outstanding grants',
      async () => {
        const ctx = await auth.$context
        const remainingSession = await ctx.internalAdapter.createSession(
          first.userId,
        )
        const remainingIdentity = {
          userId: first.userId,
          sessionId: remainingSession.id,
        }
        const remainingGrant = await operationGrants.issue(
          remainingIdentity,
          intent,
          'emailOtp',
        )
        const grant = await operationGrants.issue(first, intent, 'emailOtp')
        const response = await request(
          '/api/auth/change-password',
          {
            currentPassword: password,
            newPassword: 'Velin updated testing phrase 82737!',
            revokeOtherSessions: false,
          },
          first.cookie,
        )
        assert.equal(response.status, 200)
        const cookies = new Map(
          first.cookie.split('; ').map((item) => {
            const split = item.indexOf('=')
            return [item.slice(0, split), item.slice(split + 1)]
          }),
        )
        for (const item of response.headers.getSetCookie()) {
          const value = item.split(';', 1)[0]
          const split = value.indexOf('=')
          cookies.set(value.slice(0, split), value.slice(split + 1))
        }
        first.cookie = [...cookies]
          .map(([key, value]) => `${key}=${value}`)
          .join('; ')
        const updated = await auth.api.getSession({
          headers: new Headers({ cookie: first.cookie }),
        })
        assert.ok(updated)
        first.sessionId = updated.session.id

        assert.equal(
          await operationGrants.consume({ ...first, ...intent, id: grant.id }),
          false,
        )
        assert.ok(
          (await ctx.internalAdapter.listSessions(first.userId)).some(
            (session) => session.id === remainingSession.id,
          ),
        )
        assert.equal(
          await operationGrants.consume({
            ...remainingIdentity,
            ...intent,
            id: remainingGrant.id,
          }),
          false,
        )
      },
    )
    await suite.test(
      'verified password route applies policy, revokes other devices, and rejects replay',
      async () => {
        const ctx = await auth.$context
        const extraSession = await ctx.internalAdapter.createSession(
          first.userId,
        )
        assert.ok(extraSession)
        const invalid = await operationGrants.issue(
          first,
          { operation: 'changePasswordVerified', target: '' },
          'emailOtp',
        )
        assert.equal(
          (
            await request(
              '/api/auth/password/set',
              { password: 'too short' },
              first.cookie,
              { [operationGrantHeader]: invalid.id },
            )
          ).status,
          400,
        )
        const grant = await operationGrants.issue(
          first,
          { operation: 'changePasswordVerified', target: '' },
          'emailOtp',
        )
        const headers = { [operationGrantHeader]: grant.id }
        const newPassword = 'Velin verified testing phrase 92783!'
        const response = await request(
          '/api/auth/password/set',
          { password: newPassword },
          first.cookie,
          headers,
        )
        assert.equal(response.status, 200)
        assert.equal((await response.json()).status, true)
        assert.ok(
          await auth.api.getSession({
            headers: new Headers({ cookie: first.cookie }),
          }),
        )
        const sessions = await ctx.internalAdapter.listSessions(first.userId)
        assert.deepEqual(
          sessions.map((item) => item.id),
          [first.sessionId],
        )
        assert.ok(
          await auth.api.getSession({
            headers: new Headers({ cookie: otherUser.cookie }),
          }),
        )
        assert.equal(
          (
            await request(
              '/api/auth/password/set',
              { password: newPassword },
              first.cookie,
              headers,
            )
          ).status,
          401,
        )
      },
    )
  },
)
