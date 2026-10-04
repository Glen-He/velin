import type { Pool } from 'pg'

type Scope = 'send' | 'verify' | 'passkey-options'
const rules = {
  send: { max: 3, windowMs: 60_000 },
  verify: { max: 5, windowMs: 60_000 },
  'passkey-options': { max: 5, windowMs: 60_000 },
} as const

// 一次原子 upsert 在标签页、会话与进程之间累计尝试。
// 复用认证库的数据库计数器存储，以独立命名空间隔离。
export function createVerificationLimiter(database: Pick<Pool, 'query'>) {
  return {
    async attempt(userId: string, scope: Scope) {
      const rule = rules[scope]
      const now = Date.now()
      const result = await database.query<{
        count: number
        lastRequest: string
      }>(
        `insert into "rateLimit" (id, key, count, "lastRequest") values ($1, $2, 1, $3)
         on conflict (key) do update set
           count = case when "rateLimit"."lastRequest" <= $4 then 1 else "rateLimit".count + 1 end,
           "lastRequest" = case when "rateLimit"."lastRequest" <= $4 then $3 else "rateLimit"."lastRequest" end
         returning count, "lastRequest"`,
        [
          crypto.randomUUID(),
          `velin:security:${scope}:${userId}`,
          now,
          now - rule.windowMs,
        ],
      )
      const row = result.rows[0]
      return {
        allowed: row.count <= rule.max,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((Number(row.lastRequest) + rule.windowMs - now) / 1000),
        ),
      }
    },
  }
}
