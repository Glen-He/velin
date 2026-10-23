import 'server-only'
import { z } from 'zod'
import { databasePool } from '../database/connection'
import type { MemoryEntry } from '@velin/contracts/memory'
import type { RecallCandidate } from './recall-policy'
import type { PoolClient } from 'pg'

const dependenciesSchema = z
  .object({
    complete: z.boolean(),
    messages: z.array(
      z.object({ id: z.uuid(), revision: z.string().regex(/^\d+$/) }).strict(),
    ),
    memories: z.array(
      z.object({ id: z.uuid(), version: z.number().int().positive() }).strict(),
    ),
  })
  .strict()

export async function collectRecallDependencies(
  conversationId: string,
  before: string,
  evidence: RecallCandidate[],
  remembered: MemoryEntry[],
  database: Pick<PoolClient, 'query'> = databasePool,
) {
  const rows = await database.query<{ recall_dependencies: unknown }>(
    `(select recall_dependencies from chat_message where active and role = 'assistant'
      and conversation_id = $1 and sequence < $2::bigint order by sequence desc limit 1)
     union all select recall_dependencies from chat_message where active and role = 'assistant' and id = any($3::uuid[])`,
    [conversationId, before, evidence.map((candidate) => candidate.messageId)],
  )
  const messages = new Map(
    evidence.map((candidate) => [
      `${candidate.messageId}:${candidate.revision}`,
      { id: candidate.messageId, revision: candidate.revision },
    ]),
  )
  const memories = new Map(
    remembered.map((entry) => [
      `${entry.id}:${entry.version}`,
      { id: entry.id, version: entry.version },
    ]),
  )
  let complete = true
  for (const row of rows.rows) {
    const parsed = dependenciesSchema.safeParse(row.recall_dependencies)
    if (!parsed.success) {
      complete = false
      continue
    }
    complete &&= parsed.data.complete
    for (const source of parsed.data.messages)
      if (messages.size <= 1024)
        messages.set(`${source.id}:${source.revision}`, source)
    for (const memory of parsed.data.memories)
      if (memories.size <= 1024)
        memories.set(`${memory.id}:${memory.version}`, memory)
  }
  // 依赖超限时停用该派生回复的跨对话检索，不能截断来源后假装仍能可靠遗忘。
  complete &&= messages.size <= 1024 && memories.size <= 1024
  return {
    complete,
    messages: [...messages.values()].slice(0, 1024),
    memories: [...memories.values()].slice(0, 1024),
  }
}
