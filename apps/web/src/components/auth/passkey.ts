import { requestJson, ApiError } from '../../lib/http/client'
import { isRecord } from '@velin/contracts/value'

const promptTimeoutMs = 60_000

let pendingController: AbortController | null = null

// 开始其他凭据操作前取消条件自动填充；
// 每条退出路径都清理监听与计时器，避免旧超时取消新流程。
async function withCredential<T>(
  parent: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  pendingController?.abort()
  const controller = new AbortController()
  pendingController = controller
  let timedOut = false
  const cancel = () => controller.abort()
  if (parent?.aborted) cancel()
  parent?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    cancel()
  }, promptTimeoutMs)
  let rejectAbort: (() => void) | undefined
  try {
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () =>
        reject(
          new ApiError(
            timedOut
              ? '通行密钥请求超时。请重试，或改用密码、邮箱验证码或验证器。'
              : '通行密钥操作已取消。',
            0,
            'CREDENTIAL_CANCELLED',
          ),
        )
      if (controller.signal.aborted) rejectAbort()
      else
        controller.signal.addEventListener('abort', rejectAbort, { once: true })
    })
    controller.signal.throwIfAborted()
    return await Promise.race([run(controller.signal), aborted])
  } catch (cause) {
    if (cause instanceof ApiError) throw cause
    if (controller.signal.aborted)
      throw new ApiError('通行密钥操作已取消。', 0, 'CREDENTIAL_CANCELLED')
    throw new ApiError(
      '通行密钥操作未完成。请重试或换一种验证方式。',
      0,
      'CREDENTIAL_FAILED',
    )
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', cancel)
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort)
    if (pendingController === controller) pendingController = null
  }
}

function objectResponse(data: unknown): Record<string, unknown> {
  if (!isRecord(data)) throw new Error('invalid response')
  return data
}

export async function authenticatePasskey({
  optionsPath = '/api/auth/passkey/generate-authenticate-options',
  verifyPath = '/api/auth/passkey/verify-authentication',
  signal,
  body = {},
  query,
  mediation,
}: {
  optionsPath?: string
  verifyPath?: string
  signal?: AbortSignal
  body?: Record<string, unknown>
  query?: Record<string, string>
  mediation?: CredentialMediationRequirement
}) {
  return withCredential(signal, async (requestSignal) => {
    const options = await requestJson(optionsPath, objectResponse, {
      method: optionsPath.startsWith('/api/security/') ? 'POST' : 'GET',
      signal: requestSignal,
      ...(optionsPath.startsWith('/api/security/') ? { body: '{}' } : {}),
    })
    if (
      typeof PublicKeyCredential === 'undefined' ||
      typeof PublicKeyCredential.parseRequestOptionsFromJSON !== 'function'
    ) {
      throw new ApiError(
        '请使用支持通行密钥的新版系统浏览器。',
        0,
        'UNSUPPORTED_BROWSER',
      )
    }
    const credential = await navigator.credentials.get({
      publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(
        options as unknown as PublicKeyCredentialRequestOptionsJSON,
      ),
      ...(mediation ? { mediation } : {}),
      signal: requestSignal,
    })
    if (!(credential instanceof PublicKeyCredential))
      throw new Error('cancelled')
    const suffix = query ? `?${new URLSearchParams(query)}` : ''
    return requestJson(`${verifyPath}${suffix}`, objectResponse, {
      method: 'POST',
      signal: requestSignal,
      body: JSON.stringify({ ...body, response: credential.toJSON() }),
    })
  })
}

export async function registerPasskey(
  headers: HeadersInit,
  signal?: AbortSignal,
) {
  return withCredential(signal, async (requestSignal) => {
    const options = await requestJson(
      '/api/auth/passkey/generate-register-options',
      objectResponse,
      { signal: requestSignal },
    )
    if (
      typeof PublicKeyCredential === 'undefined' ||
      typeof PublicKeyCredential.parseCreationOptionsFromJSON !== 'function'
    ) {
      throw new ApiError(
        '请使用支持通行密钥的新版系统浏览器。',
        0,
        'UNSUPPORTED_BROWSER',
      )
    }
    const credential = await navigator.credentials.create({
      publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(
        options as unknown as PublicKeyCredentialCreationOptionsJSON,
      ),
      signal: requestSignal,
    })
    if (!(credential instanceof PublicKeyCredential))
      throw new Error('cancelled')
    return requestJson(
      '/api/auth/passkey/verify-registration',
      objectResponse,
      {
        method: 'POST',
        headers,
        signal: requestSignal,
        body: JSON.stringify({
          response: credential.toJSON(),
          name: '通行密钥',
        }),
      },
    )
  })
}
