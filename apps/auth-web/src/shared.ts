import { normalizeSessionDate } from '@velin/contracts/value'
import {
  isValidNewPassword,
  passwordPolicyMessage,
} from '@velin/contracts/policy'
export { normalizeSessionDate } from '@velin/contracts/value'
import { useEffect, useState } from 'react'

// 设备识别只有一份实现：桌面端和网页端都吃 src/shared/session-client.ts 的结果。
export {
  formatSessionActivity,
  formatSessionClient,
  normalizeSessionClient,
} from '@velin/contracts/session-client'
export type { SessionClientIcon } from '@velin/contracts/session-client'

// Better Auth 的部分错误文案是英文原文，直接显示会给中文界面夹生。
const serverMessageCopy: ReadonlyArray<readonly [RegExp, string]> = [
  [/too many requests/i, '尝试次数过多，请稍后再试。'],
  [/invalid email or password/i, '邮箱或密码不正确。'],
  [/no account found/i, '没有找到该账号。'],
  [/email or password is required/i, '请填写邮箱和密码。'],
  [/already pending/i, '上一次通行密钥请求还没有结束，请刷新页面后重试。'],
]

export function errorMessage(error: { message?: string } | null | undefined) {
  const message = error?.message?.trim()

  if (!message) {
    return '操作没有完成，请稍后重试。'
  }

  for (const [pattern, copy] of serverMessageCopy) {
    if (pattern.test(message)) {
      return copy
    }
  }

  return message
}

export function newPasswordError(value: string) {
  return isValidNewPassword(value) ? '' : passwordPolicyMessage
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

// 重发冷却：生产对齐后端每分钟限流窗口，本地开发缩到 5 秒方便反复走流程。
export const resendCooldownSeconds = import.meta.env.DEV ? 5 : 60

export function useResendCooldown(seconds = resendCooldownSeconds) {
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    if (remaining <= 0) {
      return
    }

    const timer = window.setTimeout(
      () => setRemaining((value) => Math.max(0, value - 1)),
      1000,
    )

    return () => window.clearTimeout(timer)
  }, [remaining])

  return {
    remaining,
    start: () => setRemaining(seconds),
    clear: () => setRemaining(0),
  }
}

export { useSendSlot } from './security/useSendSlot'

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
      userAgent: typeof record.userAgent === 'string' ? record.userAgent : null,
      updatedAt: normalizeSessionDate(record.updatedAt),
    })
  }

  return sessions
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
