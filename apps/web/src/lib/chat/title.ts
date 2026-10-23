import 'server-only'

import { normalizeGeneratedTitle } from '@velin/contracts/chat'
import { truncateText } from '@velin/contracts/policy'
import { databasePool } from '../database/connection'
import { logger } from '../logging'
import { chatModel, deepseek } from './model'
import { auxiliaryResponse } from './auxiliary-response'

const titleInputCharacterLimit = 2_000

export async function saveGeneratedTitle(input: {
  userId: string
  conversationId: string
  title: string
  requestId: string
}) {
  const result = await databasePool.query<{ title: string }>(
    `update chat_conversation
     set title = $3, title_source = 'generated'
     where id = $1 and user_id = $2 and title_source = 'auto'
       and exists (select 1 from chat_message where conversation_id = $1 and active and request_id = $4)
     returning title`,
    [input.conversationId, input.userId, input.title, input.requestId],
  )
  return result.rows[0]?.title ?? null
}

export async function generateConversationTitle(input: {
  requestId: string
  userId: string
  conversationId: string
  content: string
  signal?: AbortSignal
}): Promise<string | null> {
  if (!deepseek) return null

  try {
    await databasePool.query(
      `update chat_request_usage set title_model = $2, title_status = 'running' where request_id = $1`,
      [input.requestId, chatModel],
    )
    const response = await auxiliaryResponse({
      instructions:
        '根据用户的第一条消息生成具体简洁的对话标题，使用相同语言。只输出标题，不要前缀、引号或句末标点；中文不超过16字，英文不超过8个单词。',
      input: truncateText(input.content, titleInputCharacterLimit),
      maxOutputTokens: 48,
      userId: input.userId,
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    })
    await databasePool.query(
      `update chat_request_usage set title_status = 'completed',
      title_input_tokens = $2, title_output_tokens = $3 where request_id = $1`,
      [
        input.requestId,
        response.usage?.input_tokens ?? null,
        response.usage?.output_tokens ?? null,
      ],
    )
    const title = normalizeGeneratedTitle(response.text)
    if (!title || input.signal?.aborted) return null
    return await saveGeneratedTitle({
      userId: input.userId,
      conversationId: input.conversationId,
      title,
      requestId: input.requestId,
    })
  } catch (error) {
    logger.error('chat.title_failed', { error })
    await databasePool
      .query(
        `update chat_request_usage set title_status = 'failed' where request_id = $1`,
        [input.requestId],
      )
      .catch((cause: unknown) =>
        logger.error('chat.usage_failed', { error: cause }),
      )
    return null
  }
}
