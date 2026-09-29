import { Laptop, Smartphone, Tablet } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'

export function errorMessage(error: { message?: string } | null | undefined) {
  return error?.message ?? '操作没有完成，请稍后重试。'
}

export function newPasswordError(value: string) {
  return /^[\x21-\x7e]{8,32}$/.test(value)
    ? ''
    : '密码需为 8–32 位英文字母、数字或符号。'
}

export function isApplePlatform() {
  const userAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }
  const platform = userAgentData.userAgentData?.platform ?? navigator.platform
  return /Mac|iPhone|iPad/i.test(`${platform} ${navigator.userAgent}`)
}

// 两步确认：第一次点击进入待确认态，短时间后自动恢复。
export function useArmConfirm(resetMs = 3000) {
  const [armed, setArmed] = useState<string | null>(null)

  useEffect(() => {
    if (!armed) {
      return
    }

    const timer = window.setTimeout(() => setArmed(null), resetMs)

    return () => window.clearTimeout(timer)
  }, [armed, resetMs])

  return { armed, arm: setArmed, disarm: () => setArmed(null) }
}

export function normalizeSessionDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number') {
    return new Date(value).toISOString()
  }

  return ''
}

export type WebSessionInfo = {
  token: string
  isCurrent: boolean
  userAgent: string | null
  updatedAt: string
}

export function normalizeSessions(
  data: unknown,
  currentToken: string | null,
): WebSessionInfo[] {
  if (!Array.isArray(data)) {
    return []
  }

  const sessions: WebSessionInfo[] = []

  for (const item of data) {
    if (typeof item !== 'object' || item === null) {
      continue
    }

    const record = item as Record<string, unknown>
    const token = record.token

    if (typeof token !== 'string' || token.length === 0) {
      continue
    }

    sessions.push({
      token,
      isCurrent: token === currentToken,
      userAgent:
        typeof record.userAgent === 'string' ? record.userAgent : null,
      updatedAt: normalizeSessionDate(record.updatedAt),
    })
  }

  return sessions
}

type DeviceDescription = {
  platform: string
  detail: string | null
  icon: LucideIcon
}

function detectPlatformKind(userAgent: string) {
  if (/iphone/i.test(userAgent)) return 'ios'
  if (/ipad/i.test(userAgent)) return 'ipados'
  if (/android/i.test(userAgent)) return 'android'
  if (/windows/i.test(userAgent)) return 'windows'
  if (/macintosh|mac os x/i.test(userAgent)) return 'mac'
  if (/linux/i.test(userAgent)) return 'linux'
  return null
}

function detectOsName(kind: ReturnType<typeof detectPlatformKind>) {
  switch (kind) {
    case 'mac':
      return 'macOS'
    case 'windows':
      return 'Windows'
    case 'linux':
      return 'Linux'
    case 'ios':
      return 'iOS'
    case 'ipados':
      return 'iPadOS'
    case 'android':
      return 'Android'
    default:
      return null
  }
}

function detectBrowser(userAgent: string) {
  if (/edg\//i.test(userAgent)) return 'Edge'
  if (/opr\//i.test(userAgent)) return 'Opera'
  if (/firefox\//i.test(userAgent)) return 'Firefox'
  if (/chrome\//i.test(userAgent)) return 'Chrome'
  if (/safari\//i.test(userAgent)) return 'Safari'
  return null
}

// 与桌面端一致的两段式命名：平台 • 详情。
export function describeDevice(userAgent: string | null): DeviceDescription {
  if (!userAgent) {
    return { platform: '未知设备', detail: null, icon: Laptop }
  }

  const kind = detectPlatformKind(userAgent)
  const osName = detectOsName(kind)
  const browser = detectBrowser(userAgent)

  if (/electron/i.test(userAgent)) {
    return { platform: 'Desktop', detail: osName, icon: Laptop }
  }

  if (kind === 'ios') {
    return { platform: 'iPhone', detail: browser ?? 'iOS', icon: Smartphone }
  }

  if (kind === 'ipados') {
    return { platform: 'iPad', detail: browser ?? 'iPadOS', icon: Tablet }
  }

  if (kind === 'android') {
    return { platform: 'Android', detail: browser ?? 'Android', icon: Smartphone }
  }

  return { platform: 'Web', detail: browser ?? osName, icon: Laptop }
}

export function formatDeviceLabel(description: DeviceDescription) {
  return description.detail
    ? `${description.platform} • ${description.detail}`
    : description.platform
}

export function formatSessionActivity(iso: string) {
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return `${date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })} ${date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`
}

// 服务端存的是绝对地址；网页统一改走相对路径，开发环境由 Vite 代理、生产环境同源。
export function avatarDisplayUrl(image: string) {
  try {
    const parsed = new URL(image)

    return `${parsed.pathname}${parsed.search}`
  } catch {
    return image
  }
}

export function accountInitial(name: string, email: string) {
  return (name.trim()[0] ?? email[0] ?? 'U').toUpperCase()
}
