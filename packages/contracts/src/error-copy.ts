import { isRecord } from './value.js'

const codeCopy: Readonly<Record<string, string>> = {
  INVALID_EMAIL_OR_PASSWORD: '邮箱或密码不正确。',
  INVALID_PASSWORD: '密码不正确，请重新输入。',
  INVALID_OTP: '验证码不正确，请重新输入。',
  OTP_EXPIRED: '验证码已过期，请重新发送。',
  TOO_MANY_REQUESTS: '尝试次数过多，请稍后再试。',
  USER_NOT_FOUND: '没有找到该账号。',
  USER_ALREADY_EXISTS: '该邮箱已注册，请直接登录。',
  EMAIL_NOT_VERIFIED: '请先完成邮箱验证。',
  SESSION_EXPIRED: '登录已过期，请重新登录。',
}

const messageCopy: ReadonlyArray<readonly [RegExp, string]> = [
  [/too many requests|rate limit/i, codeCopy.TOO_MANY_REQUESTS],
  [/invalid email or password/i, codeCopy.INVALID_EMAIL_OR_PASSWORD],
  [/invalid password/i, codeCopy.INVALID_PASSWORD],
  [/invalid (?:otp|verification code)/i, codeCopy.INVALID_OTP],
  [/otp expired|verification code.*expired/i, codeCopy.OTP_EXPIRED],
  [/no account found/i, codeCopy.USER_NOT_FOUND],
  [/email or password is required/i, '请填写邮箱和密码。'],
  [/already pending/i, '上一次通行密钥请求还没有结束，请稍后重试。'],
]

// 两个界面共用显示边界；未知诊断不直接进入用户界面。
export function errorMessage(
  error: unknown,
  fallback = '操作没有完成，请稍后重试。',
): string {
  if (!isRecord(error)) return fallback
  if (typeof error.code === 'string' && codeCopy[error.code]) {
    return codeCopy[error.code]
  }
  const message = typeof error.message === 'string' ? error.message.trim() : ''
  if (!message || message.length > 500) return fallback
  for (const [pattern, copy] of messageCopy) {
    if (pattern.test(message)) return copy
  }
  return /\p{Script=Han}/u.test(message) ? message : fallback
}
