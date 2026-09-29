import { app } from 'electron'
import { createParser } from 'eventsource-parser'
import type {
  ChatEvent,
  SendMessageRequest,
} from '../../src/shared/chat-protocol'
import { apiServerUrl, authClient } from '../auth/auth-client'

type ChatEventEmitter = (event: ChatEvent) => void

type ChatTask = {
  request: SendMessageRequest
  controller: AbortController
  emit: ChatEventEmitter
  stopped: boolean
}

function readErrorMessage(value: unknown, fallback: string) {
  if (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string' &&
    value.message.length <= 200
  ) {
    return value.message
  }

  return fallback
}

function parseChatEvent(value: unknown): ChatEvent | null {
  if (typeof value !== 'object' || value === null) return null
  const event = value as Record<string, unknown>
  if (
    typeof event.requestId !== 'string' ||
    typeof event.conversationId !== 'string'
  ) return null

  if (
    event.type === 'message-start' ||
    event.type === 'message-complete'
  ) {
    return typeof event.messageId === 'string'
      ? {
          type: event.type,
          requestId: event.requestId,
          conversationId: event.conversationId,
          messageId: event.messageId,
        }
      : null
  }

  if (event.type === 'text-delta') {
    return typeof event.messageId === 'string' &&
      typeof event.delta === 'string'
      ? {
          type: 'text-delta',
          requestId: event.requestId,
          conversationId: event.conversationId,
          messageId: event.messageId,
          delta: event.delta,
        }
      : null
  }

  if (event.type === 'error') {
    return typeof event.message === 'string'
      ? {
          type: 'error',
          requestId: event.requestId,
          conversationId: event.conversationId,
          ...(typeof event.messageId === 'string'
            ? { messageId: event.messageId }
            : {}),
          message: event.message,
        }
      : null
  }

  if (event.type === 'message-stopped') {
    return {
      type: 'message-stopped',
      requestId: event.requestId,
      conversationId: event.conversationId,
    }
  }

  return null
}

export class ChatRuntime {
  private readonly tasks = new Map<string, ChatTask>()
  private readonly conversationRequests = new Map<string, string>()
  private readonly onUnauthorized: () => void

  constructor(onUnauthorized: () => void) {
    this.onUnauthorized = onUnauthorized
  }

  start(request: SendMessageRequest, emit: ChatEventEmitter) {
    if (
      this.tasks.has(request.requestId) ||
      this.conversationRequests.has(request.conversationId)
    ) return false

    const task: ChatTask = {
      request,
      controller: new AbortController(),
      emit,
      stopped: false,
    }
    this.tasks.set(request.requestId, task)
    this.conversationRequests.set(request.conversationId, request.requestId)
    void this.run(task)
    return true
  }

  stop(requestId: string, conversationId: string) {
    const task = this.tasks.get(requestId)
    if (!task || task.request.conversationId !== conversationId) return false
    task.stopped = true
    task.controller.abort('stopped')
    return true
  }

  stopAll() {
    for (const task of this.tasks.values()) {
      task.stopped = true
      task.controller.abort('stopped')
    }
  }

  private async run(task: ChatTask) {
    const { request, emit, controller } = task
    let terminal = false
    const timeout = setTimeout(() => controller.abort('timeout'), 130_000)

    try {
      if (app.isPackaged && new URL(apiServerUrl).protocol !== 'https:') {
        throw new Error('模型服务地址必须使用 HTTPS。')
      }

      const response = await fetch(`${apiServerUrl}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Cookie: authClient.getCookie(),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null)
        if (response.status === 401) this.onUnauthorized()
        throw new Error(readErrorMessage(body, '发送消息失败，请稍后重试。'))
      }

      if (
        !response.body ||
        !response.headers.get('content-type')?.startsWith('text/event-stream')
      ) {
        throw new Error('模型服务返回了无效的流式响应。')
      }

      const decoder = new TextDecoder()
      const parser = createParser({
        maxBufferSize: 64 * 1024,
        onEvent: (message) => {
          if (message.event !== 'chat' || task.stopped || terminal) return
          let value: unknown
          try {
            value = JSON.parse(message.data)
          } catch {
            return
          }
          const event = parseChatEvent(value)
          if (
            !event ||
            event.requestId !== request.requestId ||
            event.conversationId !== request.conversationId
          ) return

          emit(event)
          if (event.type === 'message-complete' || event.type === 'error') {
            terminal = true
          }
        },
      })

      for await (const chunk of response.body) {
        parser.feed(decoder.decode(chunk, { stream: true }))
      }
      parser.feed(decoder.decode())
      parser.reset({ consume: true })

      if (!terminal && !task.stopped) {
        throw new Error('模型服务连接提前中断，请重试。')
      }
    } catch (error) {
      if (!task.stopped && !terminal) {
        emit({
          type: 'error',
          requestId: request.requestId,
          conversationId: request.conversationId,
          message:
            controller.signal.reason === 'timeout'
              ? '生成超时，请重试。'
              : error instanceof Error && error.message.length <= 200
                ? error.message
                : '发送消息失败，请稍后重试。',
        })
      }
    } finally {
      clearTimeout(timeout)
      this.tasks.delete(request.requestId)
      if (this.conversationRequests.get(request.conversationId) === request.requestId) {
        this.conversationRequests.delete(request.conversationId)
      }
      if (task.stopped) {
        emit({
          type: 'message-stopped',
          requestId: request.requestId,
          conversationId: request.conversationId,
        })
      }
    }
  }
}
