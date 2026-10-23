import { boundedDelta, splitChatDelta } from './upstream-chunk'
import 'server-only'

import { createChatEventStream } from './event-stream'
import type { ChatEvent } from '@velin/contracts/chat-protocol'
import { jsonResponse } from '../http/response'
import { APIConnectionError, APIError } from 'openai'
import { UserFacingError } from '@velin/contracts/error-copy'
import type { ResponseInput } from 'openai/resources/responses/responses'
import { createResponsesEventReader } from './responses'
import { prepareConversationContext } from './context'
import { findChatModel } from '@velin/contracts/chat'
import { config } from '../config'
import { databasePool } from '../database/connection'
import { deepseek, providerUserId } from './model'
import { chatRequestSchema } from '@velin/contracts/chat-validation'
import { auth } from '../auth/server'
import { logger } from '../logging'
import {
  finishChatRequest,
  reserveChatRequest,
  type ChatLimitReason,
  type ChatRequestStatus,
} from './usage'
import {
  beginChatTurn,
  ChatConversationAccessError,
  finalizeAssistantMessage,
  persistAssistantSnapshot,
} from './turn'
import { ChatAttachmentAccessError } from './attachments'
import { generateConversationTitle } from './title'

const titleWaitMs = 1_500

async function waitForTitle(promise: Promise<string | null>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), titleWaitMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function limitMessage(reason: ChatLimitReason) {
  switch (reason) {
    case 'duplicate':
      return '这次请求已经处理过，请重新发送。'
    case 'busy':
      return '当前账号正在生成回复，请等待或先停止。'
    case 'minute':
      return '发送过于频繁，请稍后再试。'
    case 'daily':
      return '今天的对话次数已用完，请明天再试。'
    case 'global':
      return '当前服务的今日额度已用完，请明天再试。'
  }
}

function upstreamMessage(error: unknown) {
  if (error instanceof UserFacingError) return error.message
  if (error instanceof APIError) {
    if (error.status === 402) return '模型服务余额不足，请联系管理员。'
    if (error.status === 429) return '模型服务当前繁忙，请稍后再试。'
    if (error.status === 401 || error.status === 403) {
      return '模型服务认证失败，请联系管理员。'
    }
    if (error.status >= 500) return '模型服务暂时不可用，请稍后再试。'
  }

  if (error instanceof APIConnectionError) {
    return '无法连接模型服务，请检查网络后重试。'
  }

  return '生成回复失败，请稍后重试。'
}

