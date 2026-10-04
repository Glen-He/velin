import { avatarLimits } from './policy.js'

const avatarPathPattern = /^\/api\/avatars\/[A-Za-z0-9_-]{16,64}$/

// 自有图片只接受固定路由和单一版本参数；其他地址不能借头像接口请求。
export function ownedAvatarPath(value: string): string | null {
  if (value.length > 2048 || !avatarPathPattern.test(value.split('?', 1)[0]))
    return null
  try {
    const url = new URL(value, 'https://avatar.invalid')
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      !avatarPathPattern.test(url.pathname)
    )
      return null
    const parameters = [...url.searchParams]
    if (
      parameters.length > 1 ||
      parameters.some(
        ([key, version]) => key !== 'v' || !/^\d{1,20}$/.test(version),
      )
    )
      return null
    return `${url.pathname}${url.search}`
  } catch {
    return null
  }
}

export function resolveOwnedAvatarUrl(
  value: string,
  serviceUrl: string,
): string | null {
  const path = ownedAvatarPath(value)
  if (!path) return null
  try {
    const service = new URL(serviceUrl)
    return `${service.origin}${path}`
  } catch {
    return null
  }
}

export function isAvatarJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > 3 &&
    bytes.byteLength <= avatarLimits.uploadBytes &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
}

export function accountInitial(name: string, email: string): string {
  return ([...name.trim()][0] ?? [...email.trim()][0] ?? 'U').toUpperCase()
}
