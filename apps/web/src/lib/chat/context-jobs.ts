import 'server-only'
import { z } from 'zod'
import type { PoolClient } from 'pg'
import { getOcrQueue, pgBossDb } from '../ocr/queue'
import { databasePool } from '../database/connection'
import { learnMemory } from './memory-learning'
import { ensureSummary } from './context'
import { deepseek } from './model'
import { logger } from '../logging'
import { selectRecentTurns, type ContextMessage } from './context-policy'

export const contextQueueName = 'chat-context-maintenance'
const jobSchema = z
  .object({
    conversationId: z.uuid(),
    sourceMessageId: z.uuid(),
    revision: z.string().regex(/^\d+$/),
    throughSequence: z.string().regex(/^\d+$/),
    requestId: z.uuid().optional(),
  })
  .strict()
export async function enqueueContextJob(
  client: PoolClient,
  conversationId: string,
  messageId: string,
) {
  const result = await client.query<{
    conversation_id: string
    source_message_id: string
    revision: string
    through_sequence: string
    request_id: string | null
  }>(
    `select c.id as conversation_id, c.context_revision::text as revision, a.sequence::text as through_sequence, a.request_id,
    (select id from chat_message where conversation_id = c.id and active and role = 'user' and sequence < a.sequence order by sequence desc limit 1) as source_message_id
    from chat_conversation c join chat_message a on a.conversation_id = c.id where c.id = $1 and a.id = $2 and a.active`,
    [conversationId, messageId],
  )
  const row = result.rows[0]
  if (!row?.source_message_id) return
  const boss = await getOcrQueue()
  await boss.send(
    contextQueueName,
    {
      conversationId,
      sourceMessageId: row.source_message_id,
      revision: row.revision,
      throughSequence: row.through_sequence,
      ...(row.request_id ? { requestId: row.request_id } : {}),
    },
    { id: messageId, db: pgBossDb(client) },
  )
}

export async function startContextWorker() {
  const boss = await getOcrQueue()
  await boss.work(
    contextQueueName,
    { localConcurrency: 1, batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        const startedAt = performance.now()
        try {
          const data = jobSchema.parse(job.data)
          const signal = AbortSignal.any([
            job.signal,
            AbortSignal.timeout(360_000),
          ])
          const owner = await databasePool.query<{ user_id: string }>(
            'select user_id from chat_conversation where id = $1 and context_revision = $2',
            [data.conversationId, data.revision],
          )
          if (!owner.rows[0]) continue
          if (!deepseek) throw new Error('Model service is not configured.')
          await learnMemory({ ...data, signal })
          const rows = await databasePool.query<ContextMessage>(
            `select * from (select id, sequence::text, role, content, status from chat_message where conversation_id = $1 and active and sequence <= $2 order by chat_message.sequence desc limit 64) recent order by sequence::bigint`,
            [data.conversationId, data.throughSequence],
          )
          const first = selectRecentTurns(rows.rows)[0]
          if (first)
            await ensureSummary({
              conversationId: data.conversationId,
              revision: data.revision,
              userId: owner.rows[0].user_id,
              before: first.sequence,
              signal,
              requestId: data.requestId,
            })
          logger.info('chat.context_finished', {
            generationId: data.requestId,
            durationMs: Math.round(performance.now() - startedAt),
            outcome: 'completed',
          })
        } catch (error) {
          logger.error('chat.context_failed', {
            error,
            durationMs: Math.round(performance.now() - startedAt),
          })
          throw error
        }
      }
    },
  )
}
