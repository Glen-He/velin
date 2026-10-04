import {
  isValidNewPassword,
  passwordPolicyMessage,
} from '@velin/contracts/policy'
import { operationGrants } from './grants.js'
import type { BetterAuthPlugin } from 'better-auth'
import {
  APIError,
  createAuthEndpoint,
  sessionMiddleware,
} from 'better-auth/api'
import { z } from 'zod'

// better-auth 1.7.6 没有「会话已过强验证即可免旧密码换密码」的公开端点：
// /change-password 强制校验 currentPassword，server-only 的 setPassword
// 在账号已设密码时直接抛 PASSWORD_ALREADY_SET，
// 于是"用其他方式修改密码"只剩邮箱验证码一条通道。
// 这里按它自身 change-password 的实现补一条端点：哈希与写库都走 better-auth
// 内部的 ctx.context.password / internalAdapter，不自己实现任何密码学。
// 泄露口令检查由 haveIBeenPwned 包装 ctx.context.password.hash 完成，
// 因此该路径必须同时登记进 auth.ts 里插件的 paths 列表，漏登记等于静默放行。
export const setPasswordPath = '/password/set' as const

export const setPasswordPlugin: BetterAuthPlugin = {
  id: 'velin-set-password',
  endpoints: {
    // 路径必须用 createAuthEndpoint 的位置参数形式传：对象形式只会写进
    // endpoint.options.path，better-auth 建路由时读的是顶层 path，
    // 结果端点在 auth.api 里存在、HTTP 层 404。
    setPasswordWithOperationGrant: createAuthEndpoint(
      '/password/set',
      {
        method: 'POST',
        use: [sessionMiddleware],
        body: z.object({
          password: z
            .string()
            .refine(isValidNewPassword, passwordPolicyMessage),
        }),
      },
      async (context) => {
        const session = context.context.session
        const account =
          await context.context.internalAdapter.findCredentialAccount(
            session.user.id,
          )

        if (!account) {
          throw new APIError('BAD_REQUEST', {
            message: '这个账号还没有设置密码。',
          })
        }

        const passwordHash = await context.context.password.hash(
          context.body.password,
        )

        await context.context.internalAdapter.updateAccount(account.id, {
          password: passwordHash,
        })

        await operationGrants.revokeUser(session.user.id)
        try {
          const sessions = await context.context.internalAdapter.listSessions(
            session.user.id,
          )
          await Promise.all(
            sessions
              .filter((item) => item.token !== session.session.token)
              .map((item) =>
                context.context.internalAdapter.deleteSession(item.token),
              ),
          )
        } catch {
          throw new APIError('INTERNAL_SERVER_ERROR', {
            code: 'PASSWORD_UPDATED_SESSION_REVOCATION_FAILED',
            message: '密码已更新，但退出其他设备失败。请到登录设备页重试。',
          })
        }
        return context.json({ status: true })
      },
    ),
  },
}
