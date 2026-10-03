import { z } from 'zod'
import { isIP } from 'node:net'

const optionalEnvironmentString = (minimumLength = 1) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(minimumLength).optional(),
  )

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    HOST: z.string().min(1).default('127.0.0.1'),
    TRUSTED_PROXY_ADDRESSES: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      )
      .pipe(
        z.array(
          z
            .string()
            .refine(
              (value) => isIP(value) !== 0,
              '代理地址必须为具体 IP 地址。',
            ),
        ),
      ),
    DATABASE_URL: z
      .string()
      .min(1)
      .default('postgresql://glen@localhost:5432/velin_dev'),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
    AUTH_WEB_URL: z.url().default('http://localhost:5174'),
    PASSKEY_RP_ID: z.string().min(1).default('localhost'),
    GOOGLE_CLIENT_ID: optionalEnvironmentString(),
    GOOGLE_CLIENT_SECRET: optionalEnvironmentString(),
    EMAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
    EMAIL_FROM: z.string().min(3).default('Velin <no-reply@velin.local>'),
    SMTP_HOST: optionalEnvironmentString(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default(false),
    SMTP_USER: optionalEnvironmentString(),
    SMTP_PASSWORD: optionalEnvironmentString(),
    DEEPSEEK_API_KEY: optionalEnvironmentString(),
    CHAT_DAILY_LIMIT_PER_USER: z.coerce.number().int().min(1).default(30),
    CHAT_DAILY_LIMIT_GLOBAL: z.coerce.number().int().min(1).default(300),
    CHAT_MINUTE_LIMIT_PER_USER: z.coerce.number().int().min(1).default(5),
  })
  .superRefine((environment, context) => {
    const hasGoogleClientId = environment.GOOGLE_CLIENT_ID !== undefined
    const hasGoogleClientSecret = environment.GOOGLE_CLIENT_SECRET !== undefined

    if (hasGoogleClientId !== hasGoogleClientSecret) {
      context.addIssue({
        code: 'custom',
        message: 'GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET 必须同时配置。',
        path: ['GOOGLE_CLIENT_ID'],
      })
    }

    if (
      environment.EMAIL_TRANSPORT === 'smtp' &&
      (!environment.SMTP_HOST ||
        !environment.SMTP_USER ||
        !environment.SMTP_PASSWORD)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'SMTP 模式必须配置 SMTP_HOST、SMTP_USER 和 SMTP_PASSWORD。',
        path: ['SMTP_HOST'],
      })
    }

    if (
      environment.NODE_ENV === 'production' &&
      environment.EMAIL_TRANSPORT !== 'smtp'
    ) {
      context.addIssue({
        code: 'custom',
        message: '生产环境必须使用 SMTP 邮件传输，禁止输出验证码到控制台。',
        path: ['EMAIL_TRANSPORT'],
      })
    }

    if (
      environment.NODE_ENV === 'production' &&
      (!hasGoogleClientId || !hasGoogleClientSecret)
    ) {
      context.addIssue({
        code: 'custom',
        message: '生产环境启用 Google 登录前必须配置完整 OAuth 凭据。',
        path: ['GOOGLE_CLIENT_ID'],
      })
    }

    if (
      environment.NODE_ENV === 'production' &&
      (!environment.BETTER_AUTH_URL.startsWith('https://') ||
        !environment.AUTH_WEB_URL.startsWith('https://'))
    ) {
      context.addIssue({
        code: 'custom',
        message: '生产环境认证入口和认证页面必须使用 HTTPS。',
        path: ['BETTER_AUTH_URL'],
      })
    }

    if (
      environment.NODE_ENV === 'production' &&
      !environment.DEEPSEEK_API_KEY
    ) {
      context.addIssue({
        code: 'custom',
        message: '生产环境必须配置 DeepSeek API Key。',
        path: ['DEEPSEEK_API_KEY'],
      })
    }
  })

const parsedEnvironment = environmentSchema.safeParse(process.env)

if (!parsedEnvironment.success) {
  const description = parsedEnvironment.error.issues
    .map((issue) => `${issue.path.join('.') || '环境变量'}：${issue.message}`)
    .join('\n')
  throw new Error(`认证服务配置无效：\n${description}`)
}

const environment = parsedEnvironment.data

export const config = {
  nodeEnvironment: environment.NODE_ENV,
  isProduction: environment.NODE_ENV === 'production',
  port: environment.PORT,
  host: environment.HOST,
  trustedProxyAddresses: environment.TRUSTED_PROXY_ADDRESSES,
  databaseUrl: environment.DATABASE_URL,
  authSecret: environment.BETTER_AUTH_SECRET,
  authBaseUrl: environment.BETTER_AUTH_URL.replace(/\/$/, ''),
  authWebUrl: environment.AUTH_WEB_URL.replace(/\/$/, ''),
  serveAuthWeb:
    new URL(environment.BETTER_AUTH_URL).origin ===
    new URL(environment.AUTH_WEB_URL).origin,
  passkeyRpId: environment.PASSKEY_RP_ID,
  google:
    environment.GOOGLE_CLIENT_ID && environment.GOOGLE_CLIENT_SECRET
      ? {
          clientId: environment.GOOGLE_CLIENT_ID,
          clientSecret: environment.GOOGLE_CLIENT_SECRET,
        }
      : null,
  email: {
    transport: environment.EMAIL_TRANSPORT,
    from: environment.EMAIL_FROM,
    smtp: {
      host: environment.SMTP_HOST,
      port: environment.SMTP_PORT,
      secure: environment.SMTP_SECURE,
      user: environment.SMTP_USER,
      password: environment.SMTP_PASSWORD,
    },
  },
  chat: {
    deepseekApiKey: environment.DEEPSEEK_API_KEY ?? null,
    model: 'deepseek-flash',
    dailyLimitPerUser: environment.CHAT_DAILY_LIMIT_PER_USER,
    dailyLimitGlobal: environment.CHAT_DAILY_LIMIT_GLOBAL,
    minuteLimitPerUser: environment.CHAT_MINUTE_LIMIT_PER_USER,
  },
} as const
