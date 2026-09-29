import { streamSSE } from 'hono/streaming'
import type { Hono } from 'hono'
import OpenAI, { APIConnectionError, APIError } from 'openai'
import { z } from 'zod'
import { auth } from '../auth.js'
import { config } from '../config.js'
import {
  finishChatRequest,
  reserveChatRequest,
  type ChatLimitReason,
  type ChatRequestStatus,
} from './usage.js'

const promptMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8_000).refine((value) => value.trim().length > 0),
}).strict()

const chatRequestSchema = z.object({
  requestId: z.uuid(),
  conversationId: z.uuid(),
  messages: z.array(promptMessageSchema).min(1).max(32),
}).strict().refine(
  (request) =>
    request.messages.at(-1)?.role === 'user' &&
    request.messages.reduce((size, message) => size + message.content.length, 0) <=
      32_000,
)

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

export function registerChatRoutes(app: Hono) {
  app.post('/api/chat/stream', async (context) => {
    // This API is called by Electron Main, which holds the session cookie.
    // Refuse browser-origin requests so a page cannot spend the server key.
    if (
      context.req.header('origin') ||
      context.req.header('content-type')?.split(';', 1)[0].trim() !==
        'application/json'
    ) {
      return context.json({ message: '请求来源或格式无效。' }, 403)
    }

    const session = await auth.api.getSession({ headers: context.req.raw.headers })
    if (!session) {
      return context.json({ message: '请先登录后再发送消息。' }, 401)
    }

    if (!deepseek) {
      return context.json({ message: '模型服务尚未配置，请联系管理员。' }, 503)
    }

    const payload: unknown = await context.req.json().catch(() => null)
    const parsed = chatRequestSchema.safeParse(payload)
    if (!parsed.success) {
      return context.json({ message: '消息内容无效或过长。' }, 400)
    }

    const request = parsed.data
    let limit: ChatLimitReason | null
    try {
      limit = await reserveChatRequest(session.user.id, request.requestId)
    } catch (error) {
      console.error('对话用量检查失败。', error)
      return context.json({ message: '暂时无法开始对话，请稍后重试。' }, 503)
    }

    if (limit) {
      return context.json(
        { message: limitMessage(limit) },
        limit === 'duplicate' || limit === 'busy' ? 409 : 429,
      )
    }

    return streamSSE(context, async (stream) => {
      const controller = new AbortController()
      const abortForDisconnect = () => controller.abort('client-disconnected')
      const timeout = setTimeout(() => controller.abort('timeout'), 120_000)
      context.req.raw.signal.addEventListener('abort', abortForDisconnect, {
        once: true,
      })
      stream.onAbort(abortForDisconnect)

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
          { signal: controller.signal },
        )

        await stream.writeSSE({
          event: 'chat',
          data: JSON.stringify({
            type: 'message-start',
            requestId: request.requestId,
            conversationId: request.conversationId,
            messageId,
          }),
        })

        for await (const chunk of response) {
          const delta = chunk.choices[0]?.delta.content
          if (delta && !stream.aborted) {
            await stream.writeSSE({
              event: 'chat',
              data: JSON.stringify({
                type: 'text-delta',
                requestId: request.requestId,
                conversationId: request.conversationId,
                messageId,
                delta,
              }),
            })
          }
          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens
            outputTokens = chunk.usage.completion_tokens
          }
        }

        status = controller.signal.aborted ? 'cancelled' : 'completed'
        if (status === 'completed') {
          await stream.writeSSE({
            event: 'chat',
            data: JSON.stringify({
              type: 'message-complete',
              requestId: request.requestId,
              conversationId: request.conversationId,
              messageId,
            }),
          })
        }
      } catch (error) {
        status = controller.signal.reason === 'client-disconnected'
          ? 'cancelled'
          : 'failed'

        if (!stream.aborted && status !== 'cancelled') {
          await stream.writeSSE({
            event: 'chat',
            data: JSON.stringify({
              type: 'error',
              requestId: request.requestId,
              conversationId: request.conversationId,
              messageId,
              message: controller.signal.reason === 'timeout'
                ? '生成超时，请重试。'
                : upstreamMessage(error),
            }),
          })
        }
      } finally {
        clearTimeout(timeout)
        context.req.raw.signal.removeEventListener('abort', abortForDisconnect)
        await finishChatRequest(
          request.requestId,
          status,
          inputTokens !== undefined && outputTokens !== undefined
            ? { inputTokens, outputTokens }
            : undefined,
        ).catch((error: unknown) => {
          console.error('记录对话用量失败。', error)
        })
      }
    })
  })
}
