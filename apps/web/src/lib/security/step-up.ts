import 'server-only'

import { createVerificationLimiter } from './verification-limiter'
import { databasePool } from '../database/connection'
import { jsonResponse, rateLimitedResponse } from '../http/response'
import { z } from 'zod'
import { verificationIntentSchema } from '@velin/contracts/security'
import { isRecord } from '@velin/contracts/value'
import { auth } from '../auth/server'
import { config } from '../config'
import { readDevCode } from '../email'
import { operationRequirements } from './operation-policy'
import { operationGrants } from './grants'
import { callBetterAuth, forwardCookies } from './better-auth-call'

const stepUpBody = verificationIntentSchema.safeExtend({
  method: z.enum(['emailOtp', 'totp', 'backupCode']),
  code: z.string().min(1).max(128),
})
const passkeyBody = verificationIntentSchema.safeExtend({
  response: z.record(z.string(), z.unknown()),
})

// 由会原子消费验证码的 verify-email 端点执行校验和删除。
async function verifyCode(
  input: z.infer<typeof stepUpBody>,
  cookie: string,
  email: string,
) {
  const verification =
    input.method === 'emailOtp'
      ? { path: '/email-otp/verify-email', body: { email, otp: input.code } }
      : input.method === 'backupCode'
        ? {
            path: '/two-factor/verify-backup-code',
            body: { code: input.code, trustDevice: false },
          }
        : {
            path: '/two-factor/verify-totp',
            body: { code: input.code, trustDevice: false },
          }
  return callBetterAuth(verification.path, {
    method: 'POST',
    cookie,
    body: verification.body,
  })
}

const limiter = createVerificationLimiter(databasePool)
export async function readSecurityRequirements(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  })
  if (!session) return jsonResponse({ message: '请先登录。' }, 401)
  return jsonResponse({ requirements: operationRequirements })
}

export async function sendStepUpEmailCode(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  })
  if (!session) return jsonResponse({ message: '请先登录。' }, 401)
  if (config.isProduction) {
    const attempt = await limiter.attempt(session.user.id, 'send')
    if (!attempt.allowed) {
      return rateLimitedResponse(
        attempt.retryAfterSeconds,
        '操作过于频繁，请稍后重试。',
      )
    }
  }
  const result = await callBetterAuth('/email-otp/send-verification-otp', {
    method: 'POST',
    cookie: request.headers.get('cookie') ?? '',
    body: { email: session.user.email, type: 'email-verification' },
  })
  if (result.status >= 400)
    return jsonResponse(
      {
        code: result.status === 429 ? 'RATE_LIMITED' : 'EMAIL_DELIVERY_FAILED',
        message:
          result.status === 429
            ? '发送过于频繁，请稍后重试。'
            : '验证码发送失败，请稍后重试。',
      },
      result.status === 429 ? 429 : 400,
    )
  const devOtp = readDevCode(session.user.email)
  return jsonResponse(devOtp ? { sent: true, devOtp } : { sent: true })
}

export async function verifyStepUpCode(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  })
  if (!session) return jsonResponse({ message: '请先登录。' }, 401)
  const parsed = stepUpBody.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return jsonResponse({ message: '验证参数不完整。' }, 400)
  if (
    !operationRequirements[parsed.data.operation].allowed.includes(
      parsed.data.method,
    )
  ) {
    return jsonResponse({ message: '这次操作不支持所选验证方式。' }, 400)
  }
  if (
    (parsed.data.method === 'totp' || parsed.data.method === 'backupCode') &&
    !session.user.twoFactorEnabled
  ) {
    return jsonResponse({ message: '当前账号尚未开启双重认证。' }, 400)
  }
  if (config.isProduction) {
    const attempt = await limiter.attempt(session.user.id, 'verify')
    if (!attempt.allowed) {
      return rateLimitedResponse(
        attempt.retryAfterSeconds,
        '验证过于频繁，请稍后重试。',
      )
    }
  }
  const result = await verifyCode(
    parsed.data,
    request.headers.get('cookie') ?? '',
    session.user.email,
  )
  if (result.status >= 400)
    return jsonResponse(
      {
        code: result.status === 429 ? 'RATE_LIMITED' : 'VERIFICATION_FAILED',
        message:
          result.status === 429
            ? '验证过于频繁，请稍后重试。'
            : '验证码不正确或已过期。',
      },
      result.status === 429 ? 429 : 401,
    )
  const grant = await operationGrants.issue(
    { userId: session.user.id, sessionId: session.session.id },
    parsed.data,
    parsed.data.method,
  )
  const response = jsonResponse(grant)
  forwardCookies(result.headers, response.headers)
  return response
}

export async function createPasskeyOptions(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  })
  if (!session) return jsonResponse({ message: '请先登录。' }, 401)
  if (config.isProduction) {
    const attempt = await limiter.attempt(session.user.id, 'passkey-options')
    if (!attempt.allowed) {
      return rateLimitedResponse(
        attempt.retryAfterSeconds,
        '操作过于频繁，请稍后重试。',
      )
    }
  }
  const result = await callBetterAuth(
    '/passkey/generate-authenticate-options',
    {
      method: 'GET',
      cookie: request.headers.get('cookie') ?? '',
    },
  )
  if (result.status >= 400 || !isRecord(result.payload)) {
    return jsonResponse({ message: '无法发起通行密钥验证。' }, 400)
  }
  const response = jsonResponse({
    ...result.payload,
    userVerification: 'required',
  })
  forwardCookies(result.headers, response.headers)
  return response
}

export async function verifyStepUpPasskey(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  })
  if (!session) return jsonResponse({ message: '请先登录。' }, 401)
  if (config.isProduction) {
    const attempt = await limiter.attempt(session.user.id, 'verify')
    if (!attempt.allowed) {
      return rateLimitedResponse(
        attempt.retryAfterSeconds,
        '操作过于频繁，请稍后重试。',
      )
    }
  }
  const parsed = passkeyBody.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return jsonResponse({ message: '缺少通行密钥断言或操作。' }, 400)
  const result = await callBetterAuth('/passkey/verify-authentication', {
    method: 'POST',
    cookie: request.headers.get('cookie') ?? '',
    body: { response: parsed.data.response },
  })
  const payload = isRecord(result.payload) ? result.payload : null
  const verified = payload && isRecord(payload.session) ? payload.session : null
  const user = payload && isRecord(payload.user) ? payload.user : null
  // 上游认证会创建临时登录会话，验证完成后立即销毁；
  // 敏感操作确认不能切换账号或替换当前会话 Cookie。
  if (verified && typeof verified.token === 'string') {
    const authContext = await auth.$context
    await authContext.internalAdapter.deleteSession(verified.token)
  }
  if (result.status >= 400 || !verified || user?.id !== session.user.id) {
    return jsonResponse({ message: '请使用当前账号的通行密钥进行验证。' }, 401)
  }
  const grant = await operationGrants.issue(
    { userId: session.user.id, sessionId: session.session.id },
    parsed.data,
    'passkey',
  )
  return jsonResponse(grant)
}
