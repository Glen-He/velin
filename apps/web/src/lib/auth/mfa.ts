import 'server-only'
import { twoFactor } from 'better-auth/plugins'
import { createAuthMiddleware } from 'better-auth/api'
import { config } from '../config'
import { isRecord } from '@velin/contracts/value'

const plugin = twoFactor({
  issuer: 'Velin',
  skipVerificationOnEnable: false,
  trustDeviceMaxAge: 60 * 60 * 24 * 30,
  backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: 'encrypted' },
  accountLockout: {
    enabled: true,
    maxFailedAttempts: 5,
    durationSeconds: 15 * 60,
  },
})

// 扩展公开 Hook 的匹配范围；挑战、Cookie、TOTP、恢复码与原子消费仍全部由库实现。
// 必须排在 Electron 交接插件前，未完成第二因素时不能签发桌面授权码。
export const multiFactorAuthentication = {
  ...plugin,
  hooks: {
    ...plugin.hooks,
    after: [
      ...plugin.hooks.after.map((hook) => ({
        ...hook,
        matcher: (context: Parameters<typeof hook.matcher>[0]) =>
          hook.matcher(context) ||
          context.path === '/sign-in/email-otp' ||
          context.path === '/sign-in/social' ||
          Boolean(context.path?.startsWith('/callback/')),
      })),
      {
        matcher: (context: { path?: string }) =>
          Boolean(context.path?.startsWith('/callback/')),
        handler: createAuthMiddleware(async (context) => {
          if (
            !isRecord(context.context.returned) ||
            !context.context.returned.twoFactorRedirect
          )
            return
          const original = context.context.responseHeaders?.get('location')
          const target = new URL(original ?? '/sign-in', config.appUrl)
          if (
            target.origin !== new URL(config.appUrl).origin ||
            target.pathname !== '/sign-in'
          ) {
            target.href = new URL('/sign-in', config.appUrl).href
          }
          target.searchParams.set('challenge', 'two-factor')
          throw context.redirect(target.href)
        }),
      },
    ],
  },
}
