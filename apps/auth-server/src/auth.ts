import { isInternalVerification } from './security/internal-request.js'
import { electron } from '@better-auth/electron'
import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { emailOTP, haveIBeenPwned, twoFactor } from 'better-auth/plugins'
import { config } from './config.js'
import { databasePool } from './database.js'
import { rememberDevCode, sendAuthenticationEmail } from './email.js'
import { logger } from './logging.js'
import {
  isValidDisplayName,
  isValidNewPassword,
} from './registration-policy.js'
import {
  operationByPath,
  operationRequirements,
} from './security/operation-policy.js'
import { operationGrants } from './security/grants.js'
import { recordLoginMethod, type AuthMethod } from './security/session-audit.js'
import {
  operationGrantHeader,
  operationGrantSchema,
} from '@velin/contracts/security'
import { passwordPolicy, passwordPolicyMessage } from '@velin/contracts/policy'
import { setPasswordPath, setPasswordPlugin } from './security/set-password.js'
import { requiredDeliveryPlugin } from './security/required-delivery.js'
import { clientAddressHeader } from './security/auth-request.js'

// 登录方式只作记录，敏感操作另需一次性操作授权。
const loginMethodByPath: Record<string, AuthMethod> = {
  '/sign-in/email': 'password',
  '/sign-in/email-otp': 'emailOtp',
  '/passkey/verify-authentication': 'passkey',
  '/two-factor/verify-totp': 'totp',
}

// 凭据变更后作废该用户尚未消费的操作授权。
const credentialResetPaths = new Set([
  '/change-password',
  '/change-email',
  '/email-otp/change-email',
  '/two-factor/enable',
  '/two-factor/disable',
  '/passkey/verify-registration',
  '/passkey/delete-passkey',
])

const socialProviders = config.google
  ? {
      google: {
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
        disableSignUp: true,
      },
    }
  : undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validateNewPassword(password: unknown) {
  if (!isValidNewPassword(password)) {
    throw APIError.fromStatus('BAD_REQUEST', {
      message: passwordPolicyMessage,
    })
  }
}

