import 'server-only'

import { conversationTitle, findChatModel } from '@velin/contracts/chat'
import type { ChatModelId, ReasoningEffortId } from '@velin/contracts/chat'
import { databasePool } from '../database/connection'
import { bindAttachments, ChatAttachmentAccessError } from './attachments'
import { archiveConversationTail } from './versions'
import { enqueueContextJob } from './context-jobs'
import { getOcrQueue } from '../ocr/queue'

export class ChatConversationAccessError extends Error {}

export type BeginChatTurnInput = {
  userId: string
  conversationId: string
  userMessageId: string
  requestId: string
  content: string
  model: ChatModelId
  reasoningEffort?: ReasoningEffortId
  attachmentIds?: string[]
}

export type BeginChatTurnResult = {
  assistantMessageId: string
  titleContent: string | null
}

export async function beginChatTurn(
  input: BeginChatTurnInput,
): Promise<BeginChatTurnResult> {
  const client = await databasePool.connect()

  try {
    await client.query('begin')
    await client.query('select id from "user" where id = $1 for update', [
      input.userId,
    ])

    const inserted = await client.query<{
      user_id: string
      title_source: string
    }>(
      `insert into chat_conversation (id, user_id, title, model)
       values ($1, $2, $3, $4)
       on conflict (id) do nothing
       returning user_id, title_source`,
      [
        input.conversationId,
        input.userId,
        conversationTitle(input.content),
        input.model,
      ],
    )
    let ownerId = inserted.rows[0]?.user_id
    let titleSource = inserted.rows[0]?.title_source

    if (!ownerId) {
      const existing = await client.query<{
        user_id: string
        title_source: string
      }>('select user_id, title_source from chat_conversation where id = $1', [
        input.conversationId,
      ])
      ownerId = existing.rows[0]?.user_id
      titleSource = existing.rows[0]?.title_source
    }

    if (ownerId !== input.userId) {
      throw new ChatConversationAccessError('Conversation is not accessible.')
    }

    await client.query(
      'update chat_conversation set model = $2 where id = $1',
      [input.conversationId, input.model],
    )

    const existingMessage = await client.query<{
      conversation_id: string
      role: string
      sequence: string
      content: string
      active: boolean
    }>(
      `select conversation_id, role, sequence::text as sequence, content, active
       from chat_message where id = $1`,
      [input.userMessageId],
    )
    let userSequence: string
    let contentChanged = true

    if (existingMessage.rowCount) {
      const message = existingMessage.rows[0]
      if (
        message.conversation_id !== input.conversationId ||
        message.role !== 'user' ||
        !message.active
      ) {
        throw new ChatConversationAccessError(
          'Conversation message is not accessible.',
        )
      }

      const changedAttachments = await client.query(
        'select 1 from chat_attachment where id = any($1::uuid[]) and message_id is distinct from $2 limit 1',
        [input.attachmentIds ?? [], input.userMessageId],
      )
      if (changedAttachments.rowCount)
        throw new ChatAttachmentAccessError(
          '编辑消息时保留原附件；新的附件请通过新消息发送。',
        )

      await archiveConversationTail(
        client,
        input.conversationId,
        input.userMessageId,
        message.sequence,
      )
      contentChanged = message.content !== input.content
      if (contentChanged) {
        await client.query(
          'update chat_message set content = $2, updated_at = now() where id = $1',
          [input.userMessageId, input.content],
        )
      }
      userSequence = message.sequence
    } else {
      const created = await client.query<{ sequence: string }>(
        `insert into chat_message
           (id, conversation_id, role, content, status)
         values ($1, $2, 'user', $3, 'completed')
         returning sequence::text as sequence`,
        [input.userMessageId, input.conversationId, input.content],
      )
      userSequence = created.rows[0].sequence
    }

    await bindAttachments(
      client,
      input.userId,
      input.userMessageId,
      input.attachmentIds ?? [],
      findChatModel(input.model).supportsImages,
      input.conversationId,
    )

    const firstMessage = await client.query<{
      sequence: string
      role: string
      content: string
    }>(
      `select sequence::text as sequence, role, content from chat_message
       where conversation_id = $1 and active order by chat_message.sequence asc limit 1`,
      [input.conversationId],
    )
    const first = firstMessage.rows[0]

    if (
      first?.sequence === userSequence &&
      titleSource !== 'manual' &&
      contentChanged
    ) {
      await client.query(
        `update chat_conversation
         set title = $2, title_source = 'auto'
         where id = $1`,
        [input.conversationId, conversationTitle(input.content)],
      )
      titleSource = 'auto'
    }

    const titleContent =
      titleSource === 'auto' && first?.role === 'user' ? first.content : null

    const assistantMessageId = crypto.randomUUID()
    await client.query(
      `insert into chat_message
         (id, conversation_id, role, content, status, request_id, model, reasoning_effort)
       values ($1, $2, 'assistant', '', 'streaming', $3, $4, $5)`,
      [
        assistantMessageId,
        input.conversationId,
        input.requestId,
        input.model,
        input.reasoningEffort ?? 'none',
      ],
    )
    await client.query(
      'update chat_conversation set updated_at = now() where id = $1',
      [input.conversationId],
    )
    await client.query('commit')
    return { assistantMessageId, titleContent }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function persistAssistantSnapshot(
  conversationId: string,
  messageId: string,
  content: string,
  reasoning: string,
) {
  await databasePool.query(
    `update chat_message
     set content = $3, reasoning = $4, updated_at = now()
     where conversation_id = $1 and id = $2 and active and status = 'streaming'`,
    [conversationId, messageId, content, reasoning],
  )
}

export async function finalizeAssistantMessage(input: {
  conversationId: string
  messageId: string
  content: string
  reasoning: string
  status: 'completed' | 'incomplete' | 'failed' | 'cancelled'
  requestId?: string
  inputTokens?: number
  outputTokens?: number
}) {
  // 队列初始化在事务外，任务与回复终态随后原子提交。
  await getOcrQueue()
  const client = await databasePool.connect()

  try {
    await client.query('begin')
    // 与编辑和级联删除采用相同锁顺序，避免回复行与对话行互相等待。
    await client.query(
      'select id from chat_conversation where id = $1 for update',
      [input.conversationId],
    )
    const message = await client.query<{
      request_id: string | null
      active: boolean
      status: string
    }>(
      'select request_id, active, status from chat_message where conversation_id = $1 and id = $2 for update',
      [input.conversationId, input.messageId],
    )
    const requestId = input.requestId ?? message.rows[0]?.request_id
    if (!message.rowCount && input.status !== 'cancelled') {
      throw new ChatConversationAccessError(
        'Conversation message is no longer available.',
      )
    }
    const current = message.rows[0]
    if (
      current &&
      (!current.active ||
        current.status !== 'streaming' ||
        (input.requestId !== undefined &&
          input.requestId !== current.request_id))
    ) {
      throw new ChatConversationAccessError(
        'Generation no longer owns the message.',
      )
    }
    if (!input.content && !input.reasoning) {
      await client.query(
        `delete from chat_message
         where conversation_id = $1 and id = $2 and status = 'streaming'`,
        [input.conversationId, input.messageId],
      )
    } else {
      await client.query(
        `update chat_message
         set content = $3, reasoning = $4, status = $5,
             input_tokens = $6, output_tokens = $7, updated_at = now()
         where conversation_id = $1 and id = $2`,
        [
          input.conversationId,
          input.messageId,
          input.content,
          input.reasoning,
          input.status,
          input.inputTokens ?? null,
          input.outputTokens ?? null,
        ],
      )
    }
    await client.query(
      'update chat_conversation set updated_at = now() where id = $1',
      [input.conversationId],
    )
    if (requestId) {
      await client.query(
        `update chat_request_usage
         set status = $2, input_tokens = $3, output_tokens = $4, finished_at = now()
         where request_id = $1 and status = 'running'`,
        [
          requestId,
          input.status,
          input.inputTokens ?? null,
          input.outputTokens ?? null,
        ],
      )
    }
    if (input.status === 'completed' || input.status === 'incomplete')
      await enqueueContextJob(client, input.conversationId, input.messageId)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
