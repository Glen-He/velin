import { serviceUrl, authClient } from './auth-client'
import { isAvatarJpeg } from '@velin/contracts/avatar'
import { errorMessage } from '@velin/contracts/error-copy'
import { fetchOwnedAvatarImage } from './avatar-request'

// Renderer 完成裁剪后把 256px JPEG 交给 Main 上传；这里再次校验尺寸与
// JPEG 魔数（服务端会做同样的校验），会话 Cookie 始终只存在于 Main。
export async function uploadAvatar(jpeg: Uint8Array) {
  if (!isAvatarJpeg(jpeg)) {
    throw new Error('头像必须是 512KB 以内的 JPEG 图片。')
  }

  const response = await fetch(`${serviceUrl}/api/avatars`, {
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

    throw new Error(errorMessage(body, '上传头像失败，请稍后重试。'))
  }
}

// 渲染层不允许直接请求 API 来源（CSP 约束），头像字节统一由 Main
// 代取；地址必须严格指向认证服务的头像路由，仅路径与版本参数可变。
export function fetchAvatarImage(imageUrl: string) {
  return fetchOwnedAvatarImage(imageUrl, serviceUrl)
}
