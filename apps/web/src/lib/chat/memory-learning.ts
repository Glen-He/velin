import 'server-only'
import { z } from 'zod'
import { databasePool } from '../database/connection'
import { auxiliaryResponse } from './auxiliary-response'
import { readMemory } from './memory'
import { excludeMemoryEvidence } from './memory-provenance'
import { isValidStorageText } from '@velin/contracts/policy'

const extractionSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            topic: z.string().trim().min(1).max(100).refine(isValidStorageText),
            quote: z
              .string()
              .trim()
              .min(3)
              .max(1000)
              .refine(isValidStorageText),
            action: z.enum(['remember', 'forget']),
          })
          .strict(),
      )
      .max(8),
  })
  .strict()
const sensitive =
  /密码|密钥|令牌|身份证|银行卡|病历|诊断|家庭住址|手机号码|手机号|电话|邮箱|护照|银行账户|病史|性取向|宗教|政治倾向|薪资|工资|收入|password|secret|phone|email|address|medical|salary|api.?key|\b\d{11,19}\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\bsk-[a-z0-9-]+/iu

export async function learnMemory(input: {
  conversationId: string
  sourceMessageId: string
  revision: string
  requestId?: string
  signal: AbortSignal
}) {
  const source = await databasePool.query<{
    user_id: string
    content: string
    created_at: string
    epoch: string
    enabled: boolean
  }>(
    `select c.user_id, m.content, greatest(m.created_at,m.updated_at)::text as created_at, coalesce(p.epoch,1)::text as epoch, coalesce(p.enabled,true) as enabled
    from chat_message m join chat_conversation c on c.id = m.conversation_id left join chat_memory_preference p on p.user_id = c.user_id
    where m.id = $1 and m.conversation_id = $2 and m.active and m.role = 'user' and c.context_revision = $3 and greatest(m.created_at,m.updated_at) > coalesce(p.forget_before, '-infinity')`,
    [input.sourceMessageId, input.conversationId, input.revision],
  )
  const user = source.rows[0]
  if (!user?.enabled) return { enabled: false, remembered: 0, forgotten: 0 }
  const memory = await readMemory(user.user_id)
  const response = await auxiliaryResponse({
    instructions:
      '提取用户明确表达的、以后对话也适用的个人表达偏好或明确要求记住的稳定信息。输出JSON {"entries":[{"topic":"稳定主题名","quote":"用户原文中的连续原句","action":"remember或forget"}]}。没有就返回空数组。不得从助手回答、引用文档、假设、角色扮演、待改写文本、第三方或项目临时需求提取个人记忆；不保存敏感身份、健康、财务或凭据。更正时复用已有主题名。用户明确要求忘记某主题时用forget；quote必须逐字来自当前用户消息。最多8条。',
    input: JSON.stringify({
      existingTopics: memory.entries.map((entry) => entry.topic),
      userMessage: user.content,
    }),
    outputSchema: extractionSchema,
    maxOutputTokens: 2048,
    requestId: input.requestId,
    userId: user.user_id,
    signal: AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]),
  })
  const parsed = extractionSchema.parse(JSON.parse(response.text))
  const candidates = parsed.entries.filter(
    (entry) =>
      user.content.includes(entry.quote) &&
      (entry.action === 'forget' || !sensitive.test(entry.quote)),
  )
  if (!candidates.length) return { enabled: true, remembered: 0, forgotten: 0 }
  input.signal.throwIfAborted()
  let remembered = 0
  let forgotten = 0
  const client = await databasePool.connect()
  try {
    await client.query('begin')
    await client.query('select id from "user" where id = $1 for update', [
      user.user_id,
    ])
    await client.query(
      'insert into chat_memory_preference(user_id) values ($1) on conflict do nothing',
      [user.user_id],
    )
    const current = await client.query(
      `select 1 from chat_memory_preference p join chat_conversation c on c.user_id = p.user_id join chat_message m on m.id = $4
      where p.user_id = $1 and p.enabled and p.epoch = $2 and c.id = $3 and c.context_revision = $5 and m.active and m.content = $6 and greatest(m.created_at,m.updated_at) > p.forget_before`,
      [
        user.user_id,
        user.epoch,
        input.conversationId,
        input.sourceMessageId,
        input.revision,
        user.content,
      ],
    )
    if (!current.rowCount) {
      await client.query('rollback')
      return { enabled: true, remembered: 0, forgotten: 0 }
    }
    for (const candidate of candidates) {
      const suppressed = await client.query(
        'select 1 from chat_memory_topic_tombstone where user_id = $1 and topic = $2 and forget_before >= $3',
        [user.user_id, candidate.topic, user.created_at],
      )
      if (suppressed.rowCount) continue
      if (candidate.action === 'forget') {
        await excludeMemoryEvidence(
          client,
          user.user_id,
          candidate.topic,
          user.created_at,
        )
        await client.query(
          'insert into chat_recall_exclusion values($1,$2) on conflict do nothing',
          [user.user_id, input.sourceMessageId],
        )
        await client.query(
          'update chat_memory_preference set epoch = epoch + 1 where user_id = $1',
          [user.user_id],
        )
        const removed = await client.query(
          `delete from chat_memory where user_id = $1 and topic = $2 and case when origin = 'manual' then updated_at else (select greatest(created_at,updated_at) from chat_message where id = source_message_id) end <= $3`,
          [user.user_id, candidate.topic, user.created_at],
        )
        forgotten += removed.rowCount ?? 0
        await client.query(
          'insert into chat_memory_topic_tombstone values ($1,$2,$3) on conflict(user_id,topic) do update set forget_before = greatest(chat_memory_topic_tombstone.forget_before,excluded.forget_before)',
          [user.user_id, candidate.topic, user.created_at],
        )
      } else {
        const saved = await client.query(
          `insert into chat_memory(id,user_id,topic,content,source_message_id,source_conversation_id,source_quote,origin)
          select $1,$2,$3,$4,$5,$6,$4,'automatic' where (select count(*) from chat_memory where user_id = $2) < 200 or exists(select 1 from chat_memory where user_id = $2 and topic = $3)
          on conflict(user_id,topic) do update set content = excluded.content, source_message_id = excluded.source_message_id, source_conversation_id = excluded.source_conversation_id, source_quote = excluded.source_quote, version = chat_memory.version + 1, updated_at = now()
          where chat_memory.origin = 'automatic' and (chat_memory.source_message_id is distinct from excluded.source_message_id or chat_memory.content <> excluded.content) and coalesce((select greatest(created_at,updated_at) from chat_message where id = chat_memory.source_message_id), '-infinity') <= $7`,
          [
            crypto.randomUUID(),
            user.user_id,
            candidate.topic,
            candidate.quote,
            input.sourceMessageId,
            input.conversationId,
            user.created_at,
          ],
        )
        if (saved.rowCount) {
          remembered += saved.rowCount
          await client.query(
            'insert into chat_memory_evidence(user_id,topic,source_message_id) values($1,$2,$3) on conflict do nothing',
            [user.user_id, candidate.topic, input.sourceMessageId],
          )
        }
      }
    }
    input.signal.throwIfAborted()
    await client.query('commit')
    return { enabled: true, remembered, forgotten }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
