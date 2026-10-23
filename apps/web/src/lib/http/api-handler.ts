import 'server-only'
import { limitRequestBody } from './body-limit'
import { jsonResponse } from './response'
import { logger } from '../logging'
import { requestContext } from './request-context'

// Route Handler 共用边界；请求体在业务解析前限制大小，Cookie 写入口额外校验 Origin。
export function withApiBoundary<T = unknown>(
  handler: (request: Request, context: T) => Response | Promise<Response>,
  options: { security?: boolean } = {},
) {
  return async (request: Request, context: T) => {
    const requestId = crypto.randomUUID()
    const startedAt = performance.now()
    return requestContext.run({ requestId }, async () => {
      const execute = async () => {
        try {
          const bounded = await limitRequestBody(request)
          if (bounded instanceof Response) return bounded
          if (options.security) {
            const { config } = await import('../config')
            const { securityRequestGuard } = await import(
              '../security/request-origin'
            )
            const rejected = securityRequestGuard(bounded, [
              new URL(config.appUrl).origin,
            ])
            if (rejected) return rejected
          }
          return await handler(bounded, context)
        } catch (error) {
          logger.error('http.request_failed', { error })
          return jsonResponse({ message: '服务暂时不可用，请稍后重试。' }, 500)
        }
      }
      const response = await execute()
      response.headers.set('X-Request-ID', requestId)
      logger.info('http.completed', {
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      })
      return response
    })
  }
}