export async function streamChat(httpRequest: Request) {
  // 此 API 由持有会话 Cookie 的 Electron Main 调用。
  // 拒绝浏览器 Origin，防止页面消耗服务端模型密钥。
  if (
    httpRequest.headers.get('origin') ||
    httpRequest.headers.get('content-type')?.split(';', 1)[0].trim() !==
      'application/json'
  ) {
    return jsonResponse({ message: '请求来源或格式无效。' }, 403)
  }

  const session = await auth.api.getSession({
    headers: httpRequest.headers,
  })
  if (!session) {
    return jsonResponse({ message: '请先登录后再发送消息。' }, 401)
  }

  const client = deepseek
  if (!client)
    return jsonResponse({ message: '模型服务尚未配置，请联系管理员。' }, 503)
  const payload: unknown = await httpRequest.json().catch(() => null)
  const parsed = chatRequestSchema.safeParse(payload)
  if (!parsed.success)
    return jsonResponse({ message: '消息内容无效或过长。' }, 400)
  const request = parsed.data
  const modelInfo = findChatModel(request.model)
  const supportsReasoning = modelInfo.supportedReasoningEfforts.length > 0
  let limit: ChatLimitReason | null
  try {
    limit = await reserveChatRequest(
      session.user.id,
      request.requestId,
      request.model,
    )
  } catch (error) {
    logger.error('chat.quota_failed', { error })
    return jsonResponse({ message: '暂时无法开始对话，请稍后重试。' }, 503)
  }

  if (limit) {
    return jsonResponse(
      { message: limitMessage(limit) },
      limit === 'duplicate' || limit === 'busy' ? 409 : 429,
    )
  }

  let turn: Awaited<ReturnType<typeof beginChatTurn>>
  try {
    turn = await beginChatTurn({
      userId: session.user.id,
      conversationId: request.conversationId,
      userMessageId: request.userMessageId,
      requestId: request.requestId,
      content: request.content,
      model: request.model,
      attachmentIds: request.attachmentIds,
      reasoningEffort: request.reasoningEffort,
    })
  } catch (error) {
    await finishChatRequest(request.requestId, 'failed').catch(
      (cause: unknown) => {
        logger.error('chat.usage_failed', { error: cause })
      },
    )

    if (error instanceof ChatConversationAccessError) {
      return jsonResponse({ message: '对话不存在或无权访问。' }, 404)
    }

    if (error instanceof ChatAttachmentAccessError) {
      return jsonResponse({ message: error.message }, 400)
    }

    logger.error('chat.turn_failed', { error })
    return jsonResponse({ message: '暂时无法保存对话，请稍后重试。' }, 503)
  }
  const { assistantMessageId, titleContent } = turn
  const stream = createChatEventStream(httpRequest.signal)
  const titlePromise = titleContent
    ? generateConversationTitle({
        requestId: request.requestId,
        userId: session.user.id,
        conversationId: request.conversationId,
        content: titleContent,
        signal: stream.signal,
      })
    : null

  const generate = async () => {
    const startedAt = performance.now()
    let content = ''
    let reasoningContent = ''
    let status: ChatRequestStatus = 'failed'
    let inputTokens: number | undefined
    let outputTokens: number | undefined
    let terminalEvent: ChatEvent | undefined
    let incomplete = true
    let outputLimited = false
    let memoryUpdated = false
    const firstOutputs = new Set<'reasoning' | 'content'>()
    let flushChain: Promise<void> | undefined
    let queuedSnapshot: { content: string; reasoning: string } | undefined
    let lastFlushAt = Date.now()
    let lastFlushContentLength = 0
    let lastFlushReasoningLength = 0

    const schedulePersist = () => {
      if (
        content.length === lastFlushContentLength &&
        reasoningContent.length === lastFlushReasoningLength
      ) {
        return
      }
      lastFlushAt = Date.now()
      lastFlushContentLength = content.length
      lastFlushReasoningLength = reasoningContent.length
      queuedSnapshot = { content, reasoning: reasoningContent }
      if (flushChain) return
      // 慢数据库只保留最新快照，不为每个流式 tick 累积写入和字符串副本。
      const flush = async () => {
        while (queuedSnapshot) {
          const snapshot = queuedSnapshot
          queuedSnapshot = undefined
          await persistAssistantSnapshot(
            request.conversationId,
            assistantMessageId,
            snapshot.content,
            snapshot.reasoning,
          ).catch((error: unknown) =>
            logger.error('chat.persistence_failed', { error }),
          )
        }
      }
      flushChain = flush().finally(() => {
        flushChain = undefined
      })
    }

    try {
      await stream.write({
        type: 'message-start',
        requestId: request.requestId,
        conversationId: request.conversationId,
        messageId: assistantMessageId,
      })

      const prepared = await prepareConversationContext({
        conversationId: request.conversationId,
        userId: session.user.id,
        userMessageId: request.userMessageId,
        assistantMessageId,
        requestId: request.requestId,
        model: request.model,
        timeZone: request.timeZone,
        onMemoryUpdated: () => {
          memoryUpdated = true
        },
        signal: stream.signal,
      })
      await stream.write({
        type: 'context-ready',
        requestId: request.requestId,
        conversationId: request.conversationId,
        messageId: assistantMessageId,
        context: prepared.metadata,
        model: request.model,
        reasoningEffort: request.reasoningEffort,
      })
      const providerMessages: ResponseInput = prepared.messages.map(
        (message) =>
          message.images?.length && message.role === 'user'
            ? {
                role: 'user',
                content: [
                  { type: 'input_text', text: message.content },
                  ...message.images.map((image_url) => ({
                    type: 'input_image' as const,
                    image_url,
                    detail: 'auto' as const,
                  })),
                ],
              }
            : { role: message.role, content: message.content },
      )
      const response = await client.responses.create(
        {
          model: request.model,
          user: providerUserId(session.user.id),
          input: providerMessages,
          stream: true,
          store: false,
          ...(supportsReasoning
            ? { reasoning: { effort: request.reasoningEffort } }
            : {}),
          max_output_tokens: Math.min(
            config.chat.maxOutputTokens,
            { none: 16_384, low: 32_768, high: 65_536, max: 131_072 }[
              request.reasoningEffort
            ],
          ),
        },
        { signal: stream.signal },
      )
      const events = createResponsesEventReader()
      for await (const chunk of response) {
        const event = events.read(chunk)
        if (event.kind === 'terminal') {
          incomplete = event.incomplete
          if (event.usage) {
            inputTokens = event.usage.input_tokens
            outputTokens = event.usage.output_tokens
          }
          await databasePool.query(
            "update chat_message set model = coalesce($2, model), reasoning_effort = $3 where id = $1 and active and status = 'streaming'",
            [assistantMessageId, event.model ?? null, request.reasoningEffort],
          )
          break
        }
        if (event.kind === 'ignore') continue
        const delta = {
          content: event.kind === 'content' ? event.delta : '',
          reasoning: event.kind === 'reasoning' ? event.delta : '',
        }
        for (const kind of ['reasoning', 'content'] as const) {
          if (stream.signal.aborted) break
          const current = kind === 'content' ? content : reasoningContent
          const next = boundedDelta(delta[kind], current.length)
          if (kind === 'content') content += next.text
          else reasoningContent += next.text
          outputLimited ||= next.limited
          for (const part of splitChatDelta(next.text)) {
            await stream.write({
              type: kind === 'content' ? 'text-delta' : 'reasoning-delta',
              requestId: request.requestId,
              conversationId: request.conversationId,
              messageId: assistantMessageId,
              delta: part,
            })
            if (!stream.signal.aborted && !firstOutputs.has(kind)) {
              firstOutputs.add(kind)
              logger.info('chat.first_output', {
                generationId: request.requestId,
                model: request.model,
                purpose: kind,
                durationMs: Math.round(performance.now() - startedAt),
              })
            }
          }
        }
        if (Date.now() - lastFlushAt >= 1_000) schedulePersist()
        if (outputLimited) {
          incomplete = true
          break
        }
      }

      if (!stream.signal.aborted && !outputLimited && !events.terminal)
        throw new Error('Responses stream ended before a terminal event.')
      if (stream.signal.aborted) {
        if (stream.signal.reason !== 'client-disconnected')
          throw new Error('Generation deadline exceeded.')
        status = 'cancelled'
      } else if (!content.trim()) {
        status = 'failed'
        terminalEvent = {
          type: 'error',
          requestId: request.requestId,
          conversationId: request.conversationId,
          messageId: assistantMessageId,
          message: outputLimited
            ? '推理内容已达到长度上限，尚未生成正文，请降低推理强度后重试。'
            : '模型没有返回内容，请重试。',
        }
      } else {
        status = incomplete ? 'incomplete' : 'completed'
        const title = titlePromise ? await waitForTitle(titlePromise) : null
        terminalEvent = {
          type: 'message-complete',
          requestId: request.requestId,
          conversationId: request.conversationId,
          messageId: assistantMessageId,
          ...(title ? { title } : {}),
          ...(incomplete ? { incomplete: true } : {}),
        }
      }
    } catch (error) {
      status =
        stream.signal.reason === 'client-disconnected' ? 'cancelled' : 'failed'

      if (status !== 'cancelled') {
        logger.error('chat.upstream_failed', {
          error,
          generationId: request.requestId,
          model: request.model,
        })
        terminalEvent = {
          type: 'error',
          requestId: request.requestId,
          conversationId: request.conversationId,
          messageId: assistantMessageId,
          message:
            stream.signal.reason === 'timeout'
              ? '生成超时，请重试。'
              : upstreamMessage(error),
        }
      }
    } finally {
      await flushChain
      try {
        // 正文终态与使用记录原子提交后，客户端才能获知完成并发送下一轮。
        await finalizeAssistantMessage({
          conversationId: request.conversationId,
          messageId: assistantMessageId,
          requestId: request.requestId,
          content,
          reasoning: reasoningContent,
          status,
          inputTokens,
          outputTokens,
        })
      } catch (error) {
        status = 'failed'
        logger.error('chat.persistence_failed', { error })
        terminalEvent = {
          type: 'error',
          requestId: request.requestId,
          conversationId: request.conversationId,
          messageId: assistantMessageId,
          message: '回复保存失败，请重新读取对话后重试。',
        }
        await finishChatRequest(request.requestId, 'failed').catch(
          (cause: unknown) => {
            logger.error('chat.usage_failed', { error: cause })
          },
        )
      }
      if (terminalEvent?.type === 'error' && memoryUpdated)
        terminalEvent = {
          ...terminalEvent,
          message:
            `记忆已更新，但本轮回复未完成。${terminalEvent.message}`.slice(
              0,
              200,
            ),
        }
      if (terminalEvent) await stream.write(terminalEvent).catch(() => {})
      await stream.close()
      logger.info('chat.generation_finished', {
        generationId: request.requestId,
        model: request.model,
        outcome: status,
        durationMs: Math.round(performance.now() - startedAt),
        inputTokens: inputTokens ?? null,
        outputTokens: outputTokens ?? null,
      })
    }
  }
  void generate().catch((error: unknown) =>
    logger.error('chat.persistence_failed', { error }),
  )
  return stream.response
}
