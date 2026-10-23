import type { ChatEvent } from '@velin/contracts/chat-protocol'
import { chatTimeouts } from '@velin/contracts/policy'

// 原生流保留背压；等待模型时发送注释心跳，防止代理把正常等待当作闲置断连。
export function createChatEventStream(
  parentSignal: AbortSignal,
  timeoutMs = chatTimeouts.generationMs,
  heartbeatMs = 15_000,
) {
  const controller = new AbortController()
  const transport = new TransformStream<Uint8Array, Uint8Array>()
  const writer = transport.writable.getWriter()
  const encoder = new TextEncoder()
  let disconnected = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let lastWrite = Date.now()
  let heartbeatPending = false
  const disconnect = () => {
    disconnected = true
    clearInterval(heartbeat)
    controller.abort('client-disconnected')
  }
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs)
  if (parentSignal.aborted) disconnect()
  else parentSignal.addEventListener('abort', disconnect, { once: true })
  void writer.closed.catch(disconnect)
  async function writeText(text: string) {
    if (disconnected) return
    lastWrite = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        writer.write(encoder.encode(text)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              disconnect()
              void writer.abort().catch(() => {})
              reject(new Error('SSE consumer stalled.'))
            },
            Math.min(10_000, Math.max(100, timeoutMs)),
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  if (!disconnected) {
    heartbeat = setInterval(() => {
      if (heartbeatPending || Date.now() - lastWrite < heartbeatMs) return
      heartbeatPending = true
      void writeText(': keep-alive\n\n')
        .catch(disconnect)
        .finally(() => {
          heartbeatPending = false
        })
    }, heartbeatMs)
    heartbeat.unref()
  }
  return {
    signal: controller.signal,
    response: new Response(transport.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'private, no-store',
        'X-Accel-Buffering': 'no',
      },
    }),
    write(event: ChatEvent) {
      return writeText(`event: chat\ndata: ${JSON.stringify(event)}\n\n`)
    },
    async close() {
      clearTimeout(timeout)
      clearInterval(heartbeat)
      parentSignal.removeEventListener('abort', disconnect)
      if (disconnected) {
        void writer.abort().catch(() => {})
        return
      }
      await writer.close().catch(() => {})
    },
  }
}
