import 'server-only'
import type { PoolClient } from 'pg'
import type { ConversationVersion } from '@velin/contracts/memory'
import { UserFacingError } from '@velin/contracts/error-copy'
import { databasePool } from '../database/connection'

export async function invalidateConversationContext(
  client: PoolClient,
  conversationId: string,
  sequence: string,
) {
  await client.query(
    'update chat_conversation set context_revision = context_revision + 1 where id = $1',
    [conversationId],
  )
  await client.query(
    'delete from chat_context_summary where conversation_id = $1',
    [conversationId],
  )
  await client.query(
    `delete from chat_memory where source_message_id in (select id from chat_message where conversation_id = $1 and sequence >= $2)`,
    [conversationId, sequence],
  )
}

export async function archiveConversationTail(
  client: PoolClient,
  conversationId: string,
  anchorId: string,
  sequence: string,
) {
  const branchId = crypto.randomUUID()
  await client.query(
    `insert into chat_branch(id, conversation_id, anchor_id, anchor_content, title)
    select $3, c.id, m.id, m.content, c.title
    from chat_conversation c join chat_message m on m.id = $2 and m.conversation_id = c.id where c.id = $1`,
    [conversationId, anchorId, branchId],
  )
  // 保存完整路径的不可变快照，反复编辑和跨分支恢复不会改写旧版本。
  await client.query(
    `insert into chat_branch_message(branch_id,message_id,content,reasoning,status,context_metadata,model,reasoning_effort,recall_dependencies,message_updated_at)
    select $2,id,content,reasoning,status,context_metadata,model,reasoning_effort,recall_dependencies,updated_at from chat_message where conversation_id = $1 and active`,
    [conversationId, branchId],
  )
  await invalidateConversationContext(client, conversationId, sequence)
  await client.query(
    'update chat_message set active = false where conversation_id = $1 and sequence > $2 and active',
    [conversationId, sequence],
  )
}

export async function listConversationVersions(
  userId: string,
  conversationId: string,
): Promise<ConversationVersion[] | null> {
  const owner = await databasePool.query(
    'select 1 from chat_conversation where id = $1 and user_id = $2',
    [conversationId, userId],
  )
  if (!owner.rowCount) return null
  const result = await databasePool.query<{
    id: string
    created_at: Date
    anchor_content: string
    count: number
  }>(
    `select b.id, b.created_at, left(b.anchor_content, 200) as anchor_content, (select count(*)::int from chat_branch_message where branch_id = b.id) as count
    from chat_branch b join chat_conversation c on c.id = b.conversation_id where c.id = $1 and c.user_id = $2 order by b.created_at desc limit 50`,
    [conversationId, userId],
  )
  return result.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at.getTime(),
    preview: row.anchor_content,
    messageCount: row.count,
  }))
}

export async function restoreConversationVersion(
  userId: string,
  conversationId: string,
  versionId: string,
) {
  const client = await databasePool.connect()
  try {
    await client.query('begin')
    await client.query('select id from "user" where id = $1 for update', [
      userId,
    ])
    const conversation = await client.query(
      'select id from chat_conversation where id = $1 and user_id = $2 for update',
      [conversationId, userId],
    )
    if (!conversation.rowCount)
      throw new UserFacingError('对话不存在或无权访问。')
    const busy = await client.query(
      `select 1 from chat_request_usage where user_id = $1 and status = 'running' and created_at > now() - interval '8 minutes'`,
      [userId],
    )
    if (busy.rowCount)
      throw new UserFacingError('请先停止当前回复，再恢复历史版本。')
    const result = await client.query<{
      anchor_id: string
      title: string
      sequence: string
    }>(
      `select b.*, m.sequence::text from chat_branch b join chat_message m on m.id = b.anchor_id where b.id = $1 and b.conversation_id = $2`,
      [versionId, conversationId],
    )
    const branch = result.rows[0]
    if (!branch) throw new UserFacingError('历史版本不存在。')
    await archiveConversationTail(
      client,
      conversationId,
      branch.anchor_id,
      branch.sequence,
    )
    await client.query(
      'update chat_message set active = false where conversation_id = $1 and active',
      [conversationId],
    )
    await client.query(
      `update chat_message m set content = s.content, reasoning = s.reasoning, status = s.status,
      context_metadata = s.context_metadata, model = s.model, reasoning_effort = s.reasoning_effort, recall_dependencies = s.recall_dependencies, active = true, updated_at = s.message_updated_at
      from chat_branch_message s where s.branch_id = $1 and s.message_id = m.id and m.conversation_id = $2`,
      [versionId, conversationId],
    )
    await client.query(
      'delete from chat_memory where source_conversation_id = $1',
      [conversationId],
    )
    await client.query(
      `update chat_conversation set title = case when title_source = 'manual' then title else $2 end, updated_at = now() where id = $1`,
      [conversationId, branch.title],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
