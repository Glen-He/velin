import type { MiddlewareHandler } from 'hono'

export function securityRequestGuard(
  trustedOrigins: readonly string[],
): MiddlewareHandler {
  return async (context, next) => {
    if (context.req.method === 'GET') return next()
    const origin = context.req.header('origin')
    const contentType = context.req
      .header('content-type')
      ?.split(';', 1)[0]
      .trim()
    if (
      !origin ||
      !trustedOrigins.includes(origin) ||
      contentType !== 'application/json'
    ) {
      return context.json(
        { code: 'INVALID_ORIGIN', message: '请求来源或格式无效。' },
        403,
      )
    }
    return next()
  }
}
