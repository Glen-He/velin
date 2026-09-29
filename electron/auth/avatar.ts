import { apiServerUrl, authClient } from './auth-client'

const maxUploadBytes = 512 * 1024

const jpegSignature = [0xff, 0xd8, 0xff] as const

const avatarPathPattern = /^\/api\/avatars\/[A-Za-z0-9_-]{16,64}$/

function readErrorMessage(body: unknown, fallback: string) {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as { message: unknown }).message
    if (
      typeof message === 'string' &&
      message.length > 0 &&
      message.length <= 200
    ) {
      return message
    }
  }

  return fallback
}

// Renderer 完成裁剪后把 256px JPEG 交给 Main 上传；这里再次校验尺寸与
// JPEG 魔数（服务端会做同样的校验），会话 Cookie 始终只存在于 Main。
export async function uploadAvatar(jpeg: Uint8Array) {
  const isValidJpeg =
    jpeg.byteLength > jpegSignature.length &&
    jpeg.byteLength <= maxUploadBytes &&
    jpegSignature.every((value, index) => jpeg[index] === value)

  if (!isValidJpeg) {
    throw new Error('头像必须是 512KB 以内的 JPEG 图片。')
  }

  const response = await fetch(`${apiServerUrl}/api/avatars`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      Cookie: authClient.getCookie(),
    },
    body: jpeg,
  })

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    if (response.status === 401) {
      throw new Error('登录状态已过期，请重新登录。')
    }

    throw new Error(readErrorMessage(body, '上传头像失败，请稍后重试。'))
  }
}

// 渲染层不允许直接请求 API 来源（CSP 约束），头像字节统一由 Main
// 代取；地址必须严格指向认证服务的头像路由，仅路径与版本参数可变。
export async function fetchAvatarImage(imageUrl: string) {
  let parsed: URL

  try {
    parsed = new URL(imageUrl)
  } catch {
    throw new Error('头像地址无效。')
  }

  if (
    parsed.origin !== new URL(apiServerUrl).origin ||
    !avatarPathPattern.test(parsed.pathname)
  ) {
    throw new Error('头像地址无效。')
  }

  const response = await fetch(
    `${parsed.origin}${parsed.pathname}${parsed.search}`,
  )

  if (!response.ok) {
    throw new Error('加载头像失败，请稍后重试。')
  }

  return new Uint8Array(await response.arrayBuffer())
}
