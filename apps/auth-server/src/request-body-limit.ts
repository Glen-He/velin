import type { MiddlewareHandler } from 'hono'
import { avatarLimits } from '@velin/contracts/policy'

const jsonBodyLimit = 1024 * 1024

// 在 JSON、表单和图片解码前计数实际字节，不依赖 Content-Length 的声明。
export const limitRequestBody: MiddlewareHandler = async (context, next) => {
  const request = context.req.raw
  if (!request.body) return next()
  const limit =
    context.req.path === '/api/avatars'
      ? avatarLimits.uploadBytes
      : jsonBodyLimit
  const oversized = () =>
    context.json(
      { error: 'payload_too_large', message: '请求内容过大，请缩小后重试。' },
      413,
    )
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) return oversized()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel().catch(() => {})
        return oversized()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  context.req.raw = new Request(request, { body: bytes })
  return next()
}
