import { errorMessage } from '../shared'
import { isRecord } from '@velin/contracts/value'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export async function requestJson<T>(
  path: string,
  parse: (data: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  let response: Response
  try {
    response = await fetch(path, { credentials: 'include', ...init, headers })
  } catch (cause) {
    if (init?.signal?.aborted) throw cause
    throw new ApiError('无法连接服务，请检查网络后重试。', 0, 'NETWORK_ERROR')
  }
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.message === 'string'
        ? payload.message
        : '操作没有完成，请稍后重试。'
    const code =
      isRecord(payload) && typeof payload.code === 'string'
        ? payload.code
        : `HTTP_${response.status}`
    throw new ApiError(message, response.status, code)
  }
  try {
    return parse(payload)
  } catch {
    throw new ApiError(
      '服务返回的数据不完整，请稍后重试。',
      response.status,
      'INVALID_RESPONSE',
    )
  }
}

export function actionErrorMessage(cause: unknown): string {
  return errorMessage(
    isRecord(cause) && typeof cause.message === 'string'
      ? { message: cause.message }
      : null,
  )
}

export function isStepUpRequired(cause: unknown): boolean {
  if (!isRecord(cause)) return false
  if (cause.code === 'STEP_UP_REQUIRED') return true
  return isRecord(cause.body) && cause.body.code === 'STEP_UP_REQUIRED'
}
