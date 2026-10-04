import type { ChatEvent } from '@velin/contracts/chat-protocol'

// 原生 Web Stream 保留背压；连接关闭和超时都必须取消模型请求。
export function createChatEventStream(
  parentSignal: AbortSignal,
  timeoutMs = 120_000,
) {
  const controller = new AbortController()
  const transport = new TransformStream<Uint8Array, Uint8Array>()
  const writer = transport.writable.getWriter()
  const encoder = new TextEncoder()
  const disconnect = () => controller.abort('client-disconnected')
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs)
  if (parentSignal.aborted) disconnect()
  else parentSignal.addEventListener('abort', disconnect, { once: true })
  void writer.closed.catch(disconnect)
  return {
    signal: controller.signal,
    response: new Response(transport.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    }),
    async write(event: ChatEvent) {
      if (controller.signal.reason === 'client-disconnected') return
      await writer.write(
        encoder.encode(`event: chat\ndata: ${JSON.stringify(event)}\n\n`),
      )
    },
    async close() {
      clearTimeout(timeout)
      parentSignal.removeEventListener('abort', disconnect)
      await writer.close().catch(() => {})
    },
  }
}
