import { createVerificationLimiter } from './verification-limiter.js'
import { databasePool } from '../database.js'
import type { Hono } from 'hono'
import { z } from 'zod'
import { verificationIntentSchema } from '@velin/contracts/security'
import { isRecord } from '@velin/contracts/value'
import { auth } from '../auth.js'
import { config } from '../config.js'
import { readDevCode } from '../email.js'
import { operationRequirements } from './operation-policy.js'
import { operationGrants } from './grants.js'
import { callBetterAuth, forwardCookies } from './better-auth-call.js'
import { securityRequestGuard } from './request-origin.js'

const stepUpBody = verificationIntentSchema.safeExtend({
  method: z.enum(['emailOtp', 'totp', 'backupCode']),
  code: z.string().min(1).max(128),
})
const passkeyBody = verificationIntentSchema.safeExtend({
  response: z.record(z.string(), z.unknown()),
})

// The consuming verify-email endpoint owns code validation and atomic deletion.
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
export function registerSecurityRoutes(app: Hono) {
  app.use(
    '/api/security/*',
    securityRequestGuard([
      new URL(config.authWebUrl).origin,
      new URL(config.authBaseUrl).origin,
    ]),
  )
  app.get('/api/security/requirements', async (context) => {
    const session = await auth.api.getSession({
      headers: context.req.raw.headers,
    })
    if (!session) return context.json({ message: '请先登录。' }, 401)
    return context.json({ requirements: operationRequirements })
  })

  app.post('/api/security/step-up/email-code', async (context) => {
    const session = await auth.api.getSession({
      headers: context.req.raw.headers,
    })
    if (!session) return context.json({ message: '请先登录。' }, 401)
    if (config.isProduction) {
      const attempt = await limiter.attempt(session.user.id, 'send')
      if (!attempt.allowed) {
        context.header('Retry-After', String(attempt.retryAfterSeconds))
        return context.json(
          { code: 'RATE_LIMITED', message: '操作过于频繁，请稍后重试。' },
          429,
        )
      }
    }
    const result = await callBetterAuth('/email-otp/send-verification-otp', {
      method: 'POST',
      cookie: context.req.header('cookie') ?? '',
      body: { email: session.user.email, type: 'email-verification' },
    })
    if (result.status >= 400)
      return context.json(
        {
          code:
            result.status === 429 ? 'RATE_LIMITED' : 'EMAIL_DELIVERY_FAILED',
          message:
            result.status === 429
              ? '发送过于频繁，请稍后重试。'
              : '验证码发送失败，请稍后重试。',
        },
        result.status === 429 ? 429 : 400,
      )
    const devOtp = readDevCode(session.user.email)
    return context.json(devOtp ? { sent: true, devOtp } : { sent: true })
  })

  app.post('/api/security/step-up', async (context) => {
    const session = await auth.api.getSession({
      headers: context.req.raw.headers,
    })
    if (!session) return context.json({ message: '请先登录。' }, 401)
    const parsed = stepUpBody.safeParse(
      await context.req.json().catch(() => null),
    )
    if (!parsed.success)
      return context.json({ message: '验证参数不完整。' }, 400)
    if (
      !operationRequirements[parsed.data.operation].allowed.includes(
        parsed.data.method,
      )
    ) {
      return context.json({ message: '这次操作不支持所选验证方式。' }, 400)
    }
    if (
      (parsed.data.method === 'totp' || parsed.data.method === 'backupCode') &&
      !session.user.twoFactorEnabled
    ) {
      return context.json({ message: '当前账号尚未开启双重认证。' }, 400)
    }
    if (config.isProduction) {
      const attempt = await limiter.attempt(session.user.id, 'verify')
      if (!attempt.allowed) {
        context.header('Retry-After', String(attempt.retryAfterSeconds))
        return context.json(
          { code: 'RATE_LIMITED', message: '验证过于频繁，请稍后重试。' },
          429,
        )
      }
    }
    const result = await verifyCode(
      parsed.data,
      context.req.header('cookie') ?? '',
      session.user.email,
    )
    if (result.status >= 400)
      return context.json(
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
    const response = context.json(grant)
    forwardCookies(result.headers, response.headers)
    return response
  })

  app.post('/api/security/step-up/passkey-options', async (context) => {
    const session = await auth.api.getSession({
      headers: context.req.raw.headers,
    })
    if (!session) return context.json({ message: '请先登录。' }, 401)
    if (config.isProduction) {
      const attempt = await limiter.attempt(session.user.id, 'passkey-options')
      if (!attempt.allowed) {
        context.header('Retry-After', String(attempt.retryAfterSeconds))
        return context.json(
          { code: 'RATE_LIMITED', message: '操作过于频繁，请稍后重试。' },
          429,
        )
      }
    }
    const result = await callBetterAuth(
      '/passkey/generate-authenticate-options',
      {
        method: 'GET',
        cookie: context.req.header('cookie') ?? '',
      },
    )
    if (result.status >= 400 || !isRecord(result.payload)) {
      return context.json({ message: '无法发起通行密钥验证。' }, 400)
    }
    const response = context.json({
      ...result.payload,
      userVerification: 'required',
    })
    forwardCookies(result.headers, response.headers)
    return response
  })

  app.post('/api/security/step-up/passkey-verify', async (context) => {
    const session = await auth.api.getSession({
      headers: context.req.raw.headers,
    })
    if (!session) return context.json({ message: '请先登录。' }, 401)
    if (config.isProduction) {
      const attempt = await limiter.attempt(session.user.id, 'verify')
      if (!attempt.allowed) {
        context.header('Retry-After', String(attempt.retryAfterSeconds))
        return context.json(
          { code: 'RATE_LIMITED', message: '操作过于频繁，请稍后重试。' },
          429,
        )
      }
    }
    const parsed = passkeyBody.safeParse(
      await context.req.json().catch(() => null),
    )
    if (!parsed.success)
      return context.json({ message: '缺少通行密钥断言或操作。' }, 400)
    const result = await callBetterAuth('/passkey/verify-authentication', {
      method: 'POST',
      cookie: context.req.header('cookie') ?? '',
      body: { response: parsed.data.response },
    })
    const payload = isRecord(result.payload) ? result.payload : null
    const verified =
      payload && isRecord(payload.session) ? payload.session : null
    const user = payload && isRecord(payload.user) ? payload.user : null
    // Upstream authentication creates a temporary login session. Dispose it;
    // step-up never switches accounts or replaces the existing session cookie.
    if (verified && typeof verified.token === 'string') {
      const authContext = await auth.$context
      await authContext.internalAdapter.deleteSession(verified.token)
    }
    if (result.status >= 400 || !verified || user?.id !== session.user.id) {
      return context.json(
        { message: '请使用当前账号的通行密钥进行验证。' },
        401,
      )
    }
    const grant = await operationGrants.issue(
      { userId: session.user.id, sessionId: session.session.id },
      parsed.data,
      'passkey',
    )
    return context.json(grant)
  })
}
