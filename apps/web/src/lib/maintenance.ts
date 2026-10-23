import 'server-only'
import type { PoolClient } from 'pg'
import { databasePool } from './database/connection'
import { logger } from './logging'
import { expireChatRequests } from './chat/usage'

export async function pruneUnreferencedPdfCache(
  client: Pick<PoolClient, 'query'>,
  userId?: string,
) {
  await client.query(
    `delete from chat_pdf_page_cache c
     where ($1::text is null or c.user_id = $1)
       and not exists (select 1 from chat_attachment a
         where a.user_id = c.user_id and a.source_sha256 = c.sha256)`,
    [userId ?? null],
  )
}

export async function runMaintenance() {
  const client = await databasePool.connect()
  try {
    await client.query('begin')
    const acquired = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_xact_lock(20261022, 3) as locked',
    )
    if (!acquired.rows[0]?.locked) {
      await client.query('rollback')
      return
    }
    await expireChatRequests(client)
    await client.query(
      `delete from chat_attachment where message_id is null and created_at < now() - interval '24 hours'`,
    )
    await client.query(`update chat_attachment a set status = 'failed', ocr_error = '文件处理已中断，请移除后重新添加。'
      where status = 'processing' and mime_type <> 'application/pdf'
        and created_at < now() - interval '90 seconds'
        and not exists (select 1 from document_processing_lease l where l.user_id = a.user_id and l.expires_at > now())`)
    await client.query(
      'delete from document_processing_lease where expires_at <= now()',
    )
    await client.query(
      `delete from attachment_rate_budget where window_start < now() - interval '1 day'`,
    )
    await client.query(
      `delete from chat_quota_day where day < (now() at time zone 'UTC')::date - 90`,
    )
    await client.query(
      `delete from chat_pdf_page_cache where updated_at < now() - interval '24 hours'`,
    )
    await pruneUnreferencedPdfCache(client)
    await client.query(
      `delete from security_operation_grant where expires_at <= now()`,
    )
    await client.query(`delete from "rateLimit" where "lastRequest" < $1`, [
      Date.now() - 24 * 60 * 60_000,
    ])
    await client.query(
      `insert into service_heartbeat (service) values ('maintenance') on conflict (service) do update set updated_at = now()`,
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export function startWorkerHeartbeat() {
  let pending: Promise<unknown> | undefined
  const tick = () => {
    pending = databasePool
      .query(
        `insert into service_heartbeat (service) values ('ocr')
      on conflict (service) do update set updated_at = now()`,
      )
      .catch((error: unknown) => logger.error('maintenance.failed', { error }))
  }
  tick()
  const interval = setInterval(tick, 30_000)
  interval.unref()
  return async () => {
    clearInterval(interval)
    await pending
  }
}

export function startMaintenance() {
  let pending: Promise<void> | undefined
  const tick = () => {
    if (pending) return
    pending = runMaintenance()
      .catch((error: unknown) => logger.error('maintenance.failed', { error }))
      .finally(() => {
        pending = undefined
      })
  }
  tick()
  const interval = setInterval(tick, 60_000)
  interval.unref()
  return async () => {
    clearInterval(interval)
    await pending
  }
}
