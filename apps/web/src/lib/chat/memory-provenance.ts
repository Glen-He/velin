import 'server-only'
import type { PoolClient } from 'pg'

export async function excludeMemoryEvidence(
  client: PoolClient,
  userId: string,
  topic: string,
  through: string | null = null,
) {
  await client.query(
    `insert into chat_recall_exclusion(user_id,source_message_id)
     select e.user_id,e.source_message_id from chat_memory_evidence e join chat_message m on m.id = e.source_message_id
     where e.user_id = $1 and e.topic = $2 and ($3::timestamptz is null or greatest(m.created_at,m.updated_at) <= $3)
     on conflict do nothing`,
    [userId, topic, through],
  )
  await client.query(
    'delete from chat_memory_evidence e using chat_message m where e.source_message_id = m.id and e.user_id = $1 and e.topic = $2 and ($3::timestamptz is null or greatest(m.created_at,m.updated_at) <= $3)',
    [userId, topic, through],
  )
}
