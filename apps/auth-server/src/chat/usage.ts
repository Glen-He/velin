import { config } from '../config.js'
import { databasePool } from '../database.js'

export type ChatLimitReason = 'duplicate' | 'busy' | 'minute' | 'daily' | 'global'
export type ChatRequestStatus = 'completed' | 'failed' | 'cancelled'

export async function reserveChatRequest(
  userId: string,
  requestId: string,
): Promise<ChatLimitReason | null> {
  const client = await databasePool.connect()

  try {
    await client.query('begin')
    // Serialize quota checks across server instances before inserting a request.
    await client.query('select pg_advisory_xact_lock(20260928, 1)')
    await client.query(
      `update chat_request_usage
       set status = 'failed', finished_at = now()
       where status = 'running' and created_at < now() - interval '3 minutes'`,
    )

    const duplicate = await client.query(
      'select 1 from chat_request_usage where request_id = $1',
      [requestId],
    )
    if (duplicate.rowCount) {
      await client.query('rollback')
      return 'duplicate'
    }

    const counts = await client.query<{
      active: string
      minute: string
      daily: string
      global: string
    }>(
      `select
         count(*) filter (
           where user_id = $1 and status = 'running'
         )::text as active,
         count(*) filter (
           where user_id = $1 and created_at >= now() - interval '1 minute'
         )::text as minute,
         count(*) filter (
           where user_id = $1 and created_at >=
             date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
         )::text as daily,
         count(*) filter (
           where created_at >=
             date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
         )::text as global
       from chat_request_usage
       where created_at >= now() - interval '1 day'
          or status = 'running'`,
      [userId],
    )
    const count = counts.rows[0]
    const reason: ChatLimitReason | null =
      Number(count.active) >= 1
        ? 'busy'
        : Number(count.minute) >= config.chat.minuteLimitPerUser
          ? 'minute'
          : Number(count.daily) >= config.chat.dailyLimitPerUser
            ? 'daily'
            : Number(count.global) >= config.chat.dailyLimitGlobal
              ? 'global'
              : null

    if (reason) {
      await client.query('rollback')
      return reason
    }

    await client.query(
      `insert into chat_request_usage
         (request_id, user_id, model, status)
       values ($1, $2, $3, 'running')`,
      [requestId, userId, config.chat.model],
    )
    await client.query('commit')
    return null
  } catch (error) {
    await client.query('rollback')
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
