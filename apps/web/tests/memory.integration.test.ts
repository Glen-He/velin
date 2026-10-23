import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hashPassword } from 'better-auth/crypto'
const enabled = Boolean(process.env.VELIN_TEST_DATABASE_URL)
if (enabled) {
  const url = new URL(process.env.VELIN_TEST_DATABASE_URL!)
  assert.match(url.pathname, /^\/velin_.*test$/)
  Object.assign(process.env, {
    DATABASE_URL: url.href,
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'memory-fixture-secret-at-least-32-characters',
    APP_URL: 'http://localhost:3000',
    PASSKEY_RP_ID: 'localhost',
    EMAIL_TRANSPORT: 'console',
    DEEPSEEK_API_KEY: 'fixture',
  })
}
test(
  'memory, versions and long context preserve isolation and lifecycle',
  { skip: !enabled, timeout: 120000 },
  async (suite) => {
    const { auth } = await import('../src/lib/auth/server')
    const { databasePool: db } = await import('../src/lib/database/connection')
    const { beginChatTurn, finalizeAssistantMessage } = await import(
      '../src/lib/chat/turn'
    )
    const { prepareConversationContext, ensureSummary } = await import(
      '../src/lib/chat/context'
    )
    const { loadConversation } = await import('../src/lib/chat/history')
    const { listConversationVersions, restoreConversationVersion } =
      await import('../src/lib/chat/versions')
    const { readMemory, updateMemory } = await import('../src/lib/chat/memory')
    const { learnMemory } = await import('../src/lib/chat/memory-learning')
    const { retrieveDocumentContext } = await import(
      '../src/lib/chat/retrieval'
    )
    const { retrieveConversationHistory } = await import(
      '../src/lib/chat/recall'
    )
    const { stopOcrQueue } = await import('../src/lib/ocr/queue')
    const { deepseek } = await import('../src/lib/chat/model')
    const { createApiFixture } = await import('./request-api')
    const app = await createApiFixture()
    const adapter = (await auth.$context).internalAdapter
    const users: string[] = []
    const password = 'Memory-fixture-936428!'
    async function identity() {
      const email = `memory-${crypto.randomUUID()}@example.test`
      const user = await adapter.createUser(
        { name: 'Fixture', email, emailVerified: true },
        { method: 'email-password' },
      )
      users.push(user.id)
      await adapter.createAccount({
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password: await hashPassword(password),
      })
      const login = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      })
      assert.equal(login.status, 200)
      return {
        id: user.id,
        cookie: login.headers
          .getSetCookie()
          .map((value) => value.split(';', 1)[0])
          .join('; '),
      }
    }
    const owner = await identity()
    const other = await identity()
    const signal = new AbortController().signal
    const request = (path: string, body?: unknown, cookie = owner.cookie) =>
      app.request(path, {
        method: body ? 'POST' : 'GET',
        headers: {
          cookie,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    assert.ok(deepseek)
    const original = deepseek.responses.create
    type AuxiliaryInput = {
      instructions: string
      input: string
      store: boolean
      stream: boolean
    }
    let respond: (
      input: AuxiliaryInput,
    ) => unknown | Promise<unknown> = () => ({ entries: [] })
    Object.defineProperty(deepseek.responses, 'create', {
      configurable: true,
      value: async (input: AuxiliaryInput) => {
        assert.equal(input.store, false)
        assert.equal(input.stream, false)
        return {
          id: crypto.randomUUID(),
          status: 'completed',
          output_text: JSON.stringify(await respond(input)),
          output: [],
          usage: { input_tokens: 31, output_tokens: 17 },
        }
      },
    })
    async function turn(
      conversationId: string,
      content: string,
      userMessageId = crypto.randomUUID(),
    ) {
      const input = {
        userId: owner.id,
        conversationId,
        userMessageId,
        requestId: crypto.randomUUID(),
        content,
        model: 'deepseek-flash' as const,
      }
      const result = await beginChatTurn(input)
      await finalizeAssistantMessage({
        conversationId,
        messageId: result.assistantMessageId,
        content: `reply ${content}`,
        reasoning: '',
        status: 'completed',
      })
      return { ...input, ...result }
    }
    try {
      await suite.test(
        'actual HTTP memory routes reject unsigned, browser, foreign and stale writes',
        async () => {
          assert.equal((await app.request('/api/chat/memory')).status, 401)
          assert.equal(
            (
              await app.request('/api/chat/memory', {
                headers: {
                  cookie: owner.cookie,
                  origin: 'http://localhost:3000',
                },
              })
            ).status,
            403,
          )
          assert.equal(
            (
              await request('/api/chat/memory', {
                action: 'save',
                entry: { topic: '风格', content: '简洁中文' },
              })
            ).status,
            200,
          )
          const entry = (await readMemory(owner.id)).entries[0]
          assert.equal(
            (
              await request(
                '/api/chat/memory',
                { action: 'delete', id: entry.id, version: entry.version },
                other.cookie,
              )
            ).status,
            409,
          )
          assert.equal(
            (
              await request('/api/chat/memory', {
                action: 'save',
                entry: {
                  id: entry.id,
                  version: entry.version,
                  topic: '风格',
                  content: '详细中文',
                },
              })
            ).status,
            200,
          )
          assert.equal(
            (
              await request('/api/chat/memory', {
                action: 'delete',
                id: entry.id,
                version: entry.version,
              })
            ).status,
            409,
          )
          assert.equal((await readMemory(other.id)).entries.length, 0)
          await updateMemory(owner.id, { action: 'clear' })
        },
      )
      await suite.test(
        'immutable versions survive repeated edits, cross-anchor restores and failed replies',
        async () => {
          const id = crypto.randomUUID()
          const a = await turn(id, 'A1')
          const originalTime = (
            await db.query<{ updated_at: string }>(
              'select updated_at::text from chat_message where id=$1',
              [a.userMessageId],
            )
          ).rows[0].updated_at
          await turn(id, 'B1')
          await turn(id, 'A2', a.userMessageId)
          const b = await turn(id, 'B2')
          await turn(id, 'B3', b.userMessageId)
          const versions = await listConversationVersions(owner.id, id)
          const old = versions.find((v) => v.preview === 'A1')!
          assert.equal(old.messageCount, 4)
          assert.equal(
            (
              await request(
                `/api/chat/conversations/${id}/versions`,
                { versionId: old.id },
                other.cookie,
              )
            ).status,
            409,
          )
          await restoreConversationVersion(owner.id, id, old.id)
          assert.equal(
            (
              await db.query<{ updated_at: string }>(
                'select updated_at::text from chat_message where id=$1',
                [a.userMessageId],
              )
            ).rows[0].updated_at,
            originalTime,
          )
          assert.deepEqual(
            (await loadConversation(owner.id, id))?.messages.map(
              (m) => m.content,
            ),
            ['A1', 'reply A1', 'B1', 'reply B1'],
          )
          await restoreConversationVersion(
            owner.id,
            id,
            versions.find((v) => v.preview === 'B2')!.id,
          )
          assert.deepEqual(
            (await loadConversation(owner.id, id))?.messages.map(
              (m) => m.content,
            ),
            ['A2', 'reply A2', 'B2', 'reply B2'],
          )
          await restoreConversationVersion(owner.id, id, old.id)
          const failed = await beginChatTurn({
            ...a,
            requestId: crypto.randomUUID(),
            content: 'new but failed',
          })
          await finalizeAssistantMessage({
            conversationId: id,
            messageId: failed.assistantMessageId,
            content: '',
            reasoning: '',
            status: 'failed',
          })
          assert.ok(
            (await listConversationVersions(owner.id, id)).some(
              (v) => v.preview === 'A1',
            ),
          )
          assert.ok(
            (
              await db.query('select 1 from chat_message where id=$1', [
                a.assistantMessageId,
              ])
            ).rowCount,
          )
        },
      )
      await suite.test(
        'long replies retain constraints through summary, raw recall and invalidation',
        async () => {
          const id = crypto.randomUUID()
          const first = await turn(id, '始终使用中文，代号 BLUELOTUS')
          await db.query('update chat_message set content=$2 where id=$1', [
            first.assistantMessageId,
            '长'.repeat(36000) + ' BLUELOTUS 尾部证据',
          ])
          const input = {
            userId: owner.id,
            conversationId: id,
            userMessageId: crypto.randomUUID(),
            requestId: crypto.randomUUID(),
            content: '继续 BLUELOTUS',
            model: 'deepseek-flash' as const,
          }
          const next = await beginChatTurn(input)
          let calls = 0
          respond = (input) => {
            if (input.instructions.includes('改写历史'))
              return {
                queries: ['BLUELOTUS'],
                after: null,
                before: null,
              }
            if (input.instructions.includes('选择对当前问题')) {
              const parsed = JSON.parse(input.input) as {
                candidates: Array<{ id: string; content: string }>
              }
              return {
                evidence: parsed.candidates
                  .filter((candidate) => candidate.content.includes('尾部证据'))
                  .map((candidate) => ({
                    id: candidate.id,
                    quote: '尾部证据',
                  })),
              }
            }
            calls++
            assert.match(input.input, /BLUELOTUS/)
            return { summary: '用户要求始终使用中文，代号 BLUELOTUS。' }
          }
          const prepare = () =>
            prepareConversationContext({
              ...input,
              assistantMessageId: next.assistantMessageId,
              signal,
            })
          const prepared = await prepare()
          assert.equal(prepared.metadata.summaryUsed, true)
          assert.ok(
            prepared.messages.some(
              (m) => m.role === 'system' && m.content.includes('始终使用中文'),
            ),
          )
          assert.equal(
            prepared.messages.filter((m) => m.role !== 'system')[0].role,
            'user',
          )
          assert.match(
            (
              await retrieveConversationHistory({
                userId: owner.id,
                conversationId: id,
                question: 'BLUELOTUS',
                before: String(2 ** 31),
                recentMessages: [],
                referenceHistory: false,
                signal,
              })
            ).referenceText,
            /尾部证据/,
          )
          const previous = calls
          await prepare()
          assert.equal(calls, previous)
          await beginChatTurn({
            ...first,
            requestId: crypto.randomUUID(),
            content: '改用英文',
          })
          assert.equal(
            (
              await db.query(
                'select 1 from chat_context_summary where conversation_id=$1',
                [id],
              )
            ).rowCount,
            0,
          )
          await assert.rejects(
            ensureSummary({
              conversationId: id,
              userId: owner.id,
              revision: '1',
              before: String(2 ** 31),
              signal,
            }),
            /对话已变化/,
          )
        },
      )
      await suite.test(
        'tail file evidence survives follow-up and is owner scoped',
        async () => {
          const id = crypto.randomUUID()
          const first = await turn(id, '读取文件')
          const attachmentId = crypto.randomUUID()
          await db.query(
            `insert into chat_attachment(id,user_id,message_id,name,mime_type,size_bytes,text_content) values($1,$2,$3,'report.txt','text/plain',100,$4)`,
            [
              attachmentId,
              owner.id,
              first.userMessageId,
              '普通背景。'.repeat(18000) +
                '\n最后一段 合同终止补偿为 998877 元。',
            ],
          )
          const context = await retrieveDocumentContext(
            owner.id,
            id,
            '最后合同终止补偿是多少',
            signal,
          )
          assert.match(context.referenceText, /998877/)
          assert.equal(context.partial, true)
          assert.ok(context.sources.some((s) => s.excerpt.includes('998877')))
          const paraphrased = await retrieveDocumentContext(
            owner.id,
            id,
            '解约后能拿到多少钱',
            signal,
            undefined,
            ['合同终止补偿'],
          )
          assert.match(paraphrased.referenceText, /998877/)
          assert.equal(
            (await retrieveDocumentContext(other.id, id, '合同终止', signal))
              .sources.length,
            0,
          )
          await turn(id, '继续追问合同终止补偿')
          assert.match(
            (
              await retrieveDocumentContext(
                owner.id,
                id,
                '合同终止补偿',
                signal,
              )
            ).referenceText,
            /998877/,
          )
          await db.query('delete from chat_conversation where id=$1', [id])
          assert.equal(
            (
              await db.query(
                'select 1 from chat_document_chunk where attachment_id=$1',
                [attachmentId],
              )
            ).rowCount,
            0,
          )
        },
      )
      await suite.test(
        'exact user evidence honors forgetting, disable, idempotency and late-response fencing',
        async () => {
          const id = crypto.randomUUID()
          const source = await turn(id, '以后请始终用中文回答我。')
          const job = {
            ...source,
            sourceMessageId: source.userMessageId,
            revision: '1',
            signal,
          }
          respond = () => ({
            entries: [
              { topic: '语言', quote: source.content, action: 'remember' },
              { topic: '捏造', quote: '我住在月球', action: 'remember' },
            ],
          })
          await learnMemory(job)
          let state = await readMemory(owner.id)
          assert.equal(state.entries.length, 1)
          assert.equal(state.entries[0].sourceQuote, source.content)
          await learnMemory(job)
          assert.equal(
            (await readMemory(owner.id)).entries[0].version,
            state.entries[0].version,
          )
          await updateMemory(owner.id, {
            action: 'delete',
            id: state.entries[0].id,
            version: state.entries[0].version,
          })
          await learnMemory(job)
          assert.equal((await readMemory(owner.id)).entries.length, 0)
          const fresh = await turn(id, '以后请始终用英文回答我。')
          const freshJob = {
            ...fresh,
            sourceMessageId: fresh.userMessageId,
            revision: '1',
            signal,
          }
          respond = () => ({
            entries: [
              { topic: '语言', quote: fresh.content, action: 'remember' },
            ],
          })
          await learnMemory(freshJob)
          state = await readMemory(owner.id)
          assert.equal(state.entries[0].content, fresh.content)
          let release!: () => void
          let started!: () => void
          const gate = new Promise<void>((r) => {
            release = r
          })
          const ready = new Promise<void>((r) => {
            started = r
          })
          respond = async () => {
            started()
            await gate
            return {
              entries: [
                { topic: '语言', quote: fresh.content, action: 'remember' },
              ],
            }
          }
          const pending = learnMemory(freshJob)
          await ready
          await updateMemory(owner.id, { action: 'clear' })
          release()
          await pending
          assert.equal((await readMemory(owner.id)).entries.length, 0)
          await learnMemory(freshJob)
          assert.equal((await readMemory(owner.id)).entries.length, 0)
          await updateMemory(owner.id, { action: 'settings', enabled: false })
          respond = () => {
            throw new Error('Disabled memory must not call the provider.')
          }
          await learnMemory(freshJob)
          assert.equal((await readMemory(owner.id)).enabled, false)
        },
      )
      await suite.test(
        'a saved memory remains visible as partial success when reply generation subsequently fails',
        async () => {
          const { streamChat } = await import('../src/lib/chat/stream')
          await updateMemory(owner.id, {
            action: 'settings',
            enabled: true,
            referenceHistory: false,
          })
          const content = '请记住，以后回答先给结论。'
          Object.defineProperty(deepseek.responses, 'create', {
            configurable: true,
            value: async (input: {
              stream?: boolean
              instructions?: string
            }) => {
              if (input.stream)
                throw new Error('Synthetic reply failure after memory commit')
              return {
                id: crypto.randomUUID(),
                status: 'completed',
                output: [],
                output_text: input.instructions?.includes('提取用户')
                  ? JSON.stringify({
                      entries: [
                        {
                          topic: '部分成功测试',
                          quote: content,
                          action: 'remember',
                        },
                      ],
                    })
                  : '测试标题',
              }
            },
          })
          const response = await streamChat(
            new Request('http://localhost:3000/api/chat/stream', {
              method: 'POST',
              headers: {
                cookie: owner.cookie,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                requestId: crypto.randomUUID(),
                conversationId: crypto.randomUUID(),
                userMessageId: crypto.randomUUID(),
                content,
                model: 'deepseek-flash',
                reasoningEffort: 'none',
              }),
            }),
          )
          assert.equal(response.status, 200)
          assert.match(await response.text(), /记忆已更新，但本轮回复未完成/)
          assert.equal(
            (await readMemory(owner.id)).entries.find(
              (entry) => entry.topic === '部分成功测试',
            )?.content,
            content,
          )
        },
      )
      await suite.test(
        'Responses disconnects fail closed, retries deduplicate and cancellation retains partial output',
        async () => {
          const { streamChat } = await import('../src/lib/chat/stream')
          const { setTimeout: delay } = await import('node:timers/promises')
          let mode: 'broken' | 'cancelled' = 'broken'
          Object.defineProperty(deepseek.responses, 'create', {
            configurable: true,
            value: async (
              input: { stream?: boolean },
              options: { signal: AbortSignal },
            ) => {
              if (!input.stream)
                return {
                  id: 'auxiliary',
                  status: 'completed',
                  output_text: '测试标题',
                  output: [],
                }
              return (async function* () {
                yield {
                  type: 'response.created',
                  sequence_number: 0,
                  response: { id: 'fixture-stream' },
                }
                yield {
                  type: 'response.output_text.delta',
                  sequence_number: 1,
                  delta: 'partial fixture output',
                }
                if (mode === 'cancelled') {
                  if (!options.signal.aborted)
                    await new Promise<void>((resolve) =>
                      options.signal.addEventListener(
                        'abort',
                        () => resolve(),
                        { once: true },
                      ),
                    )
                  options.signal.throwIfAborted()
                }
              })()
            },
          })
          const payload = {
            requestId: crypto.randomUUID(),
            conversationId: crypto.randomUUID(),
            userMessageId: crypto.randomUUID(),
            content: 'Synthetic stream fixture',
            model: 'deepseek-flash',
            reasoningEffort: 'high',
          }
          const start = (body: typeof payload, signal?: AbortSignal) =>
            streamChat(
              new Request('http://localhost:3000/api/chat/stream', {
                method: 'POST',
                headers: {
                  cookie: owner.cookie,
                  'content-type': 'application/json',
                },
                body: JSON.stringify(body),
                signal,
              }),
            )
          const broken = await start(payload)
          const events = await broken.text()
          assert.match(events, /partial fixture output/)
          assert.match(events, /"type":"error"/)
          assert.doesNotMatch(events, /message-complete/)
          assert.equal((await start(payload)).status, 409)
          const stored = await loadConversation(
            owner.id,
            payload.conversationId,
          )
          assert.equal(stored?.messages.at(-1)?.status, 'failed')
          assert.equal(stored?.messages.at(-1)?.reasoningEffort, 'high')
          mode = 'cancelled'
          const controller = new AbortController()
          const cancelledPayload = {
            ...payload,
            requestId: crypto.randomUUID(),
            conversationId: crypto.randomUUID(),
            userMessageId: crypto.randomUUID(),
          }
          const cancelled = await start(cancelledPayload, controller.signal)
          const reader = cancelled.body!.getReader()
          let output = ''
          while (!output.includes('partial fixture output'))
            output += new TextDecoder().decode((await reader.read()).value)
          controller.abort()
          await reader.cancel()
          let status: string | undefined
          for (let attempt = 0; attempt < 30; attempt++) {
            status = (
              await db.query<{ status: string }>(
                'select status from chat_request_usage where request_id=$1',
                [cancelledPayload.requestId],
              )
            ).rows[0]?.status
            if (status === 'cancelled') break
            await delay(20)
          }
          assert.equal(status, 'cancelled')
          const cancelledHistory = await loadConversation(
            owner.id,
            cancelledPayload.conversationId,
          )
          assert.equal(
            cancelledHistory?.messages.at(-1)?.content,
            'partial fixture output',
          )
          assert.equal(cancelledHistory?.messages.at(-1)?.status, 'cancelled')
        },
      )
    } finally {
      Object.defineProperty(deepseek.responses, 'create', {
        configurable: true,
        value: original,
      })
      await stopOcrQueue()
      await db.query('delete from "user" where id=any($1::text[])', [users])
      await db.end()
    }
  },
)
