import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'

const enabled = Boolean(process.env.VELIN_TEST_DATABASE_URL)
if (enabled) {
  const url = new URL(process.env.VELIN_TEST_DATABASE_URL!)
  assert.match(url.pathname, /^\/velin_.*test$/)
  Object.assign(process.env, {
    DATABASE_URL: url.href,
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'lifecycle-fixture-secret-at-least-32-characters',
    APP_URL: 'http://localhost:3000',
    PASSKEY_RP_ID: 'localhost',
    EMAIL_TRANSPORT: 'console',
  })
}

test(
  'chat reservations and late writes remain isolated across concurrent lifecycles',
  {
    skip: !enabled,
    timeout: 30_000,
  },
  async (suite) => {
    const { databasePool: db } = await import('../src/lib/database/connection')
    const { reserveChatRequest, finishChatRequest } = await import(
      '../src/lib/chat/usage'
    )
    const {
      beginChatTurn,
      finalizeAssistantMessage,
      persistAssistantSnapshot,
    } = await import('../src/lib/chat/turn')
    const { stopOcrQueue } = await import('../src/lib/ocr/queue')
    const users: string[] = []
    async function identity() {
      const id = crypto.randomUUID()
      await db.query(
        'insert into "user"(id,name,email,"emailVerified") values($1,\'Lifecycle fixture\',$2,true)',
        [id, `${id}@example.test`],
      )
      users.push(id)
      return id
    }
    async function turn(userId: string) {
      const input = {
        userId,
        requestId: crypto.randomUUID(),
        conversationId: crypto.randomUUID(),
        userMessageId: crypto.randomUUID(),
        content: 'current question',
        model: 'deepseek-flash' as const,
      }
      assert.equal(
        await reserveChatRequest(userId, input.requestId, input.model),
        null,
      )
      const result = await beginChatTurn(input)
      return { ...input, ...result }
    }
    try {
      await suite.test(
        'a blocked account cannot hold the global reservation lock',
        async () => {
          const blockedUser = await identity(),
            otherUser = await identity()
          const locker = await db.connect()
          const pid = (
            await locker.query<{ pid: number }>(
              'select pg_backend_pid() as pid',
            )
          ).rows[0].pid
          let pending: Promise<unknown> | undefined
          let timeout: ReturnType<typeof setTimeout> | undefined
          try {
            await locker.query('begin')
            await locker.query('select id from "user" where id=$1 for update', [
              blockedUser,
            ])
            pending = reserveChatRequest(
              blockedUser,
              crypto.randomUUID(),
              'deepseek-flash',
            )
            let waiting = false
            for (let attempt = 0; attempt < 100; attempt++) {
              const result = await db.query(
                'select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
                [pid],
              )
              if (result.rowCount) {
                waiting = true
                break
              }
              await delay(5)
            }
            assert.equal(
              waiting,
              true,
              'reservation must reach the held account lock',
            )
            assert.equal(
              await Promise.race([
                reserveChatRequest(
                  otherUser,
                  crypto.randomUUID(),
                  'deepseek-flash',
                ),
                new Promise<never>((_, reject) => {
                  timeout = setTimeout(
                    () => reject(new Error('Unrelated account was blocked.')),
                    1500,
                  )
                }),
              ]),
              null,
            )
          } finally {
            clearTimeout(timeout)
            await locker.query('rollback')
            locker.release()
            await pending
          }
        },
      )
      await suite.test(
        'completed messages cannot be overwritten by a second finalization',
        async () => {
          const current = await turn(await identity())
          const finish = {
            conversationId: current.conversationId,
            messageId: current.assistantMessageId,
            requestId: current.requestId,
            content: 'saved answer',
            reasoning: '',
            status: 'completed' as const,
          }
          await finalizeAssistantMessage(finish)
          await persistAssistantSnapshot(
            current.conversationId,
            current.assistantMessageId,
            'late checkpoint',
            '',
          )
          await assert.rejects(
            finalizeAssistantMessage({
              ...finish,
              content: 'late replacement',
            }),
          )
          assert.equal(
            (
              await db.query('select content from chat_message where id=$1', [
                current.assistantMessageId,
              ])
            ).rows[0].content,
            'saved answer',
          )
        },
      )
      await suite.test(
        'expired requests seal their message before admitting a new request',
        async () => {
          const current = await turn(await identity())
          await persistAssistantSnapshot(
            current.conversationId,
            current.assistantMessageId,
            'recoverable partial answer',
            '',
          )
          await db.query(
            "update chat_request_usage set created_at=now()-interval '9 minutes' where request_id=$1",
            [current.requestId],
          )
          const nextRequest = crypto.randomUUID()
          assert.equal(
            await reserveChatRequest(
              current.userId,
              nextRequest,
              current.model,
            ),
            null,
          )
          assert.equal(
            (
              await db.query('select status from chat_message where id=$1', [
                current.assistantMessageId,
              ])
            ).rows[0].status,
            'failed',
          )
          await persistAssistantSnapshot(
            current.conversationId,
            current.assistantMessageId,
            'late checkpoint',
            '',
          )
          await assert.rejects(
            finalizeAssistantMessage({
              conversationId: current.conversationId,
              messageId: current.assistantMessageId,
              requestId: current.requestId,
              content: 'late answer',
              reasoning: '',
              status: 'completed',
            }),
          )
          assert.equal(
            (
              await db.query('select content from chat_message where id=$1', [
                current.assistantMessageId,
              ])
            ).rows[0].content,
            'recoverable partial answer',
          )
          await finishChatRequest(nextRequest, 'cancelled')
        },
      )
      await suite.test(
        'one account admits at most one concurrent generation and replays do not consume more quota',
        async () => {
          const userId = await identity(),
            requestId = crypto.randomUUID()
          const results = await Promise.all(
            Array.from({ length: 8 }, () =>
              reserveChatRequest(userId, requestId, 'deepseek-flash'),
            ),
          )
          assert.equal(results.filter((result) => result === null).length, 1)
          assert.equal(
            results.filter((result) => result === 'duplicate').length,
            7,
          )
          assert.equal(
            (
              await db.query(
                'select requests from chat_quota_day where subject=$1',
                [userId],
              )
            ).rows[0].requests,
            1,
          )
          assert.equal(
            await reserveChatRequest(
              userId,
              crypto.randomUUID(),
              'deepseek-flash',
            ),
            'busy',
          )
        },
      )
      await suite.test(
        'concurrent cross-account request ID collisions roll back the losing quota',
        async () => {
          const first = await identity(),
            second = await identity()
          const requestId = crypto.randomUUID()
          const results = await Promise.all(
            [first, second].map((userId) =>
              reserveChatRequest(userId, requestId, 'deepseek-flash'),
            ),
          )
          assert.equal(results.filter((result) => result === null).length, 1)
          assert.equal(
            results.filter((result) => result === 'duplicate').length,
            1,
          )
          assert.equal(
            Number(
              (
                await db.query(
                  'select sum(requests) as total from chat_quota_day where subject=any($1::text[])',
                  [[first, second]],
                )
              ).rows[0].total,
            ),
            1,
          )
        },
      )
      await suite.test(
        'a different generation cannot finalize an active message',
        async () => {
          const current = await turn(await identity())
          await assert.rejects(
            finalizeAssistantMessage({
              conversationId: current.conversationId,
              messageId: current.assistantMessageId,
              requestId: crypto.randomUUID(),
              content: 'wrong generation',
              reasoning: '',
              status: 'completed',
            }),
          )
          assert.equal(
            (
              await db.query('select status from chat_message where id=$1', [
                current.assistantMessageId,
              ])
            ).rows[0].status,
            'streaming',
          )
        },
      )
      await suite.test(
        'maintenance seals abandoned messages without another request',
        async () => {
          const current = await turn(await identity())
          await db.query(
            "update chat_request_usage set created_at=now()-interval '9 minutes' where request_id=$1",
            [current.requestId],
          )
          const { runMaintenance } = await import('../src/lib/maintenance')
          await runMaintenance()
          assert.equal(
            (
              await db.query('select status from chat_message where id=$1', [
                current.assistantMessageId,
              ])
            ).rows[0].status,
            'failed',
          )
          assert.equal(
            (
              await db.query(
                'select status from chat_request_usage where request_id=$1',
                [current.requestId],
              )
            ).rows[0].status,
            'failed',
          )
        },
      )
    } finally {
      await stopOcrQueue()
      await db.query('delete from "user" where id=any($1::text[])', [users])
      await db.query(
        'delete from chat_quota_day where subject=any($1::text[])',
        [users],
      )
      await db.end()
    }
  },
)
