export type AuthFieldName = 'email' | 'password' | 'otp'

export type AuthFeedback = {
  message: string
  field: AuthFieldName | null
}

const errorFields: Readonly<Record<string, AuthFieldName>> = {
  INVALID_EMAIL: 'email',
  USER_NOT_FOUND: 'email',
  USER_ALREADY_EXISTS: 'email',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'email',
  EMAIL_NOT_VERIFIED: 'email',
  INVALID_PASSWORD: 'password',
  PASSWORD_POLICY_VIOLATION: 'password',
  PASSWORD_TOO_SHORT: 'password',
  PASSWORD_TOO_LONG: 'password',
  // 服务端不区分账号不存在和密码错误，保留原文并关联凭据提交的最后一个字段。
  INVALID_EMAIL_OR_PASSWORD: 'password',
  INVALID_OTP: 'otp',
  OTP_EXPIRED: 'otp',
  INVALID_CODE: 'otp',
  INVALID_BACKUP_CODE: 'otp',
}

export function authFeedback(message: string, cause: unknown): AuthFeedback {
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? cause.code
      : undefined
  return {
    message,
    field: typeof code === 'string' ? (errorFields[code] ?? null) : null,
  }
}
