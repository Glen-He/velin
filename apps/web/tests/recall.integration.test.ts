import assert from 'node:assert/strict'
import { test } from 'node:test'

const enabled = Boolean(process.env.VELIN_TEST_DATABASE_URL)
if (enabled) {
  const url = new URL(process.env.VELIN_TEST_DATABASE_URL!)
  assert.match(url.pathname, /^\/velin_.*test$/)
  Object.assign(process.env, {
    DATABASE_URL: url.href,
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'recall-fixture-secret-at-least-32-characters',
    APP_URL: 'http://localhost:3000',
    PASSKEY_RP_ID: 'localhost',
    EMAIL_TRANSPORT: 'console',
    DEEPSEEK_API_KEY: 'fixture',
  })
}
test(
  'conversation recall retains evidence and enforces privacy throughout its lifecycle',
  { skip: !enabled, timeout: 120000 },
  async (suite) => {
    const { databasePool: db } = await import('../src/lib/database/connection')
    const { deepseek } = await import('../src/lib/chat/model')
    const {
      retrieveConversationHistory,
      validateRecallEvidence,
      searchRecallCandidates,
    } = await import('../src/lib/chat/recall')
    const { prepareConversationContext } = await import(
      '../src/lib/chat/context'
    )
    const { updateMemory, readMemory } = await import('../src/lib/chat/memory')
    const { learnMemory } = await import('../src/lib/chat/memory-learning')
    const userId = crypto.randomUUID(),
      otherId = crypto.randomUUID()
    for (const id of [userId, otherId])
      await db.query(
        'insert into "user"(id,name,email,"emailVerified") values($1,\'Recall fixture\',$2,true)',
        [id, `${id}@example.test`],
      )
    type AuxiliaryInput = {
      instructions: string
      input: string
      stream: boolean
    }
    type Candidate = { id: string; role: string; content: string }
    let terms = ['上线 发布 日期 里程碑']
    let select: (candidates: Candidate[]) => Candidate[] = (candidates) =>
      candidates.filter((candidate) => candidate.role === 'user').slice(0, 5)
    let respond:
      | ((input: AuxiliaryInput) => unknown | Promise<unknown>)
      | null = null
    let providerCalls = 0
    const captured: Candidate[][] = []
    Object.defineProperty(deepseek!.responses, 'create', {
      configurable: true,
      value: async (input: AuxiliaryInput) => {
        providerCalls++
        let value: unknown
        if (respond) value = await respond(input)
        else if (input.instructions.includes('改写历史'))
          value = { queries: terms, after: null, before: null }
        else if (input.instructions.includes('选择对当前问题')) {
          const candidates = (
            JSON.parse(input.input) as { candidates: Candidate[] }
          ).candidates
          captured.push(candidates)
          value = {
            evidence: select(candidates).map((candidate) => ({
              id: candidate.id,
              quote: candidate.content.slice(0, 100),
            })),
          }
        } else if (input.instructions.includes('压缩对话'))
          value = { summary: '保留历史约束。' }
        else value = { entries: [] }
        return {
          id: crypto.randomUUID(),
          status: 'completed',
          output: [],
          output_text: JSON.stringify(value),
          usage: { input_tokens: 12, output_tokens: 8 },
        }
      },
    })
    async function conversation(owner = userId) {
      const id = crypto.randomUUID()
      await db.query(
        "insert into chat_conversation(id,user_id,title,model) values($1,$2,'Recall fixture','deepseek-flash')",
        [id, owner],
      )
      return id
    }
    async function message(
      conversationId: string,
      content: string,
      role = 'user',
      status = 'completed',
    ) {
      const id = crypto.randomUUID()
      const result = await db.query<{ sequence: string }>(
        'insert into chat_message(id,conversation_id,role,content,status) values($1,$2,$3,$4,$5) returning sequence::text',
        [id, conversationId, role, content, status],
      )
      return { id, sequence: result.rows[0].sequence }
    }
    const signal = new AbortController().signal
    const current = await conversation()
    const recall = (
      question = '咱们之前商量什么时候正式对外开放？',
      referenceHistory = true,
      conversationId = current,
      before = '9223372036854775807',
    ) =>
      retrieveConversationHistory({
        userId,
        conversationId,
        before,
        question,
        recentMessages: [],
        referenceHistory,
        signal,
      })
    try {
      await suite.test(
        'structured auxiliary output retries malformed results once and never retries cancellation',
        async () => {
          const { auxiliaryResponse } = await import(
            '../src/lib/chat/auxiliary-response'
          )
          const { z } = await import('zod')
          const schema = z.object({ value: z.string() }).strict()
          const requestId = crypto.randomUUID()
          await db.query(
            "insert into chat_request_usage(request_id,user_id,model,status) values($1,$2,'deepseek-flash','completed')",
            [requestId, userId],
          )
          let attempts = 0
          respond = () =>
            ++attempts === 1
              ? { value: 'evidence', unexpected: true }
              : { value: 'evidence' }
          const result = await auxiliaryResponse({
            instructions: 'Fixture',
            input: 'Fixture',
            maxOutputTokens: 128,
            outputSchema: schema,
            requestId,
            signal,
          })
          assert.equal(attempts, 2)
          assert.deepEqual(JSON.parse(result.text), { value: 'evidence' })
          const usage = await db.query<{
            context_input_tokens: number
            context_output_tokens: number
          }>(
            'select context_input_tokens,context_output_tokens from chat_request_usage where request_id=$1',
            [requestId],
          )
          assert.deepEqual(usage.rows[0], {
            context_input_tokens: 24,
            context_output_tokens: 16,
          })
          attempts = 0
          respond = () => {
            attempts++
            return { unexpected: true }
          }
          await assert.rejects(
            auxiliaryResponse({
              instructions: 'Fixture',
              input: 'Fixture',
              maxOutputTokens: 128,
              outputSchema: schema,
              signal,
            }),
            /output schema/,
          )
          assert.equal(attempts, 2)
          const controller = new AbortController()
          attempts = 0
          respond = () => {
            attempts++
            controller.abort()
            return { unexpected: true }
          }
          await assert.rejects(
            auxiliaryResponse({
              instructions: 'Fixture',
              input: 'Fixture',
              maxOutputTokens: 128,
              outputSchema: schema,
              signal: controller.signal,
            }),
            { name: 'AbortError' },
          )
          assert.equal(attempts, 1)
          respond = null
        },
      )
      await suite.test(
        'chat-date filters respect the local day across UTC midnight',
        async () => {
          const id = await conversation()
          const earlier = await message(
            id,
            'LOCALDAY 这条记录属于上海的1月2日。',
          )
          const later = await message(id, 'LOCALDAY 这条记录属于上海的1月3日。')
          await db.query(
            "update chat_message set created_at='2026-01-01T17:30:00Z',updated_at='2026-01-01T17:30:00Z' where id=$1",
            [earlier.id],
          )
          await db.query(
            "update chat_message set created_at='2026-01-02T18:00:00Z',updated_at='2026-01-02T18:00:00Z' where id=$1",
            [later.id],
          )
          const result = await searchRecallCandidates(
            {
              userId,
              conversationId: id,
              before: '9223372036854775807',
              question: 'LOCALDAY',
              recentMessages: [],
              referenceHistory: false,
              signal,
              timeZone: 'Asia/Shanghai',
            },
            'LOCALDAY',
            {
              search: true,
              queries: [],
              after: '2026-01-02',
              before: '2026-01-02',
            },
            true,
          )
          assert.deepEqual(
            result.map((source) => source.messageId),
            [earlier.id],
          )
        },
      )
      await suite.test(
        'indexes normalized identifiers and long-message tails atomically, including edits and deactivation',
        async () => {
          const id = await conversation()
          const original = await message(
            id,
            '背景。'.repeat(12000) + '最后确认：ＡＢＣ-731 于十二月底上线。',
          )
          const indexed = await db.query<{ content: string }>(
            'select content from chat_recall_chunk where message_id=$1 and terms && $2::text[]',
            [original.id, ['abc-731']],
          )
          assert.ok(
            indexed.rows.some((row) => row.content.includes('十二月底')),
          )
          await db.query(
            "update chat_message set content='已经改为明年一月发布' where id=$1",
            [original.id],
          )
          assert.equal(
            (
              await db.query(
                'select 1 from chat_recall_chunk where message_id=$1 and terms && $2::text[]',
                [original.id, ['abc-731']],
              )
            ).rowCount,
            0,
          )
          await db.query(
            "update chat_message set status='streaming' where id=$1",
            [original.id],
          )
          assert.equal(
            (
              await db.query(
                'select 1 from chat_recall_chunk where message_id=$1',
                [original.id],
              )
            ).rowCount,
            0,
          )
          await db.query(
            "update chat_message set status='completed' where id=$1",
            [original.id],
          )
          await db.query('update chat_message set active=false where id=$1', [
            original.id,
          ])
          assert.equal(
            (
              await db.query(
                'select 1 from chat_recall_chunk where message_id=$1',
                [original.id],
              )
            ).rowCount,
            0,
          )
          const streaming = await message(
            id,
            '不应被检索的流式数据',
            'assistant',
            'streaming',
          )
          assert.equal(
            (
              await db.query(
                'select 1 from chat_recall_chunk where message_id=$1',
                [streaming.id],
              )
            ).rowCount,
            0,
          )
        },
      )
      await suite.test(
        'query expansion finds paraphrased cross-session facts without exposing another account',
        async () => {
          const past = await conversation()
          const source = await message(
            past,
            '产品发布里程碑：2026年12月31日上线。',
          )
          const foreign = await conversation(otherId)
          await message(foreign, '产品发布里程碑：FOREIGN-SECRET-4401。')
          await message(
            past,
            '只是一条失败回复 FOREIGN-FAILURE',
            'assistant',
            'failed',
          )
          const result = await recall()
          assert.ok(result.sources.some((item) => item.messageId === source.id))
          assert.doesNotMatch(result.referenceText, /FOREIGN/)
          assert.ok(
            captured.every((candidates) =>
              candidates.every(
                (candidate) => !candidate.content.includes('FOREIGN'),
              ),
            ),
          )
          assert.equal((await recall(undefined, false)).sources.length, 0)
          assert.equal(
            (await recall('发布', false, past)).sources.some(
              (item) => item.messageId === source.id,
            ),
            true,
          )
        },
      )
      await suite.test(
        'PostgreSQL code-point chunks fit the renderer contract when they contain surrogate pairs',
        async () => {
          const { historySourceSchema } = await import(
            '@velin/contracts/context'
          )
          const id = await conversation()
          const source = await message(
            id,
            '😀'.repeat(850) + ' EMOJI-ID-731 预算501元。',
          )
          terms = ['EMOJI-ID-731']
          select = (candidates) =>
            candidates.filter((candidate) =>
              candidate.content.includes('EMOJI-ID-731'),
            )
          const result = await recall('EMOJI-ID-731预算？')
          const found = result.sources.find(
            (item) => item.messageId === source.id,
          )!
          assert.ok(found.excerpt.length > 1000)
          assert.equal(historySourceSchema.safeParse(found).success, true)
          assert.equal(
            historySourceSchema.safeParse({
              ...found,
              excerpt: '\u0000'.repeat(1001),
            }).success,
            false,
          )
          terms = ['上线 发布 日期 里程碑']
        },
      )
      await suite.test(
        'selected facts from multiple conversations survive adjacent-turn expansion',
        async () => {
          const first = await conversation(),
            second = await conversation()
          const one = await message(first, 'HAZEL 项目预算为42000元。')
          const two = await message(second, 'HAZEL 项目负责人为林舟。')
          await message(first, '收到，这是建议而非用户确认。', 'assistant')
          terms = ['HAZEL 预算', 'HAZEL 负责人']
          select = (candidates) =>
            candidates.filter((candidate) =>
              candidate.content.includes('HAZEL'),
            )
          const result = await recall('HAZEL负责人和经费分别是什么？')
          assert.ok(
            [one.id, two.id].every((id) =>
              result.sources.some((source) => source.messageId === id),
            ),
          )
          const source = result.evidence[0]
          await db.query(
            'update chat_conversation set context_revision=context_revision+1 where id=$1',
            [source.conversationId],
          )
          assert.equal(
            await validateRecallEvidence(
              {
                userId,
                conversationId: current,
                before: '9223372036854775807',
                question: 'HAZEL',
                recentMessages: [],
                referenceHistory: true,
                signal,
              },
              result.evidence,
            ),
            false,
          )
        },
      )
      await suite.test(
        'explicit remember and forget finish before reply preparation and block old raw evidence',
        async () => {
          const id = await conversation()
          const source = await message(id, '请记住，以后优先用简体中文回答。')
          const assistant = await message(id, '', 'assistant', 'streaming')
          respond = (input) =>
            input.instructions.includes('提取用户')
              ? {
                  entries: [
                    {
                      topic: '回答语言',
                      quote: '以后优先用简体中文回答。',
                      action: 'remember',
                    },
                  ],
                }
              : { queries: [], after: null, before: null }
          const prepared = await prepareConversationContext({
            conversationId: id,
            userId,
            userMessageId: source.id,
            assistantMessageId: assistant.id,
            requestId: crypto.randomUUID(),
            model: 'deepseek-flash',
            signal,
          })
          assert.equal((await readMemory(userId)).entries.length, 1)
          assert.ok(
            prepared.messages.some((item) =>
              item.content.includes('"remembered":1'),
            ),
          )
          const forget = await message(id, '请忘记我的回答语言偏好。')
          respond = (input) =>
            input.instructions.includes('提取用户')
              ? {
                  entries: [
                    {
                      topic: '回答语言',
                      quote: '请忘记我的回答语言偏好。',
                      action: 'forget',
                    },
                  ],
                }
              : { queries: [], after: null, before: null }
          await prepareConversationContext({
            conversationId: id,
            userId,
            userMessageId: forget.id,
            assistantMessageId: assistant.id,
            requestId: crypto.randomUUID(),
            model: 'deepseek-flash',
            signal,
          })
          assert.equal((await readMemory(userId)).entries.length, 0)
          assert.equal(
            (
              await db.query(
                'select 1 from chat_recall_exclusion where user_id=$1 and source_message_id=$2',
                [userId, source.id],
              )
            ).rowCount,
            1,
          )
          respond = null
          terms = ['简体中文 回答语言']
          select = (candidates) => candidates
          assert.equal(
            (await recall('我之前的回答语言偏好是什么？')).sources.filter(
              (item) => item.conversationId === id,
            ).length,
            0,
          )
        },
      )
      await suite.test(
        'manual memory deletion invalidates replies derived from it and does not resurrect on renamed-topic retries',
        async () => {
          let state = await updateMemory(userId, {
            action: 'save',
            entry: { topic: '早餐习惯', content: '我的早餐固定选燕麦。' },
          })
          const memory = state.entries.find(
            (entry) => entry.topic === '早餐习惯',
          )!
          const past = await conversation()
          const answer = await message(
            past,
            '燕麦早餐已经纳入考虑。',
            'assistant',
          )
          await db.query(
            'update chat_message set recall_dependencies=$2::jsonb where id=$1',
            [
              answer.id,
              JSON.stringify({
                complete: true,
                messages: [],
                memories: [{ id: memory.id, version: memory.version }],
              }),
            ],
          )
          terms = ['燕麦 早餐']
          select = (candidates) =>
            candidates.filter((candidate) => candidate.content.includes('燕麦'))
          assert.ok(
            (await recall('之前的燕麦早餐建议？')).sources.some(
              (item) => item.messageId === answer.id,
            ),
          )
          state = await updateMemory(userId, {
            action: 'delete',
            id: memory.id,
            version: memory.version,
          })
          assert.equal(state.entries.length, 0)
          assert.equal(
            (await recall('之前的燕麦早餐建议？')).sources.some(
              (item) => item.messageId === answer.id,
            ),
            false,
          )
          const fact = await message(past, '我通常喜欢喝无糖茶。')
          const job = {
            conversationId: past,
            sourceMessageId: fact.id,
            revision: '1',
            signal,
          }
          respond = () => ({
            entries: [
              {
                topic: '饮品',
                quote: '我通常喜欢喝无糖茶。',
                action: 'remember',
              },
            ],
          })
          await learnMemory(job)
          const learned = (await readMemory(userId)).entries[0]
          await updateMemory(userId, {
            action: 'save',
            entry: {
              id: learned.id,
              version: learned.version,
              topic: '饮品选择',
              content: '优先白水。',
            },
          })
          await learnMemory(job)
          assert.equal((await readMemory(userId)).entries.length, 1)
          respond = null
        },
      )
      await suite.test(
        'edited historical preferences supersede newer originals and late forgetting cannot erase the correction',
        async () => {
          const id = await conversation()
          const original = await message(id, '我以后偏好英文。')
          await db.query(
            "update chat_message set created_at='2026-01-01T00:00:00Z',updated_at='2026-01-01T00:00:00Z' where id=$1",
            [original.id],
          )
          const latest = await message(id, '我以后偏好中文。')
          respond = () => ({
            entries: [
              {
                topic: '语言选择',
                quote: '我以后偏好中文。',
                action: 'remember',
              },
            ],
          })
          await learnMemory({
            conversationId: id,
            sourceMessageId: latest.id,
            revision: '1',
            signal,
          })
          await db.query(
            "update chat_message set content='我现在更正为偏好英文。',updated_at=clock_timestamp() where id=$1",
            [original.id],
          )
          await db.query(
            'update chat_conversation set context_revision=2 where id=$1',
            [id],
          )
          respond = () => ({
            entries: [
              {
                topic: '语言选择',
                quote: '我现在更正为偏好英文。',
                action: 'remember',
              },
            ],
          })
          await learnMemory({
            conversationId: id,
            sourceMessageId: original.id,
            revision: '2',
            signal,
          })
          assert.equal(
            (await readMemory(userId)).entries.find(
              (entry) => entry.topic === '语言选择',
            )?.content,
            '我现在更正为偏好英文。',
          )
          const oldForget = await message(id, '请忘记语言选择。')
          await db.query(
            "update chat_message set created_at='2026-01-02T00:00:00Z',updated_at='2026-01-02T00:00:00Z' where id=$1",
            [oldForget.id],
          )
          respond = () => ({
            entries: [
              {
                topic: '语言选择',
                quote: '请忘记语言选择。',
                action: 'forget',
              },
            ],
          })
          await learnMemory({
            conversationId: id,
            sourceMessageId: oldForget.id,
            revision: '2',
            signal,
          })
          assert.equal(
            (await readMemory(userId)).entries.find(
              (entry) => entry.topic === '语言选择',
            )?.content,
            '我现在更正为偏好英文。',
          )
          assert.equal(
            (
              await db.query(
                'select 1 from chat_recall_exclusion where user_id=$1 and source_message_id=$2',
                [userId, original.id],
              )
            ).rowCount,
            0,
          )
          respond = null
        },
      )
      await suite.test(
        'forgetting a manually stored sensitive topic is never blocked by automatic extraction filtering',
        async () => {
          await updateMemory(userId, {
            action: 'save',
            entry: {
              topic: '病史',
              content: 'Synthetic health fixture, not a real person.',
            },
          })
          const id = await conversation(),
            source = await message(id, '请忘记我的病史信息。')
          respond = () => ({
            entries: [
              {
                topic: '病史',
                quote: '请忘记我的病史信息。',
                action: 'forget',
              },
            ],
          })
          await learnMemory({
            conversationId: id,
            sourceMessageId: source.id,
            revision: '1',
            signal,
          })
          assert.equal(
            (await readMemory(userId)).entries.some(
              (entry) => entry.topic === '病史',
            ),
            false,
          )
          respond = null
        },
      )
      await suite.test(
        'clear and disable fence cross-history but preserve explicit current-conversation context',
        async () => {
          await updateMemory(userId, { action: 'clear' })
          terms = ['HAZEL']
          select = (candidates) => candidates
          assert.equal((await recall('HAZEL预算')).sources.length, 0)
          const past = await conversation()
          await message(past, 'NEWFACT 预算901元。')
          terms = ['NEWFACT']
          assert.ok((await recall('NEWFACT预算')).sources.length)
          await updateMemory(userId, {
            action: 'settings',
            referenceHistory: false,
          })
          assert.equal((await recall('NEWFACT预算')).sources.length, 0)
          assert.ok((await recall('NEWFACT预算', false, past)).sources.length)
          await updateMemory(userId, { action: 'settings', enabled: false })
          assert.equal((await readMemory(userId)).referenceHistory, false)
          await updateMemory(userId, {
            action: 'settings',
            enabled: true,
            referenceHistory: true,
          })
        },
      )
      await suite.test(
        'unavailable auxiliary retrieval is visible and cancellation never falls back',
        async () => {
          respond = () => {
            throw new Error('Synthetic upstream failure')
          }
          const degraded = await recall('NEWFACT预算')
          assert.equal(degraded.degraded, true)
          assert.ok(
            degraded.sources.some((source) => source.excerpt.includes('901')),
          )
          const controller = new AbortController()
          controller.abort()
          await assert.rejects(
            retrieveConversationHistory({
              userId,
              conversationId: current,
              before: '9223372036854775807',
              question: 'NEWFACT',
              recentMessages: [],
              referenceHistory: true,
              signal: controller.signal,
            }),
            { name: 'AbortError' },
          )
          respond = null
          assert.ok(providerCalls > 0)
        },
      )
      await suite.test(
        'late semantic selection cannot commit sources after settings change',
        async () => {
          const id = await conversation(),
            source = await message(id, 'NEWFACT现在是多少？'),
            assistant = await message(id, '', 'assistant', 'streaming')
          let started!: () => void, release!: () => void
          const ready = new Promise<void>((resolve) => {
              started = resolve
            }),
            gate = new Promise<void>((resolve) => {
              release = resolve
            })
          respond = async (input) => {
            if (input.instructions.includes('改写历史'))
              return {
                queries: ['NEWFACT'],
                after: null,
                before: null,
              }
            const { candidates } = JSON.parse(input.input) as {
              candidates: Candidate[]
            }
            started()
            await gate
            return {
              evidence: candidates.slice(0, 1).map((candidate) => ({
                id: candidate.id,
                quote: candidate.content.slice(0, 50),
              })),
            }
          }
          const pending = prepareConversationContext({
            conversationId: id,
            userId,
            userMessageId: source.id,
            assistantMessageId: assistant.id,
            requestId: crypto.randomUUID(),
            model: 'deepseek-flash',
            signal,
          })
          await ready
          await updateMemory(userId, {
            action: 'settings',
            referenceHistory: false,
          })
          release()
          await assert.rejects(pending, /记忆设置已变化/)
          assert.equal(
            (
              await db.query(
                'select context_metadata from chat_message where id=$1',
                [assistant.id],
              )
            ).rows[0].context_metadata,
            null,
          )
        },
      )
    } finally {
      await db.query('delete from "user" where id=any($1::text[])', [
        [userId, otherId],
      ])
      await db.end()
    }
  },
)
