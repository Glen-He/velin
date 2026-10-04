import { avatarLimits } from '@velin/contracts/policy'

const jsonBodyLimit = 1024 * 1024

// 在 JSON、表单和图片解码前计数实际字节，不依赖 Content-Length 的声明。
export async function limitRequestBody(
  request: Request,
): Promise<Request | Response> {
  if (!request.body) return request
  const limit =
    new URL(request.url).pathname === '/api/avatars'
      ? avatarLimits.uploadBytes
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
  return new Request(request, { body: bytes })
}
