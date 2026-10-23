import 'server-only'
import type { MemoryAction, MemoryState } from '@velin/contracts/memory'
import { databasePool } from '../database/connection'
import { UserFacingError } from '@velin/contracts/error-copy'
import { excludeMemoryEvidence } from './memory-provenance'

export async function readMemory(userId: string): Promise<MemoryState> {
  const preferences = await databasePool.query<{
    enabled: boolean
    reference_history: boolean
  }>(
    'select enabled, reference_history from chat_memory_preference where user_id = $1',
    [userId],
  )
  const result = await databasePool.query<{
    id: string
    topic: string
    content: string
    origin: 'manual' | 'automatic'
    version: number
    source_conversation_id: string | null
    source_quote: string | null
    updated_at: Date
  }>(
    'select * from chat_memory where user_id = $1 order by updated_at desc limit 200',
    [userId],
  )
  return {
    enabled: preferences.rows[0]?.enabled ?? true,
    referenceHistory:
      (preferences.rows[0]?.enabled ?? true) &&
      (preferences.rows[0]?.reference_history ?? true),
    entries: result.rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      content: row.content,
      origin: row.origin,
      version: row.version,
      sourceConversationId: row.source_conversation_id,
      sourceQuote: row.source_quote,
      updatedAt: row.updated_at.getTime(),
    })),
  }
}

export async function updateMemory(userId: string, action: MemoryAction) {
  const client = await databasePool.connect()
  try {
    await client.query('begin')
    await client.query('select id from "user" where id = $1 for update', [
      userId,
    ])
    await client.query(
      'insert into chat_memory_preference(user_id) values ($1) on conflict do nothing',
      [userId],
    )
    await client.query(
      'update chat_memory_preference set epoch = epoch + 1 where user_id = $1',
      [userId],
    )
    if (action.action === 'settings')
      await client.query(
        `update chat_memory_preference set enabled = coalesce($2,enabled),
         reference_history = case when $2 = false then false when coalesce($2,enabled) then coalesce($3,reference_history) else false end where user_id = $1`,
        [userId, action.enabled ?? null, action.referenceHistory ?? null],
      )
    else if (action.action === 'clear') {
      await client.query('delete from chat_memory where user_id = $1', [userId])
      await client.query(
        'delete from chat_memory_evidence where user_id = $1',
        [userId],
      )
      await client.query(
        'update chat_memory_preference set forget_before = now() where user_id = $1',
        [userId],
      )
    } else if (action.action === 'delete') {
      const entry = await client.query<{
        source_message_id: string | null
        topic: string
      }>(
        'delete from chat_memory where id = $1 and user_id = $2 and version = $3 returning source_message_id, topic',
        [action.id, userId, action.version],
      )
      if (!entry.rowCount)
        throw new UserFacingError('记忆已变化，请刷新后重试。')
      const row = entry.rows[0]
      await excludeMemoryEvidence(client, userId, row.topic)
      await client.query(
        'insert into chat_memory_topic_tombstone values ($1,$2,now()) on conflict(user_id,topic) do update set forget_before = excluded.forget_before',
        [userId, row.topic],
      )
    } else {
      const { entry } = action
      if (entry.id) {
        const original = await client.query<{ topic: string }>(
          'select topic from chat_memory where id = $1 and user_id = $2 and version = $3',
          [entry.id, userId, entry.version],
        )
        if (original.rows[0]) {
          await excludeMemoryEvidence(client, userId, original.rows[0].topic)
          await client.query(
            'insert into chat_memory_topic_tombstone values ($1,$2,now()) on conflict(user_id,topic) do update set forget_before = excluded.forget_before',
            [userId, original.rows[0].topic],
          )
        }
        const result = await client.query(
          `update chat_memory set topic = $4, content = $5, origin = 'manual', source_message_id = null, source_conversation_id = null, source_quote = null, version = version + 1, updated_at = now() where id = $1 and user_id = $2 and version = $3`,
          [entry.id, userId, entry.version, entry.topic, entry.content],
        )
        if (!result.rowCount)
          throw new UserFacingError('记忆已变化，请刷新后重试。')
      } else {
        const count = await client.query<{ count: number }>(
          'select count(*)::int as count from chat_memory where user_id = $1',
          [userId],
        )
        if (count.rows[0].count >= 200)
          throw new UserFacingError('最多保存 200 条记忆，请先整理已有内容。')
        await client.query(
          `insert into chat_memory(id, user_id, topic, content, origin) values ($1,$2,$3,$4,'manual')`,
          [crypto.randomUUID(), userId, entry.topic, entry.content],
        )
      }
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '23505'
    )
      throw new UserFacingError('同一主题已有记忆，请编辑现有条目。')
    throw error
  } finally {
    client.release()
  }
  return readMemory(userId)
}
