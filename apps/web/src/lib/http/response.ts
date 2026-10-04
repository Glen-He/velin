export function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
) {
  return Response.json(body, { status, headers })
}
export function rateLimitedResponse(
  retryAfterSeconds: number,
  message: string,
) {
  return jsonResponse({ code: 'RATE_LIMITED', message }, 429, {
    'Retry-After': String(retryAfterSeconds),
  })
}
