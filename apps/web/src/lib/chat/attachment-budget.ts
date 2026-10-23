import 'server-only'
import type { PoolClient } from 'pg'

// 调用方先锁用户行；容量和计数一同提交，拒绝的请求不占用解析进程。
export async function consumeAttachmentBudget(
  client: PoolClient,
  userId: string,
) {
  const result = await client.query(
    `insert into attachment_rate_budget (user_id) values ($1)
     on conflict (user_id) do update set
       attempts = case when attachment_rate_budget.window_start <= now() - interval '1 hour'
         then 1 else attachment_rate_budget.attempts + 1 end,
       window_start = case when attachment_rate_budget.window_start <= now() - interval '1 hour'
         then now() else attachment_rate_budget.window_start end
     where attachment_rate_budget.attempts < 60
       or attachment_rate_budget.window_start <= now() - interval '1 hour'
     returning user_id`,
    [userId],
  )
  return result.rowCount === 1
}
