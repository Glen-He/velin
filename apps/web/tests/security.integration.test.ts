import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { hashPassword } from 'better-auth/crypto'
import { readFile } from 'node:fs/promises'
import { operationGrantHeader } from '@velin/contracts/security'
import type { VerificationIntent } from '@velin/contracts/security'

// 仅显式启用一次性测试数据库，不能把测试数据写入用户数据库。
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
  process.env.APP_URL = 'http://localhost:3000'
  process.env.NODE_ENV = 'test'
  process.env.EMAIL_TRANSPORT = 'console'
}

test(
  'security HTTP boundaries and atomic operation grants',
  { skip: !enabled },
  async (suite) => {
    const { createApiFixture } = await import('./request-api')
    const { auth } = await import('../src/lib/auth/server')
    const { databasePool: db } = await import('../src/lib/database/connection')
    const { operationGrants } = await import('../src/lib/security/grants')
    const { readDevCode } = await import('../src/lib/email')
    const app = await createApiFixture()
    const password = 'Velin-testing-94728!'
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
          origin: 'http://localhost:3000',
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
      'registration accepts 8 characters and rejects lengths outside 8–32',
      async () => {
        const email = `password-range-${crypto.randomUUID()}@example.test`
        for (const password of [
          'x'.repeat(7),
          'x'.repeat(33),
          'password中文',
          'test pass',
          'test\tpass',
        ]) {
          const response = await request('/api/auth/sign-up/email', {
            email,
            password,
          })
          assert.equal(response.status, 400)
          assert.equal(
            (await response.json()).code,
            'PASSWORD_POLICY_VIOLATION',
          )
        }
        const response = await request('/api/auth/sign-up/email', {
          email,
          password: 'V7@u9pQ!',
        })
        assert.equal(response.status, 200)
        const body = await response.json()
        assert.equal(body.user.email, email)
        ids.push(body.user.id)
      },
    )
    await suite.test(
      'profile writes apply the same Unicode name policy at the HTTP boundary',
      async () => {
        const name = '🪐'.repeat(32)
        assert.equal(
          (await request('/api/auth/update-user', { name }, first.cookie))
            .status,
          200,
        )
        const row = await db.query('select name from "user" where id = $1', [
          first.userId,
        ])
        assert.equal(row.rows[0].name, name)
        for (const invalid of ['a'.repeat(33), 'name\nnext', '  ']) {
          assert.equal(
            (
              await request(
                '/api/auth/update-user',
                { name: invalid },
                first.cookie,
              )
            ).status,
            400,
          )
        }
      },
    )
    await suite.test(
      'avatar migrations remove obsolete session fields and normalize existing image references',
      async () => {
        const bytes = Buffer.from([255, 216, 255, 224, 0, 0])
        await db.query(
          'insert into "user_avatar" ("userId", "contentType", "data") values ($1, $2, $3)',
          [first.userId, 'image/jpeg', bytes],
        )
        await db.query('update "user" set image = $2 where id = $1', [
          first.userId,
          `http://old-deployment.example/api/avatars/${first.userId}?v=1`,
        ])
        const migration = await readFile(
          new URL(
            '../migrations/006_relative_avatar_reference.up.sql',
            import.meta.url,
          ),
          'utf8',
        )
        await db.query(migration)
        const result = await db.query(
          'select image from "user" where id = $1',
          [first.userId],
        )
        assert.match(
          result.rows[0].image,
          new RegExp(`^/api/avatars/${first.userId}\\?v=\\d+$`),
        )
        const columns = await db.query(
          "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'session' and column_name in ('verifiedAt', 'stepUpLevel')",
        )
        assert.equal(columns.rowCount, 0)
      },
    )
    await suite.test(
      'avatar HTTP boundaries validate uploads and revalidate changed images',
      async () => {
        const bytes = new Uint8Array([255, 216, 255, 224, 0, 1])
        const upload = (
          cookie: string,
          origin: string,
          contentType = 'image/jpeg',
          body = bytes,
        ) =>
          app.request('/api/avatars', {
            method: 'POST',
            headers: {
              cookie,
              origin,
              'content-type': contentType,
              'content-length': String(body.byteLength),
            },
            body,
          })
        assert.equal((await upload('', 'http://localhost:3000')).status, 401)
        assert.equal(
          (await upload(first.cookie, 'https://attacker.example')).status,
          403,
        )
        assert.equal(
          (await upload(first.cookie, 'http://localhost:3000', 'image/png'))
            .status,
          400,
        )
        assert.equal(
          (
            await upload(
              first.cookie,
              'http://localhost:3000',
              'image/jpeg',
              new Uint8Array([1, 2, 3, 4]),
            )
          ).status,
          400,
        )
        const saved = await upload(first.cookie, 'http://localhost:3000')
        assert.equal(saved.status, 200)
        const { image } = await saved.json()
        assert.match(
          image,
          new RegExp(`^/api/avatars/${first.userId}\\?v=\\d+$`),
        )
        const avatar = await app.request(image)
        assert.equal(avatar.status, 200)
        assert.equal(avatar.headers.get('content-type'), 'image/jpeg')
        assert.deepEqual(new Uint8Array(await avatar.arrayBuffer()), bytes)
        const etag = avatar.headers.get('etag')!
        assert.ok(etag)
        assert.equal(
          (await app.request(image, { headers: { 'if-none-match': etag } }))
            .status,
          304,
        )
        const changed = new Uint8Array([255, 216, 255, 224, 0, 2])
        assert.equal(
          (
            await upload(
              first.cookie,
              'http://localhost:3000',
              'image/jpeg',
              changed,
            )
          ).status,
          200,
        )
        const refreshed = await app.request(image, {
          headers: { 'if-none-match': etag },
        })
        assert.equal(refreshed.status, 200)
        assert.notEqual(refreshed.headers.get('etag'), etag)
        assert.match(refreshed.headers.get('cache-control')!, /must-revalidate/)
        assert.deepEqual(new Uint8Array(await refreshed.arrayBuffer()), changed)
        const row = await db.query('select image from "user" where id = $1', [
          first.userId,
        ])
        assert.ok(
          row.rows[0].image.startsWith(`/api/avatars/${first.userId}?v=`),
        )
      },
    )
    await suite.test(
      'unverified direct credential write is blocked even for a strong login',
      async () => {
        await db.query('update "session" set amr = $2 where id = $1', [
          first.sessionId,
          'passkey',
        ])
        const response = await request(
          '/api/auth/password/set',
          { password: 'Velin-new-28394!' },
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
        // 用已完成配置的测试记录验证边界，不自行生成 TOTP。
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
          '../src/lib/security/verification-limiter'
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
            newPassword: 'Velin-updated-82737!',
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
              { password: 'short' },
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
        const newPassword = 'V7@u9pQ!'
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
