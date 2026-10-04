import { jsonResponse } from '../http/response'

export function securityRequestGuard(
  request: Request,
  trustedOrigins: readonly string[],
): Response | null {
  if (request.method === 'GET') return null
  const origin = request.headers.get('origin')
  const contentType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    .trim()
  if (
    !origin ||
    !trustedOrigins.includes(origin) ||
    contentType !== 'application/json'
  ) {
    return jsonResponse(
      { code: 'INVALID_ORIGIN', message: '请求来源或格式无效。' },
      403,
    )
  }
  return null
}
