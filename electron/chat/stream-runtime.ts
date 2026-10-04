import { errorMessage } from '@velin/contracts/error-copy'
import { createParser } from 'eventsource-parser'
import type {
  ChatEvent,
  SendMessageRequest,
} from '@velin/contracts/chat-protocol'
import { chatEventSchema } from '@velin/contracts/chat-validation'

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

type RuntimeDependencies = {
  endpoint: string
  getCookie: () => string
  onUnauthorized: () => void
  request?: typeof fetch
  timeoutMs?: number
}

export class ChatStreamRuntime {
  private readonly tasks = new Map<string, ChatTask>()
  private readonly conversationRequests = new Map<string, string>()
  private readonly dependencies: RuntimeDependencies

  constructor(dependencies: RuntimeDependencies) {
    this.dependencies = dependencies
  }

  start(request: SendMessageRequest, emit: ChatEventEmitter) {
    if (
      this.tasks.has(request.requestId) ||
      this.conversationRequests.has(request.conversationId)
    )
      return false

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
    this.release(task)
    task.emit({ type: 'message-stopped', requestId, conversationId })
    return true
  }

  stopAll() {
    for (const task of [...this.tasks.values()]) {
      this.stop(task.request.requestId, task.request.conversationId)
    }
  }

  private release(task: ChatTask) {
    const { request } = task
    if (this.tasks.get(request.requestId) !== task) return
    this.tasks.delete(request.requestId)
    if (
      this.conversationRequests.get(request.conversationId) ===
      request.requestId
    )
      this.conversationRequests.delete(request.conversationId)
  }

  private async run(task: ChatTask) {
    const { request, emit, controller } = task
    let terminal = false
    const timeout = setTimeout(
      () => controller.abort('timeout'),
      this.dependencies.timeoutMs ?? 130_000,
    )

    try {
      const response = await (this.dependencies.request ?? fetch)(
        this.dependencies.endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            Cookie: this.dependencies.getCookie(),
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        },
      )

      if (task.stopped) {
        await response.body?.cancel()
        return
      }
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null)
        if (task.stopped) return
        if (response.status === 401) this.dependencies.onUnauthorized()
        throw new Error(readErrorMessage(body, '发送消息失败，请稍后重试。'))
      }

      if (
        !response.body ||
        !response.headers.get('content-type')?.startsWith('text/event-stream')
      ) {
        await response.body?.cancel().catch(() => {})
        throw new Error('模型服务返回了无效的流式响应。')
      }

      let messageId: string | null = null
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
          const parsed = chatEventSchema.safeParse(value)
          const event = parsed.success ? parsed.data : null
          if (
            !event ||
            event.requestId !== request.requestId ||
            event.conversationId !== request.conversationId
          )
            return

          if ('messageId' in event && event.messageId) {
            if (messageId && messageId !== event.messageId) return
            if (event.type === 'text-delta' && !messageId) return
            messageId = event.messageId
          }
          if (
            event.type === 'message-complete' ||
            event.type === 'error' ||
            event.type === 'message-stopped'
          ) {
            terminal = true
            this.release(task)
          }
          emit(
            event.type === 'error'
              ? {
                  ...event,
                  message: errorMessage(event, '生成回复失败，请稍后重试。'),
                }
              : event,
          )
        },
      })

      for await (const chunk of response.body) {
        parser.feed(decoder.decode(chunk, { stream: true }))
        if (terminal) break
      }
      parser.feed(decoder.decode())
      parser.reset({ consume: true })

      if (!terminal && !task.stopped) {
        throw new Error('模型服务连接提前中断，请重试。')
      }
    } catch (error) {
      if (!task.stopped && !terminal) {
        this.release(task)
        emit({
          type: 'error',
          requestId: request.requestId,
          conversationId: request.conversationId,
          message:
            controller.signal.reason === 'timeout'
              ? '生成超时，请重试。'
              : errorMessage(error, '发送消息失败，请稍后重试。'),
        })
      }
    } finally {
      clearTimeout(timeout)
      this.release(task)
    }
  }
}
