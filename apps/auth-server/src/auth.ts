import { electron } from '@better-auth/electron'
import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { emailOTP, haveIBeenPwned, twoFactor } from 'better-auth/plugins'
import { config } from './config.js'
import { databasePool } from './database.js'
import { sendAuthenticationEmail } from './email.js'
import { isValidDisplayName, isValidNewPassword } from './registration-policy.js'

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
      message: '密码需为 8–32 位英文字母、数字或符号。',
    })
  }
}

export const auth = betterAuth({
  appName: 'Velin',
  baseURL: config.authBaseUrl,
  secret: config.authSecret,
  database: databasePool,
  trustedOrigins: [config.authWebUrl, 'com.velin.desktop:/'],
  hooks: {
    before: createAuthMiddleware(async (context) => {
      const passwordField =
        context.path === '/sign-up/email' ||
        context.path === '/email-otp/reset-password'
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
        // Better Auth's email endpoint requires a name. Only the server assigns it.
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
    minPasswordLength: 8,
    // Keep old credentials usable at sign-in; the hook limits new passwords to 32.
    maxPasswordLength: 256,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
  },
  socialProviders,
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: 'database',
    customRules: {
      '/sign-in/email': { window: 10, max: 3 },
      '/sign-up/email': { window: 60, max: 3 },
      '/sign-in/email-otp': { window: 60, max: 5 },
      '/email-otp/send-verification-otp': { window: 60, max: 3 },
      '/two-factor/*': { window: 60, max: 5 },
    },
  },
  advanced: {
    cookiePrefix: 'velin-auth',
    database: {
      joins: true,
    },
  },
  plugins: [
    haveIBeenPwned({
      customPasswordCompromisedMessage:
        '这个密码已出现在公开泄露数据中，请换一个更安全的密码。',
    }),
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
      overrideDefaultEmailVerification: true,
      sendVerificationOnSignUp: true,
      async sendVerificationOTP({ email, otp, type }) {
        const purpose =
          type === 'sign-in'
            ? '登录'
            : type === 'forget-password'
              ? '重置密码'
              : '验证邮箱'

        await sendAuthenticationEmail({
          to: email,
          subject: `${otp} 是你的 Velin ${purpose}验证码`,
          text: `你的 Velin ${purpose}验证码是：${otp}\n\n验证码将在 5 分钟后失效。如果不是你本人操作，请忽略这封邮件。`,
        })
      },
    }),
    passkey({
      rpID: config.passkeyRpId,
      rpName: 'Velin',
      origin: config.authWebUrl,
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
