import 'server-only'
import { contextInfoSchema } from '@velin/contracts/context'

import type {
  ConversationHistoryPage,
  ConversationSummary,
  ConversationListPage,
  Message,
  MessageRole,
  MessageStatus,
} from '@velin/contracts/chat'
import { databasePool } from '../database/connection'
import { loadAttachmentsByMessage } from './attachments'
import { pruneUnreferencedPdfCache } from '../maintenance'
import type {
  ChatOrderRequest,
  ChatListRequest,
} from '@velin/contracts/chat-protocol'

const messagePageSize = 50
const staleStreamMinutes = 3

type ConversationRow = {
  id: string
  title: string
  model: string
  created_at: Date
  updated_at: Date
}

type MessageRow = {
  context_metadata: unknown
  model: string | null
  reasoning_effort: string | null
  id: string
  sequence: string
  role: MessageRole
  content: string
  reasoning: string
  status: MessageStatus
  created_at: Date
}

function toSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  }
}

export async function listConversations(
  userId: string,
  request: ChatListRequest = {},
): Promise<ConversationListPage> {
  const result = await databasePool.query<
    ConversationRow & { sort_order: string }
  >(
    `select id, title, model, created_at, updated_at, sort_order::text
     from chat_conversation
     where user_id = $1 and ($2::bigint is null or sort_order < $2)
       and ($3::text is null or position(lower($3) in lower(title)) > 0)
     order by chat_conversation.sort_order desc limit 101`,
    [userId, request.before ?? null, request.search || null],
  )
  const rows = result.rows.slice(0, 100)
  return {
    conversations: rows.map(toSummary),
    nextCursor: result.rows.length > 100 ? rows.at(-1)!.sort_order : null,
  }
}

async function reconcileStaleMessages(conversationId: string) {
  await databasePool.query(
    `update chat_message
     set status = 'failed', updated_at = now()
     where conversation_id = $1 and active and status = 'streaming'
       and updated_at < now() - ($2 || ' minutes')::interval
       and not exists (select 1 from chat_request_usage u where u.request_id = chat_message.request_id and u.status = 'running' and u.created_at > now() - interval '8 minutes')`,
    [conversationId, staleStreamMinutes],
  )
  await databasePool.query(
    `delete from chat_message
     where conversation_id = $1 and active and status = 'failed' and content = '' and reasoning = ''`,
    [conversationId],
  )
}

export async function loadConversation(
  userId: string,
  conversationId: string,
  before?: string,
): Promise<ConversationHistoryPage | null> {
  const accessible = await databasePool.query(
    'select id from chat_conversation where id = $1 and user_id = $2',
    [conversationId, userId],
  )
  if (!accessible.rowCount) return null
  await reconcileStaleMessages(conversationId)

  const client = await databasePool.connect()
  try {
    // 消息、所属版本和附件来自同一快照，不能在多设备编辑时拼出混合版本。
    await client.query('begin isolation level repeatable read read only')
    const conversationResult = await client.query<
      ConversationRow & { context_revision: string }
    >(
      `select id, title, model, created_at, updated_at, context_revision::text
       from chat_conversation where id = $1 and user_id = $2`,
      [conversationId, userId],
    )
    const conversation = conversationResult.rows[0]
    if (!conversation) {
      await client.query('commit')
      return null
    }
    const result = await client.query<MessageRow>(
      `select id, sequence::text as sequence, role, content, reasoning,
              status, created_at, context_metadata, model, reasoning_effort
       from chat_message
       where conversation_id = $1 and active and ($2::bigint is null or sequence < $2)
       order by chat_message.sequence desc limit $3`,
      [conversationId, before ?? null, messagePageSize + 1],
    )
    const hasMore = result.rows.length > messagePageSize
    const rows = result.rows.slice(0, messagePageSize).reverse()
    const attachmentsByMessage = await loadAttachmentsByMessage(
      rows.map((row) => row.id),
      client,
    )
    const messages: Message[] = rows.map((row) => {
      const context = contextInfoSchema.safeParse(row.context_metadata)
      return {
        ...(context.success ? { context: context.data } : {}),
        ...(row.model ? { model: row.model } : {}),
        ...(row.reasoning_effort
          ? { reasoningEffort: row.reasoning_effort }
          : {}),
        id: row.id,
        role: row.role,
        content: row.content,
        reasoning: row.reasoning,
        attachments: attachmentsByMessage.get(row.id) ?? [],
        createdAt: row.created_at.getTime(),
        status: row.status,
      }
    })
    await client.query('commit')
    return {
      revision: conversation.context_revision,
      conversation: toSummary(conversation),
      messages,
      hasMore,
      nextBefore: hasMore && rows[0] ? rows[0].sequence : null,
    }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function deleteConversation(
  userId: string,
  conversationId: string,
) {
  const client = await databasePool.connect()
  try {
    await client.query('begin')
    await client.query('select id from "user" where id = $1 for update', [
      userId,
    ])
    const result = await client.query(
      'delete from chat_conversation where id = $1 and user_id = $2',
      [conversationId, userId],
    )
    await pruneUnreferencedPdfCache(client, userId)
    await client.query('commit')
    return result.rowCount === 1
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function renameConversation(
  userId: string,
  conversationId: string,
  title: string,
) {
  const result = await databasePool.query<{ title: string }>(
    `update chat_conversation
     set title = $3, title_source = 'manual'
     where id = $1 and user_id = $2
     returning title`,
    [conversationId, userId, title],
  )
  return result.rows[0]?.title ?? null
}

export async function reorderConversations(
  userId: string,
  request: ChatOrderRequest,
) {
  const client = await databasePool.connect()

  try {
    await client.query('begin')
    await client.query('select id from "user" where id = $1 for update', [
      userId,
    ])
    const result = await client.query<{ id: string; sort_order: string }>(
      `select id, sort_order::text as sort_order
       from chat_conversation
       where user_id = $1
       order by chat_conversation.sort_order desc
       for update`,
      [userId],
    )
    const sourceIndex = result.rows.findIndex(
      (row) => row.id === request.sourceId,
    )
    const targetIndex = result.rows.findIndex(
      (row) => row.id === request.targetId,
    )
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
      await client.query('rollback')
      return false
    }

    const positions = result.rows.map((row) => row.sort_order)
    const ordered = result.rows.map((row) => row.id)
    ordered.splice(sourceIndex, 1)
    const target =
      ordered.indexOf(request.targetId) +
      (request.placement === 'after' ? 1 : 0)
    ordered.splice(target, 0, request.sourceId)
    const lower = Math.min(sourceIndex, target)
    const upper = Math.max(sourceIndex, target) + 1
    await client.query(
      `update chat_conversation c set sort_order = p.position
      from unnest($1::uuid[], $2::bigint[]) as p(id, position)
      where c.id = p.id and c.user_id = $3`,
      [ordered.slice(lower, upper), positions.slice(lower, upper), userId],
    )
    await client.query('commit')
    return true
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
