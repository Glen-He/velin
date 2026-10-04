import 'server-only'
import { auth } from './server'
import { rateLimitedResponse } from '../http/response'

export async function handleAuthentication(request: Request) {
  const response = await auth.handler(request)
  if (response.status !== 429) return response
  // 库使用 X-Retry-After；HTTP 出口统一为标准等待秒数与本地化反馈。
  const seconds = Number(
    response.headers.get('Retry-After') ??
      response.headers.get('X-Retry-After'),
  )
  return rateLimitedResponse(
    Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 60,
    '尝试次数过多，请稍后重试。',
  )
}
