import 'server-only'
import { config } from '../config'
import { databasePool } from '../database/connection'
import type { PoolClient } from 'pg'

export type ChatLimitReason =
  | 'duplicate'
  | 'busy'
  | 'minute'
  | 'daily'
  | 'global'
export type ChatRequestStatus =
  | 'completed'
  | 'incomplete'
  | 'failed'
  | 'cancelled'

// 与最终保存保持消息在前、用量在后的锁顺序；租约到期后旧执行不再拥有回复写入权。
export async function expireChatRequests(
  database: Pick<PoolClient, 'query'>,
  userId?: string,
) {
  await database.query(
    `update chat_message m set status = 'failed', updated_at = now()
     where m.active and m.status = 'streaming' and exists (
       select 1 from chat_request_usage u where u.request_id = m.request_id
       and u.status = 'running' and u.created_at < now() - interval '8 minutes'
       and ($1::text is null or u.user_id = $1)
     )`,
    [userId ?? null],
  )
  await database.query(
    `update chat_request_usage set status = 'failed', finished_at = now()
     where status = 'running' and created_at < now() - interval '8 minutes'
     and ($1::text is null or user_id = $1)`,
    [userId ?? null],
  )
}

export async function reserveChatRequest(
  userId: string,
  requestId: string,
  model: string,
): Promise<ChatLimitReason | null> {
  const client = await databasePool.connect()

  try {
    await client.query('begin')
    // 先等待当前账号，再通过有条件的原子 upsert 预留全局日额度。
    // 一个账号被锁住时，不能持有全局锁并阻塞其他账号。
    await client.query('select id from "user" where id = $1 for update', [
      userId,
    ])
    await expireChatRequests(client, userId)

    const duplicate = await client.query(
      'select 1 from chat_request_usage where request_id = $1',
      [requestId],
    )
    if (duplicate.rowCount) {
      await client.query('commit')
      return 'duplicate'
    }

    const counts = await client.query<{
      active: string
      minute: string
    }>(
      `select
         count(*) filter (
           where status = 'running'
         )::text as active,
         count(*) filter (
           where created_at >= now() - interval '1 minute'
         )::text as minute
       from chat_request_usage
       where user_id = $1 and (created_at >= now() - interval '1 minute'
          or status = 'running')`,
      [userId],
    )
    const daily = await client.query<{ requests: number }>(
      `select requests from chat_quota_day where subject = $1
       and day = (now() at time zone 'UTC')::date`,
      [userId],
    )
    const count = counts.rows[0]
    const reason: ChatLimitReason | null =
      Number(count.active) >= 1
        ? 'busy'
        : Number(count.minute) >= config.chat.minuteLimitPerUser
          ? 'minute'
          : (daily.rows[0]?.requests ?? 0) >= config.chat.dailyLimitPerUser
            ? 'daily'
            : null

    if (reason) {
      await client.query('commit')
      return reason
    }

    const global = await client.query(
      `insert into chat_quota_day(subject, day, requests)
       values ('', (now() at time zone 'UTC')::date, 1)
       on conflict(subject, day) do update set requests = chat_quota_day.requests + 1
       where chat_quota_day.requests < $1 returning requests`,
      [config.chat.dailyLimitGlobal],
    )
    if (!global.rowCount) {
      await client.query('commit')
      return 'global'
    }
    await client.query(
      `insert into chat_quota_day (subject, day, requests)
       values ($1, (now() at time zone 'UTC')::date, 1)
       on conflict (subject, day) do update set requests = chat_quota_day.requests + 1`,
      [userId],
    )
    await client.query(
      `insert into chat_request_usage
         (request_id, user_id, model, status)
       values ($1, $2, $3, 'running')`,
      [requestId, userId, model],
    )
    await client.query('commit')
    return null
  } catch (error) {
    await client.query('rollback')
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '23505' &&
      'constraint' in error &&
      error.constraint === 'chat_request_usage_pkey'
    )
      return 'duplicate'
    throw error
  } finally {
    client.release()
  }
}

export async function finishChatRequest(
  requestId: string,
  status: ChatRequestStatus,
  usage?: { inputTokens: number; outputTokens: number },
) {
  await databasePool.query(
    `update chat_request_usage
     set status = $2,
         input_tokens = $3,
         output_tokens = $4,
         finished_at = now()
     where request_id = $1 and status = 'running'`,
    [
      requestId,
      status,
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
    ],
  )
}
