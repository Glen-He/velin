import assert from 'node:assert/strict'
import { test } from 'node:test'

const enabled = Boolean(process.env.VELIN_TEST_DATABASE_URL)
if (enabled) {
  const url = new URL(process.env.VELIN_TEST_DATABASE_URL!)
  assert.match(url.pathname, /^\/velin_.*test$/)
  Object.assign(process.env, {
    DATABASE_URL: url.href,
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'context-fixture-secret-at-least-32-characters',
    APP_URL: 'http://localhost:3000',
    PASSKEY_RP_ID: 'localhost',
    EMAIL_TRANSPORT: 'console',
    DEEPSEEK_API_KEY: 'fixture',
  })
}

test(
  'independent context preparation overlaps and failed preparation cancels its sibling',
  {
    skip: !enabled,
    timeout: 10_000,
  },
  async (suite) => {
    const { databasePool: db } = await import('../src/lib/database/connection')
    const { deepseek } = await import('../src/lib/chat/model')
    const { prepareConversationContext, ensureSummary } = await import(
      '../src/lib/chat/context'
    )
    assert.ok(deepseek)
    const original = deepseek.responses.create
    const userId = crypto.randomUUID(),
      conversationId = crypto.randomUUID(),
      userMessageId = crypto.randomUUID(),
      assistantMessageId = crypto.randomUUID()
    await db.query(
      'insert into "user"(id,name,email,"emailVerified") values($1,\'Context fixture\',$2,true)',
      [userId, `${userId}@example.test`],
    )
    await db.query(
      "insert into chat_conversation(id,user_id,title,model) values($1,$2,'Fixture','deepseek-flash')",
      [conversationId, userId],
    )
    await db.query(
      "insert into chat_message(sequence,id,conversation_id,role,content,status) overriding system value select 999999999999960::bigint+n,gen_random_uuid(),$1,'user','Historical preference ' || n,'completed' from generate_series(1,67) n",
      [conversationId],
    )
    await db.query(
      "insert into chat_message(sequence,id,conversation_id,role,content,status) overriding system value values(1000000000000028,$1,$2,'user','Continue previous preferences','completed'),(1000000000000029,$3,$2,'assistant','','streaming')",
      [userMessageId, conversationId, assistantMessageId],
    )
    try {
      for (const failSummary of [false, true]) {
        await suite.test(
          failSummary
            ? 'a failed summary aborts and joins the pending retrieval'
            : 'summary and retrieval can both start before either finishes',
          async () => {
            await db.query(
              'delete from chat_context_summary where conversation_id=$1',
              [conversationId],
            )
            const entered = new Set<string>()
            let release!: () => void
            const gate = new Promise<void>((resolve) => {
              release = resolve
            })
            let retrievalSignal: AbortSignal | undefined
            Object.defineProperty(deepseek.responses, 'create', {
              configurable: true,
              value: async (
                input: { instructions: string },
                options: { signal: AbortSignal },
              ) => {
                const summary = input.instructions.includes('压缩对话历史')
                const query = input.instructions.includes('改写历史聊天检索')
                if (summary || query) {
                  entered.add(summary ? 'summary' : 'history')
                  if (query) retrievalSignal = options.signal
                  if (entered.size === 2) release()
                  let abort!: () => void
                  const aborted = new Promise<never>((_, reject) => {
                    abort = () => reject(options.signal.reason)
                    options.signal.addEventListener('abort', abort, {
                      once: true,
                    })
                    if (options.signal.aborted) abort()
                  })
                  try {
                    await Promise.race([gate, aborted])
                    if (failSummary && summary)
                      throw new Error('Summary fixture unavailable.')
                    if (failSummary && query) await aborted
                  } finally {
                    options.signal.removeEventListener('abort', abort)
                  }
                }
                const result = summary
                  ? { summary: 'Historical preferences retained.' }
                  : query
                    ? {
                        queries: ['historical preference'],
                        after: null,
                        before: null,
                      }
                    : { evidence: [] }
                return {
                  id: crypto.randomUUID(),
                  status: 'completed',
                  output: [],
                  output_text: JSON.stringify(result),
                }
              },
            })
            const controller = new AbortController()
            const timeout = setTimeout(
              () =>
                controller.abort(new Error('Context tasks did not overlap.')),
              1500,
            )
            try {
              const prepared = prepareConversationContext({
                userId,
                conversationId,
                userMessageId,
                assistantMessageId,
                requestId: crypto.randomUUID(),
                model: 'deepseek-flash',
                signal: controller.signal,
              })
              if (failSummary) {
                await assert.rejects(prepared, /Summary fixture unavailable/)
                assert.equal(retrievalSignal?.aborted, true)
              } else {
                assert.equal((await prepared).metadata.summaryUsed, true)
              }
              assert.deepEqual([...entered].sort(), ['history', 'summary'])
            } finally {
              clearTimeout(timeout)
              controller.abort()
              release()
            }
          },
        )
      }
      await suite.test(
        'summary batches retain numeric order when sequence digit lengths change',
        async () => {
          await db.query(
            'delete from chat_context_summary where conversation_id=$1',
            [conversationId],
          )
          const seen: number[] = []
          Object.defineProperty(deepseek.responses, 'create', {
            configurable: true,
            value: async (input: { input: string }) => {
              const history = (JSON.parse(input.input) as { history: string })
                .history
              seen.push(
                ...[...history.matchAll(/Historical preference (\d+)/g)].map(
                  (match) => Number(match[1]),
                ),
              )
              return {
                id: crypto.randomUUID(),
                status: 'completed',
                output_text: JSON.stringify({
                  summary: 'Historical preferences retained.',
                }),
              }
            },
          })
          await ensureSummary({
            conversationId,
            userId,
            revision: '1',
            before: '1000000000000028',
            signal: new AbortController().signal,
          })
          assert.deepEqual(
            seen,
            Array.from({ length: 67 }, (_, index) => index + 1),
          )
          assert.equal(
            (
              await db.query(
                'select through_sequence::text from chat_context_summary where conversation_id=$1',
                [conversationId],
              )
            ).rows[0].through_sequence,
            '1000000000000027',
          )
        },
      )
    } finally {
      Object.defineProperty(deepseek.responses, 'create', {
        configurable: true,
        value: original,
      })
      await db.query('delete from "user" where id=$1', [userId])
      await db.end()
    }
  },
)
