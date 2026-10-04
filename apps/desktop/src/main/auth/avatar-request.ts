import { isAvatarJpeg, resolveOwnedAvatarUrl } from '@velin/contracts/avatar'
import { avatarLimits } from '@velin/contracts/policy'

// 不带 Cookie、不跟随跳转；在读取过程中限制实际字节数，不能只信 Content-Length。
export async function fetchOwnedAvatarImage(
  image: string,
  serviceUrl: string,
  request: typeof fetch = fetch,
): Promise<Uint8Array<ArrayBuffer>> {
  const url = resolveOwnedAvatarUrl(image, serviceUrl)
  if (!url) throw new Error('头像地址无效。')
  const response = await request(url, {
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(10_000),
  })
  if (
    !response.ok ||
    !response.body ||
    response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase() !== 'image/jpeg'
  ) {
    await response.body?.cancel().catch(() => {})
    throw new Error('加载头像失败，请稍后重试。')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > avatarLimits.uploadBytes) throw new Error('头像图片过大。')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (!isAvatarJpeg(bytes)) throw new Error('头像图片格式无效。')
  return bytes
}
