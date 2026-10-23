import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { hashPassword } from 'better-auth/crypto'

const enabled = Boolean(process.env.VELIN_TEST_DATABASE_URL)
if (enabled) {
  const url = new URL(process.env.VELIN_TEST_DATABASE_URL!)
  assert.match(url.pathname, /^\/velin_.*test$/)
  Object.assign(process.env, {
    DATABASE_URL: url.href,
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'reliability-fixture-secret-at-least-32-characters',
    APP_URL: 'http://localhost:3000',
    PASSKEY_RP_ID: 'localhost',
    EMAIL_TRANSPORT: 'console',
    DEEPSEEK_API_KEY: 'fixture',
    GOOGLE_CLIENT_ID: 'fixture',
    GOOGLE_CLIENT_SECRET: 'fixture',
  })
}

test(
  'security and chat reliability regressions cross real HTTP and persistence boundaries',
  { skip: !enabled, timeout: 120_000 },
  async (suite) => {
    const { auth } = await import('../src/lib/auth/server')
    const { databasePool: db } = await import('../src/lib/database/connection')
    const { createApiFixture } = await import('./request-api')
    const { readDevCode } = await import('../src/lib/email')
    const { operationGrants } = await import('../src/lib/security/grants')
    const { loadConversation, deleteConversation } = await import(
      '../src/lib/chat/history'
    )
    const { storeAttachment, deletePendingAttachment } = await import(
      '../src/lib/chat/attachments'
    )
    const { beginChatTurn: persistChatTurn, finalizeAssistantMessage } =
      await import('../src/lib/chat/turn')
    const { prepareConversationContext } = await import(
      '../src/lib/chat/context'
    )
    async function beginChatTurn(input: Parameters<typeof persistChatTurn>[0]) {
      const turn = await persistChatTurn(input)
      const prepared = await prepareConversationContext({
        ...input,
        assistantMessageId: turn.assistantMessageId,
        signal: new AbortController().signal,
      })
      return {
        ...turn,
        promptMessages: prepared.messages,
        context: prepared.metadata,
      }
    }
    const { streamChat } = await import('../src/lib/chat/stream')
    const { deepseek } = await import('../src/lib/chat/model')
    const { stopOcrQueue } = await import('../src/lib/ocr/queue')
    const { runMaintenance } = await import('../src/lib/maintenance')
    const originalNetworkFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.startsWith('https://api.pwnedpasswords.com/range/'))
        return new Response('00000000000000000000000000000000000:0', {
          headers: { 'content-type': 'text/plain' },
        })
      return originalNetworkFetch(input, init)
    }
    const app = await createApiFixture()
    const context = await auth.$context
    const password = 'Reliability-fixture-950384!'
    const user = await context.internalAdapter.createUser(
      {
        name: 'Fixture',
        email: `reliability-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      },
      { method: 'email-password' },
    )
    await context.internalAdapter.createAccount({
      userId: user.id,
      accountId: user.id,
      providerId: 'credential',
      password: await hashPassword(password),
    })
    const cookies = (response: Response) =>
      response.headers
        .getSetCookie()
        .map((value) => value.split(';', 1)[0])
        .join('; ')
    const post = (path: string, body: unknown, cookie = '') =>
      app.request(path, {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
          cookie,
        },
        body: JSON.stringify(body),
      })
    const login = await post('/api/auth/sign-in/email', {
      email: user.email,
      password,
    })
    assert.equal(login.status, 200)
    let cookie = cookies(login)
    const png = await readFile(
      new URL('./fixtures/sample.png', import.meta.url),
    )
    try {
      await suite.test(
        'invalid text is rejected at HTTP boundaries before quota reservation',
        async () => {
          const desktopPost = (path: string, body: unknown) =>
            app.request(path, {
              method: 'POST',
              headers: { cookie, 'content-type': 'application/json' },
              body: JSON.stringify(body),
            })
          for (const content of ['invalid\u0000', 'invalid\uD800']) {
            const requestId = crypto.randomUUID()
            const response = await desktopPost('/api/chat/stream', {
              requestId,
              conversationId: crypto.randomUUID(),
              userMessageId: crypto.randomUUID(),
              content,
            })
            assert.equal(response.status, 400)
            assert.equal(
              (
                await db.query(
                  'select 1 from chat_request_usage where request_id=$1',
                  [requestId],
                )
              ).rowCount,
              0,
            )
            const memory = await desktopPost('/api/chat/memory', {
              action: 'save',
              entry: { topic: '测试', content },
            })
            assert.equal(memory.status, 400)
          }
        },
      )
      await suite.test(
        'public password change cannot disable other-device revocation',
        async () => {
          for (const flag of [undefined, false]) {
            const other = await context.internalAdapter.createSession(user.id)
            const response = await post(
              '/api/auth/change-password',
              {
                currentPassword: password,
                newPassword: password,
                ...(flag === undefined ? {} : { revokeOtherSessions: flag }),
              },
              cookie,
            )
            assert.equal(response.status, 200)
            cookie = cookies(response)
            assert.equal(
              (
                await db.query('select id from "session" where id = $1', [
                  other.id,
                ])
              ).rowCount,
              0,
            )
            assert.ok(
              await auth.api.getSession({ headers: new Headers({ cookie }) }),
            )
          }
        },
      )

      await suite.test(
        'MFA covers email OTP and never issues a full session before verification',
        async () => {
          const session = await auth.api.getSession({
            headers: new Headers({ cookie }),
          })
          assert.ok(session)
          const grant = await operationGrants.issue(
            { userId: user.id, sessionId: session.session.id },
            { operation: 'enableTwoFactor', target: '' },
            'emailOtp',
          )
          const response = await app.request('/api/auth/two-factor/enable', {
            method: 'POST',
            headers: {
              origin: 'http://localhost:3000',
              'content-type': 'application/json',
              cookie,
              'x-velin-operation-grant': grant.id,
            },
            body: JSON.stringify({ password }),
          })
          assert.equal(response.status, 200)
          const enrollment = await response.json()
          // 固定测试夹具跳过扫码；实际凭据验证仍经认证库的公开 HTTP 端点。
          await db.query(
            'update "user" set "twoFactorEnabled" = true where id = $1',
            [user.id],
          )
          await db.query(
            'update "twoFactor" set verified = true where "userId" = $1',
            [user.id],
          )
          const passwordLogin = await post('/api/auth/sign-in/email', {
            email: user.email,
            password,
          })
          assert.equal((await passwordLogin.json()).twoFactorRedirect, true)
          assert.equal(
            await auth.api.getSession({
              headers: new Headers({ cookie: cookies(passwordLogin) }),
            }),
            null,
          )
          const sent = await post('/api/auth/email-otp/send-verification-otp', {
            email: user.email,
            type: 'sign-in',
          })
          assert.equal(sent.status, 200)
          const otp = readDevCode(user.email)
          assert.ok(otp)
          const otpLogin = await post('/api/auth/sign-in/email-otp', {
            email: user.email,
            otp,
          })
          assert.equal((await otpLogin.json()).twoFactorRedirect, true)
          assert.equal(
            await auth.api.getSession({
              headers: new Headers({ cookie: cookies(otpLogin) }),
            }),
            null,
          )
          const verified = await post(
            '/api/auth/two-factor/verify-backup-code',
            { code: enrollment.backupCodes[0], trustDevice: false },
            cookies(otpLogin),
          )
          assert.equal(verified.status, 200)
          assert.ok(
            await auth.api.getSession({
              headers: new Headers({ cookie: cookies(verified) }),
            }),
          )
          const repeated = await post(
            '/api/auth/two-factor/verify-backup-code',
            { code: enrollment.backupCodes[0], trustDevice: false },
            cookies(otpLogin),
          )
          assert.notEqual(repeated.status, 200)
          const replay = await post('/api/auth/sign-in/email-otp', {
            email: user.email,
            otp,
          })
          assert.notEqual(replay.status, 200)
          const originalFetch = globalThis.fetch
          try {
            globalThis.fetch = async (input, init) => {
              const url = input instanceof Request ? input.url : String(input)
              if (url === 'https://oauth2.googleapis.com/token') {
                const claims = {
                  sub: `fixture-${user.id}`,
                  email: user.email,
                  email_verified: true,
                  name: 'Fixture',
                  aud: 'fixture',
                  iss: 'https://accounts.google.com',
                  iat: Math.floor(Date.now() / 1000),
                  exp: Math.floor(Date.now() / 1000) + 3600,
                }
                const idToken = [
                  Buffer.from(JSON.stringify({ alg: 'RS256' })).toString(
                    'base64url',
                  ),
                  Buffer.from(JSON.stringify(claims)).toString('base64url'),
                  'fixture',
                ].join('.')
                return Response.json({
                  access_token: 'fixture',
                  token_type: 'Bearer',
                  expires_in: 3600,
                  id_token: idToken,
                })
              }
              return originalFetch(input, init)
            }
            const authorization = await post('/api/auth/sign-in/social', {
              provider: 'google',
              callbackURL: 'http://localhost:3000/sign-in?flow=manual-code',
            })
            assert.equal(authorization.status, 200)
            const location = new URL((await authorization.json()).url)
            const callback = await app.request(
              `/api/auth/callback/google?code=fixture&state=${encodeURIComponent(location.searchParams.get('state')!)}`,
              {
                headers: { cookie: cookies(authorization) },
                redirect: 'manual',
              },
            )
            assert.equal(callback.status, 302)
            const redirected = new URL(callback.headers.get('location')!)
            assert.equal(redirected.pathname, '/sign-in')
            assert.equal(redirected.searchParams.get('challenge'), 'two-factor')
            assert.equal(redirected.searchParams.get('flow'), 'manual-code')
            assert.equal(
              await auth.api.getSession({
                headers: new Headers({ cookie: cookies(callback) }),
              }),
              null,
            )
          } finally {
            globalThis.fetch = originalFetch
          }
        },
      )

      await suite.test(
        'history pagination stays numeric across digit boundaries',
        async () => {
          const id = crypto.randomUUID()
          await db.query(
            `insert into chat_conversation (id, user_id, title, model) values ($1, $2, 'fixture', 'deepseek-flash')`,
            [id, user.id],
          )
          await db.query(
            `insert into chat_message (id, sequence, conversation_id, role, content, status) overriding system value select gen_random_uuid(), n, $1, 'user', 'message ' || n, 'completed' from generate_series(999999999950::bigint, 1000000000069::bigint) n`,
            [id],
          )
          const first = await loadConversation(user.id, id)
          assert.ok(first?.nextBefore)
          const second = await loadConversation(user.id, id, first.nextBefore)
          assert.ok(second)
          const expected = await db.query<{ id: string }>(
            'select id from chat_message where conversation_id = $1 order by sequence desc limit 50',
            [id],
          )
          assert.deepEqual(
            first.messages.map((message) => message.id).reverse(),
            expected.rows.map((row) => row.id),
          )
          const firstIds = new Set(first.messages.map((message) => message.id))
          assert.equal(
            second.messages.some((message) => firstIds.has(message.id)),
            false,
          )
        },
      )

      await suite.test(
        'invalid image cannot bypass server decoding; history respects model capability',
        async () => {
          await assert.rejects(
            storeAttachment(user.id, {
              name: 'invalid.png',
              bytes: new Uint8Array([
                0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0,
              ]),
            }),
            /无法安全解析/,
          )
          const image = await storeAttachment(user.id, {
            name: 'valid.png',
            bytes: png,
          })
          assert.match(image.thumbnail ?? '', /^data:image\/jpeg;base64,/)
          const id = crypto.randomUUID()
          const turn = await beginChatTurn({
            userId: user.id,
            conversationId: id,
            userMessageId: crypto.randomUUID(),
            requestId: crypto.randomUUID(),
            content: 'describe',
            model: 'deepseek-flash',
            attachmentIds: [image.id],
          })
          await finalizeAssistantMessage({
            conversationId: id,
            messageId: turn.assistantMessageId,
            content: 'description',
            reasoning: '',
            status: 'completed',
          })
          await assert.rejects(
            beginChatTurn({
              userId: user.id,
              conversationId: id,
              userMessageId: crypto.randomUUID(),
              requestId: crypto.randomUUID(),
              content: 'continue',
              model: 'deepseek-v4-pro',
            }),
            /包含图片/,
          )
        },
      )

      await suite.test(
        'completion waits for atomic message and usage commit, preserving truncation',
        async () => {
          assert.ok(deepseek)
          let resume!: () => void
          const gate = new Promise<void>((resolve) => {
            resume = resolve
          })
          const original = deepseek.responses.create
          Object.defineProperty(deepseek.responses, 'create', {
            configurable: true,
            value: async (input: { stream?: boolean }) => {
              if (!input.stream)
                return {
                  id: 'title',
                  status: 'completed',
                  output_text: 'Fixture title',
                  output: [],
                }
              return (async function* () {
                await gate
                yield {
                  type: 'response.created',
                  sequence_number: 0,
                  response: { id: 'fixture' },
                }
                yield {
                  type: 'response.output_text.delta',
                  sequence_number: 1,
                  delta: 'partial answer',
                }
                yield {
                  type: 'response.incomplete',
                  sequence_number: 2,
                  response: {
                    id: 'fixture',
                    status: 'incomplete',
                    output: [],
                    usage: { input_tokens: 7, output_tokens: 8 },
                  },
                }
              })()
            },
          })
          const requestId = crypto.randomUUID()
          const conversationId = crypto.randomUUID()
          const locker = await db.connect()
          let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
          try {
            const response = await streamChat(
              new Request('http://localhost:3000/api/chat/stream', {
                method: 'POST',
                headers: { 'content-type': 'application/json', cookie },
                body: JSON.stringify({
                  requestId,
                  conversationId,
                  userMessageId: crypto.randomUUID(),
                  content: 'long reply',
                  model: 'deepseek-flash',
                  reasoningEffort: 'none',
                }),
              }),
            )
            assert.equal(response.status, 200)
            reader = response.body!.getReader()
            const start = new TextDecoder().decode((await reader.read()).value)
            const event = JSON.parse(start.split('data: ')[1])
            const contextFrame = new TextDecoder().decode(
              (await reader.read()).value,
            )
            assert.match(contextFrame, /context-ready/)
            await locker.query('begin')
            await locker.query(
              'select id from chat_message where id = $1 for update',
              [event.messageId],
            )
            let completed = false
            const allEvents = (async () => {
              let text = ''
              while (true) {
                const item = await reader!.read()
                if (item.done) break
                text += new TextDecoder().decode(item.value)
                if (text.includes('message-complete')) completed = true
              }
              return text
            })()
            resume()
            await delay(100)
            assert.equal(completed, false)
            assert.equal(
              (
                await db.query(
                  'select status from chat_request_usage where request_id = $1',
                  [requestId],
                )
              ).rows[0].status,
              'running',
            )
            await locker.query('rollback')
            const events = await allEvents
            assert.match(events, /"incomplete":true/)
            const stored = await db.query(
              `select m.status, u.status as usage_status, m.content from chat_message m join chat_request_usage u on m.request_id = u.request_id where m.id = $1`,
              [event.messageId],
            )
            assert.equal(stored.rows[0].status, 'incomplete')
            assert.equal(stored.rows[0].usage_status, 'incomplete')
            assert.equal(stored.rows[0].content, 'partial answer')
            const failedRequestId = crypto.randomUUID()
            const failedResponse = await streamChat(
              new Request('http://localhost:3000/api/chat/stream', {
                method: 'POST',
                headers: { 'content-type': 'application/json', cookie },
                body: JSON.stringify({
                  requestId: failedRequestId,
                  conversationId: crypto.randomUUID(),
                  userMessageId: crypto.randomUUID(),
                  content: 'save failure',
                  model: 'deepseek-flash',
                  reasoningEffort: 'none',
                }),
              }),
            )
            assert.equal(failedResponse.status, 200)
            const failedReader = failedResponse.body!.getReader()
            const failedStart = JSON.parse(
              new TextDecoder()
                .decode((await failedReader.read()).value)
                .split('data: ')[1],
            )
            await db.query('delete from chat_message where id = $1', [
              failedStart.messageId,
            ])
            let failedEvents = ''
            while (true) {
              const chunk = await failedReader.read()
              if (chunk.done) break
              failedEvents += new TextDecoder().decode(chunk.value)
            }
            assert.doesNotMatch(failedEvents, /message-complete/)
            assert.match(failedEvents, /回复保存失败/)
            assert.equal(
              (
                await db.query(
                  'select status from chat_request_usage where request_id = $1',
                  [failedRequestId],
                )
              ).rows[0].status,
              'failed',
            )
          } finally {
            resume()
            await locker.query('rollback')
            locker.release()
            await reader?.cancel()
            Object.defineProperty(deepseek.responses, 'create', {
              configurable: true,
              value: original,
            })
          }
        },
      )

      await suite.test(
        'late title jobs cannot overwrite an edited first turn and reasoning survives cancellation',
        async () => {
          const { saveGeneratedTitle } = await import('../src/lib/chat/title')
          const conversationId = crypto.randomUUID()
          const userMessageId = crypto.randomUUID()
          const oldRequestId = crypto.randomUUID()
          const first = await beginChatTurn({
            userId: user.id,
            conversationId,
            userMessageId,
            requestId: oldRequestId,
            content: 'original question',
            model: 'deepseek-flash',
          })
          await finalizeAssistantMessage({
            conversationId,
            messageId: first.assistantMessageId,
            content: '',
            reasoning: '尚未生成正文的分析',
            status: 'cancelled',
          })
          const recovered = await loadConversation(user.id, conversationId)
          assert.equal(
            recovered?.messages.at(-1)?.reasoning,
            '尚未生成正文的分析',
          )
          assert.equal(recovered?.messages.at(-1)?.status, 'cancelled')
          const nextRequestId = crypto.randomUUID()
          const edited = await beginChatTurn({
            userId: user.id,
            conversationId,
            userMessageId,
            requestId: nextRequestId,
            content: 'edited question',
            model: 'deepseek-flash',
          })
          assert.equal(
            await saveGeneratedTitle({
              userId: user.id,
              conversationId,
              requestId: oldRequestId,
              title: '过时标题',
            }),
            null,
          )
          assert.equal(
            await saveGeneratedTitle({
              userId: user.id,
              conversationId,
              requestId: nextRequestId,
              title: '新问题标题',
            }),
            '新问题标题',
          )
          await finalizeAssistantMessage({
            conversationId,
            messageId: edited.assistantMessageId,
            content: 'new answer',
            reasoning: '',
            status: 'completed',
          })
        },
      )

      await suite.test(
        'image selection is bounded before payload loading and same-message attachment retries are idempotent',
        async () => {
          const ids: string[] = []
          for (let index = 0; index < 6; index += 1)
            ids.push(
              (
                await storeAttachment(user.id, {
                  name: `image-${index}.png`,
                  bytes: png,
                })
              ).id,
            )
          const conversationId = crypto.randomUUID()
          const first = await beginChatTurn({
            userId: user.id,
            conversationId,
            userMessageId: crypto.randomUUID(),
            requestId: crypto.randomUUID(),
            content: 'first images',
            model: 'deepseek-flash',
            attachmentIds: ids.slice(0, 4),
          })
          await finalizeAssistantMessage({
            conversationId,
            messageId: first.assistantMessageId,
            content: 'first',
            reasoning: '',
            status: 'completed',
          })
          const userMessageId = crypto.randomUUID()
          const second = await beginChatTurn({
            userId: user.id,
            conversationId,
            userMessageId,
            requestId: crypto.randomUUID(),
            content: 'more images',
            model: 'deepseek-flash',
            attachmentIds: ids.slice(4),
          })
          assert.equal(
            second.promptMessages.reduce(
              (total, message) => total + (message.images?.length ?? 0),
              0,
            ),
            4,
          )
          assert.equal(second.context.imagesLimited, true)
          await finalizeAssistantMessage({
            conversationId,
            messageId: second.assistantMessageId,
            content: 'second',
            reasoning: '',
            status: 'completed',
          })
          const replay = await beginChatTurn({
            userId: user.id,
            conversationId,
            userMessageId,
            requestId: crypto.randomUUID(),
            content: 'edited images',
            model: 'deepseek-flash',
            attachmentIds: ids.slice(4),
          })
          await finalizeAssistantMessage({
            conversationId,
            messageId: replay.assistantMessageId,
            content: 'edited',
            reasoning: '',
            status: 'completed',
          })
          const history = await loadConversation(user.id, conversationId)
          assert.equal(history?.messages.at(-1)?.context?.imagesLimited, true)
          assert.equal(history?.messages.at(-2)?.attachments.length, 2)
        },
      )

      await suite.test(
        'compressed office input is rejected by decompression budget and releases its processing slot',
        async () => {
          const ExcelJS = (await import('exceljs')).default
          const workbook = new ExcelJS.Workbook()
          workbook.addWorksheet('fixture').getCell('A1').value = 'x'.repeat(
            17 * 1024 * 1024,
          )
          const bytes = Buffer.from(await workbook.xlsx.writeBuffer())
          assert.ok(bytes.byteLength < 100_000)
          await assert.rejects(
            storeAttachment(user.id, { name: 'expanded.xlsx', bytes }),
            /无法安全解析/,
          )
          assert.equal(
            (
              await db.query(
                'select 1 from document_processing_lease where user_id = $1',
                [user.id],
              )
            ).rowCount,
            0,
          )
        },
      )

      await suite.test(
        'removing the last attachment reference immediately erases derived OCR cache',
        async () => {
          const attachment = await storeAttachment(user.id, {
            name: 'pending.pdf',
            bytes: await readFile(
              new URL('./fixtures/sample.pdf', import.meta.url),
            ),
          })
          const source = await db.query(
            'select source_sha256 from chat_attachment where id = $1',
            [attachment.id],
          )
          const sha = source.rows[0].source_sha256
          await db.query(
            `insert into chat_pdf_page_cache (user_id, sha256, engine_version, page_number, source, text_content) values ($1, $2, 'fixture', 1, 'text', 'private fixture')`,
            [user.id, sha],
          )
          assert.equal(
            await deletePendingAttachment(user.id, attachment.id),
            true,
          )
          assert.equal(
            (
              await db.query(
                'select 1 from chat_pdf_page_cache where user_id = $1 and sha256 = $2',
                [user.id, sha],
              )
            ).rowCount,
            0,
          )
          const expired = await storeAttachment(user.id, {
            name: 'expired.txt',
            bytes: new TextEncoder().encode('expired draft'),
          })
          await db.query(
            `update chat_attachment set created_at = now() - interval '25 hours' where id = $1`,
            [expired.id],
          )
          await runMaintenance()
          assert.equal(
            (
              await db.query('select 1 from chat_attachment where id = $1', [
                expired.id,
              ])
            ).rowCount,
            0,
          )
          const conversations = await db.query<{ id: string }>(
            'select id from chat_conversation where user_id = $1',
            [user.id],
          )
          for (const item of conversations.rows)
            await deleteConversation(user.id, item.id)
        },
      )

      await suite.test(
        'conversation pagination, global title search and relative moves work beyond 5000 conversations',
        async () => {
          const prefix = `pagination-${crypto.randomUUID()}`
          await db.query(
            `insert into chat_conversation (id, user_id, title, model)
        select gen_random_uuid(), $1, $2 || n, 'deepseek-flash' from generate_series(1, 5101) n`,
            [user.id, prefix],
          )
          const ids: string[] = []
          let before: string | undefined
          do {
            const page = await (
              await import('../src/lib/chat/history')
            ).listConversations(user.id, {
              search: prefix,
              ...(before ? { before } : {}),
            })
            assert.ok(page.conversations.length <= 100)
            ids.push(...page.conversations.map((item) => item.id))
            before = page.nextCursor ?? undefined
          } while (before)
          assert.equal(ids.length, 5101)
          assert.equal(new Set(ids).size, ids.length)
          const move = await app.request('/api/chat/conversations/order', {
            method: 'PUT',
            headers: { cookie, 'content-type': 'application/json' },
            body: JSON.stringify({
              sourceId: ids.at(-1),
              targetId: ids[0],
              placement: 'before',
            }),
          })
          assert.equal(move.status, 204)
          const response = await app.request(
            `/api/chat/conversations?search=${encodeURIComponent(prefix)}`,
            { headers: { cookie } },
          )
          assert.equal(response.status, 200)
          const page = await response.json()
          assert.equal(page.conversations.length, 100)
          assert.equal(page.conversations[0].id, ids.at(-1))
          assert.ok(page.nextCursor)
          const match = await app.request(
            `/api/chat/conversations?search=${encodeURIComponent(prefix + '5101')}`,
            { headers: { cookie } },
          )
          assert.equal((await match.json()).conversations.length, 1)
          assert.equal(
            (
              await app.request('/api/chat/conversations?before=invalid', {
                headers: { cookie },
              })
            ).status,
            400,
          )
          await db.query(
            'delete from chat_conversation where user_id = $1 and position($2 in title) = 1',
            [user.id, prefix],
          )
        },
      )

      await suite.test(
        'quota reservations serialize competing requests and never double-charge a duplicate',
        async () => {
          const { reserveChatRequest, finishChatRequest } = await import(
            '../src/lib/chat/usage'
          )
          const requests = Array.from({ length: 8 }, () => crypto.randomUUID())
          const limits = await Promise.all(
            requests.map((id) =>
              reserveChatRequest(user.id, id, 'deepseek-flash'),
            ),
          )
          assert.equal(limits.filter((limit) => limit === null).length, 1)
          assert.ok(limits.every((limit) => limit === null || limit === 'busy'))
          const accepted = requests[limits.indexOf(null)]
          await finishChatRequest(accepted, 'completed', {
            inputTokens: 1,
            outputTokens: 2,
          })
          const before = await db.query(
            "select requests from chat_quota_day where subject = $1 and day = (now() at time zone 'UTC')::date",
            [user.id],
          )
          assert.equal(
            await reserveChatRequest(user.id, accepted, 'deepseek-flash'),
            'duplicate',
          )
          const after = await db.query(
            "select requests from chat_quota_day where subject = $1 and day = (now() at time zone 'UTC')::date",
            [user.id],
          )
          assert.equal(after.rows[0].requests, before.rows[0].requests)
        },
      )

      await suite.test(
        'suspension revokes every device and blocks both HTTP login and late session creation',
        async () => {
          const { setAccountEnabled } = await import(
            '../src/lib/auth/account-access'
          )
          await context.internalAdapter.createSession(user.id)
          await setAccountEnabled(user.id, false)
          assert.equal(
            (
              await db.query('select 1 from "session" where "userId" = $1', [
                user.id,
              ])
            ).rowCount,
            0,
          )
          assert.equal(
            await auth.api.getSession({ headers: new Headers({ cookie }) }),
            null,
          )
          assert.equal(
            (
              await post('/api/auth/sign-in/email', {
                email: user.email,
                password,
              })
            ).status,
            403,
          )
          await assert.rejects(context.internalAdapter.createSession(user.id))
          await setAccountEnabled(user.id, true)
          assert.ok(await context.internalAdapter.createSession(user.id))
        },
      )
    } finally {
      globalThis.fetch = originalNetworkFetch
      await stopOcrQueue()
      await db.query('delete from "user" where id = $1', [user.id])
      await db.end()
    }
  },
)
