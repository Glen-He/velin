import { markInternalVerification } from './internal-request.js'
import { auth } from '../auth.js'
import { config } from '../config.js'

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
    origin: config.authWebUrl,
    referer: `${config.authWebUrl}/`,
  })
  markInternalVerification(headers)
  const response = await auth.handler(
    new Request(new URL(`/api/auth${path}`, config.authBaseUrl), {
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
