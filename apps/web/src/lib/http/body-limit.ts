import { attachmentLimits } from '@velin/contracts/attachments'
import { avatarLimits } from '@velin/contracts/policy'

const jsonBodyLimit = 1024 * 1024

// 在 JSON、表单和图片解码前计数实际字节，不依赖 Content-Length 的声明。
export async function limitRequestBody(
  request: Request,
  timeoutMs = 60_000,
): Promise<Request | Response> {
  if (!request.body) return request
  const pathname = new URL(request.url).pathname
  const limit =
    pathname === '/api/avatars'
      ? avatarLimits.uploadBytes
      : pathname === '/api/chat/attachments'
        ? attachmentLimits.requestBytes
        : jsonBodyLimit
  const oversized = () =>
    Response.json(
      { error: 'payload_too_large', message: '请求内容过大，请缩小后重试。' },
      { status: 413 },
    )
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) return oversized()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let block: Uint8Array | undefined
  let blockSize = 0
  let interrupted = false
  const interrupt = () => {
    interrupted = true
    // 取消先结束待处理的 read；不等待不可信源的 cancel 回调完成。
    void reader.cancel().catch(() => {})
  }
  const timeout = setTimeout(interrupt, timeoutMs)
  if (request.signal.aborted) interrupt()
  else request.signal.addEventListener('abort', interrupt, { once: true })
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (interrupted)
        return Response.json(
          {
            error: request.signal.aborted
              ? 'request_cancelled'
              : 'request_timeout',
            message: request.signal.aborted
              ? '请求已中断，请重试。'
              : '请求内容接收超时，请重试。',
          },
          { status: 408 },
        )
      if (done) break
      size += value.byteLength
      if (size > limit) {
        void reader.cancel().catch(() => {})
        return oversized()
      }
      // 合并小分片，避免一个字节一帧的请求累积大量数组对象。
      let offset = 0
      while (offset < value.byteLength) {
        block ??= new Uint8Array(64 * 1024)
        const length = Math.min(
          block.length - blockSize,
          value.byteLength - offset,
        )
        block.set(value.subarray(offset, offset + length), blockSize)
        blockSize += length
        offset += length
        if (blockSize === block.length) {
          chunks.push(block)
          block = undefined
          blockSize = 0
        }
      }
    }
  } catch {
    return Response.json(
      { error: 'invalid_body', message: '请求内容不完整或格式无效，请重试。' },
      { status: 400 },
    )
  } finally {
    clearTimeout(timeout)
    request.signal.removeEventListener('abort', interrupt)
    reader.releaseLock()
  }
  if (blockSize) chunks.push(block!.subarray(0, blockSize))
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new Request(request, { body: bytes })
}