export const auth = betterAuth({
  logger: {
    log(level, _message, ...details: unknown[]) {
      // 库可能把用户文案和完整请求放在参数里，只记录稳定事件与错误摘要。
      logger.write(level, 'auth.library_event', {
        error: details.find((value) => value instanceof Error),
      })
    },
  },
  appName: 'Velin',
  baseURL: config.authBaseUrl,
  secret: config.authSecret,
  database: databasePool,
  trustedOrigins: [config.authWebUrl, 'com.velin.desktop:/'],
  hooks: {
    before: createAuthMiddleware(async (context) => {
      const operation = operationByPath[context.path]
      if (operation) {
        const session = await auth.api.getSession({
          headers: context.headers ?? new Headers(),
        })
        if (!session)
          throw APIError.fromStatus('UNAUTHORIZED', {
            message: '请先登录后再继续。',
          })
        const id = context.headers?.get(operationGrantHeader) ?? ''
        const target =
          operation === 'removePasskey' &&
          isRecord(context.body) &&
          typeof context.body.id === 'string'
            ? context.body.id
            : ''
        const accepted =
          operationGrantSchema.shape.id.safeParse(id).success &&
          (await operationGrants.consume({
            id,
            userId: session.user.id,
            sessionId: session.session.id,
            operation,
            target,
          }))
        if (!accepted)
          throw APIError.fromStatus('UNAUTHORIZED', {
            message: '请重新验证后继续。',
            code: 'STEP_UP_REQUIRED',
            body: {
              code: 'STEP_UP_REQUIRED',
              allowed: operationRequirements[operation].allowed,
            },
          })
      }

      const passwordField =
        context.path === '/sign-up/email' ||
        context.path === '/email-otp/reset-password' ||
        context.path === setPasswordPath
          ? 'password'
          : context.path === '/reset-password' ||
              context.path === '/change-password' ||
              context.path === '/set-password'
            ? 'newPassword'
            : null
      if (passwordField && isRecord(context.body)) {
        validateNewPassword(context.body[passwordField])
      }

      if (context.path === '/sign-up/email' && isRecord(context.body)) {
        // Better Auth 邮箱入口要求 name，最终名称仅由服务端赋值。
        return {
          context: {
            ...context,
            body: {
              ...context.body,
              name: 'Velin 用户',
            },
          },
        }
      }

      if (
        context.path === '/update-user' &&
        isRecord(context.body) &&
        'name' in context.body
      ) {
        const name = context.body.name

        if (!isValidDisplayName(name)) {
          throw APIError.fromStatus('BAD_REQUEST', {
            message: '用户名需为 1–32 个可见字符。',
          })
        }

        return {
          context: {
            ...context,
            body: {
              ...context.body,
              name: name.trim(),
            },
          },
        }
      }
    }),
    after: createAuthMiddleware(async (context) => {
      const method = loginMethodByPath[context.path]
      const created = context.context.newSession

      if (method && created) {
        await recordLoginMethod(created.session.id, method)
      }

      if (
        context.context.returned instanceof APIError ||
        !credentialResetPaths.has(context.path)
      ) {
        return
      }

      // 写入端点可能轮换并删除请求原会话。
      // 从中间件上下文读取身份，不能再次依赖已经失效的 Cookie。
      const userId =
        context.context.newSession?.user.id ?? context.context.session?.user.id
      if (userId) await operationGrants.revokeUser(userId)
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: {
            ...user,
            name: user.email,
          },
        }),
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: passwordPolicy.minimum,
    // 登录兼容已有凭据，新密码由共享策略验证。
    maxPasswordLength: 256,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
  },
  socialProviders,
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    // 0 关闭 better-auth 的新鲜度闸门：它比较的是 session.createdAt 到现在的
    // 整段会话年龄，而不是“上次强验证时间”，会话有效期 30 天会让任何低于会话
    // 年龄的取值会随会话变旧而锁死写入。敏感操作由独立、逐次消费的
    // operation grant 保护，不能依赖会话年龄代替授权。
    freshAge: 0,
    // 登录方式仅作为审计元数据，授权不存储在会话上。
    additionalFields: {
      amr: { type: 'string', required: false, input: false },
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
    },
  },
  rateLimit: {
    // 限流是防对外服务的暴力尝试的；本地开发没有攻击者，只会把正在走流程的人锁在
    // 「尝试次数过多」上（开发态本来就允许明文回码、5 秒重发冷却）。
    // 所以开发态整体关闭，生产仍按下面的 customRules 逐端点执行。
    enabled: config.isProduction,
    window: 60,
    max: 100,
    storage: 'database',
    customRules: {
      // 3 次/10 秒会让人输错两遍密码就被锁，放宽到 5 次/分钟；
      // 暴力破解由 twoFactor 的 accountLockout 与密码校验本身兜底。
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
      '/sign-in/email-otp': { window: 60, max: 5 },
      '/email-otp/send-verification-otp': (request) =>
        isInternalVerification(request) ? false : { window: 60, max: 3 },
      '/email-otp/verify-email': (request, rule) =>
        isInternalVerification(request) ? false : rule,
      '/two-factor/*': (request) =>
        isInternalVerification(request) ? false : { window: 60, max: 5 },
      '/passkey/*': (request, rule) =>
        isInternalVerification(request) ? false : rule,
    },
  },
  advanced: {
    ipAddress: {
      ipAddressHeaders: [clientAddressHeader],
      trustedProxies: config.trustedProxyAddresses,
    },
    cookiePrefix: 'velin-auth',
    database: {
      joins: true,
    },
  },
  plugins: [
    requiredDeliveryPlugin,
    // 写密码的端点必须全部列进来：插件是按当前路径决定是否做泄露口令检查的，
    // 漏一条就等于那条路径静默不检查。
    haveIBeenPwned({
      paths: [
        '/sign-up/email',
        '/change-password',
        '/reset-password',
        '/email-otp/reset-password',
        setPasswordPath,
      ],
      customPasswordCompromisedMessage:
        '这个密码已出现在公开泄露数据中，请换一个更安全的密码。',
    }),
    setPasswordPlugin,
    electron({
      clientID: 'velin-desktop',
      codeExpiresIn: 300,
      redirectCookieExpiresIn: 120,
      cookiePrefix: 'velin-auth',
    }),
    emailOTP({
      disableSignUp: true,
      expiresIn: 300,
      allowedAttempts: 5,
      storeOTP: 'hashed',
      changeEmail: {
        enabled: true,
        // 关闭上游的"当前邮箱回码"这一步：它的验证码和卡片的强验证是同一封
        // 邮件，由 verify-email 原子消费；操作另需一次性授权。
        // 当前邮箱验证码或已配置的其他方法提供操作要求的证据，
        // /email-otp/change-email 在最终写入前原子消费本次授权。
        verifyCurrentEmail: false,
      },
      overrideDefaultEmailVerification: true,
      sendVerificationOnSignUp: true,
      async sendVerificationOTP({ email, otp, type }) {
        const purpose =
          type === 'sign-in'
            ? '登录'
            : type === 'forget-password'
              ? '重置密码'
              : '验证邮箱'

        try {
          await sendAuthenticationEmail({
            to: email,
            purpose: type,
            subject: `${otp} 是你的 Velin ${purpose}验证码`,
            text: `你的 Velin ${purpose}验证码是：${otp}\n\n验证码将在 5 分钟后失效。如果不是你本人操作，请忽略这封邮件。`,
          })
          rememberDevCode(email, otp)
        } catch {
          throw APIError.fromStatus('INTERNAL_SERVER_ERROR', {
            code: 'EMAIL_DELIVERY_FAILED',
            message: '验证码发送失败，请稍后重试。',
          })
        }
      },
    }),
    passkey({
      rpID: config.passkeyRpId,
      rpName: 'Velin',
      origin: config.authWebUrl,
      authentication: {
        afterVerification({ verification }) {
          if (!verification.authenticationInfo.userVerified) {
            throw APIError.fromStatus('UNAUTHORIZED', {
              message: '请完成通行密钥的用户验证。',
            })
          }
        },
      },
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
    }),
    twoFactor({
      issuer: 'Velin',
      skipVerificationOnEnable: false,
      trustDeviceMaxAge: 60 * 60 * 24 * 30,
      backupCodeOptions: {
        amount: 10,
        length: 10,
        storeBackupCodes: 'encrypted',
      },
      accountLockout: {
        enabled: true,
        maxFailedAttempts: 5,
        durationSeconds: 15 * 60,
      },
    }),
  ],
})
