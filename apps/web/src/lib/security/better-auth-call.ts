import { markInternalVerification } from './internal-request'
import { auth } from '../auth/server'
import { config } from '../config'

export async function callBetterAuth(
  path: string,
  request: {
    method: 'GET' | 'POST'
    cookie: string
    body?: unknown
  },
) {
  const headers = new Headers({
    cookie: request.cookie,
    'content-type': 'application/json',
    origin: config.appUrl,
    referer: `${config.appUrl}/`,
  })
  markInternalVerification(headers)
  const response = await auth.handler(
    new Request(new URL(`/api/auth${path}`, config.appUrl), {
      method: request.method,
      headers,
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
    }),
  )
  const payload: unknown = await response.json().catch(() => null)
  return { status: response.status, payload, headers: response.headers }
}

export function forwardCookies(from: Headers, to: Headers) {
  for (const value of from.getSetCookie()) to.append('set-cookie', value)
}
