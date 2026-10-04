import 'server-only'

import { createChatEventStream } from './event-stream'
import { jsonResponse } from '../http/response'
import OpenAI, { APIConnectionError, APIError } from 'openai'
import { chatRequestSchema } from '@velin/contracts/chat-validation'
import { auth } from '../auth/server'
import { config } from '../config'
import { logger } from '../logging'
import {
  finishChatRequest,
  reserveChatRequest,
  type ChatLimitReason,
  type ChatRequestStatus,
} from './usage'

const deepseek = config.chat.deepseekApiKey
  ? new OpenAI({
      apiKey: config.chat.deepseekApiKey,
      baseURL: 'https://api.deepseek.com',
      maxRetries: 0,
      timeout: 120_000,
    })
  : null

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

  if (!deepseek) {
    return jsonResponse({ message: '模型服务尚未配置，请联系管理员。' }, 503)
  }

  const payload: unknown = await httpRequest.json().catch(() => null)
  const parsed = chatRequestSchema.safeParse(payload)
  if (!parsed.success) {
    return jsonResponse({ message: '消息内容无效或过长。' }, 400)
  }

  const request = parsed.data
  let limit: ChatLimitReason | null
  try {
    limit = await reserveChatRequest(session.user.id, request.requestId)
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

  const stream = createChatEventStream(httpRequest.signal)
  const generate = async () => {
    const messageId = crypto.randomUUID()
    let status: ChatRequestStatus = 'failed'
    let inputTokens: number | undefined
    let outputTokens: number | undefined

    try {
      const response = await deepseek.chat.completions.create(
        {
          model: config.chat.model,
          messages: request.messages,
          stream: true,
          reasoning_effort: 'none',
          stream_options: { include_usage: true },
          max_tokens: 2_048,
        },
        { signal: stream.signal },
      )

      await stream.write({
        type: 'message-start',
        requestId: request.requestId,
        conversationId: request.conversationId,
        messageId,
      })

      for await (const chunk of response) {
        const delta = chunk.choices[0]?.delta.content
        if (delta && !stream.signal.aborted) {
          await stream.write({
            type: 'text-delta',
            requestId: request.requestId,
            conversationId: request.conversationId,
            messageId,
            delta,
          })
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens
          outputTokens = chunk.usage.completion_tokens
        }
      }

      status = stream.signal.aborted ? 'cancelled' : 'completed'
      if (status === 'completed') {
        await stream.write({
          type: 'message-complete',
          requestId: request.requestId,
          conversationId: request.conversationId,
          messageId,
        })
      }
    } catch (error) {
      status =
        stream.signal.reason === 'client-disconnected' ? 'cancelled' : 'failed'

      if (status !== 'cancelled') {
        await stream
          .write({
            type: 'error',
            requestId: request.requestId,
            conversationId: request.conversationId,
            messageId,
            message:
              stream.signal.reason === 'timeout'
                ? '生成超时，请重试。'
                : upstreamMessage(error),
          })
          .catch(() => {})
      }
    } finally {
      await finishChatRequest(
        request.requestId,
        status,
        inputTokens !== undefined && outputTokens !== undefined
          ? { inputTokens, outputTokens }
          : undefined,
      ).catch((error: unknown) => {
        logger.error('chat.usage_failed', { error })
      })
      await stream.close()
    }
  }
  void generate()
  return stream.response
}
