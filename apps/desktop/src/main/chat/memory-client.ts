import {
  memoryStateSchema,
  conversationVersionsSchema,
  type MemoryAction,
  type ConversationVersionRequest,
} from '@velin/contracts/memory'
import { UserFacingError } from '@velin/contracts/error-copy'
import { credentialScope, serviceUrl } from '../auth/auth-client'

export class ChatMemoryClient {
  private readonly onUnauthorized: () => void
  constructor(onUnauthorized: () => void) {
    this.onUnauthorized = onUnauthorized
  }
  private async request(path: string, body?: unknown) {
    const scope = credentialScope.capture()
    const response = await fetch(`${serviceUrl}/api/chat/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'omit',
      redirect: 'error',
      headers: {
        Cookie: scope.cookie,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([scope.signal, AbortSignal.timeout(15_000)]),
    })
    const value: unknown =
      response.status === 204 ? null : await response.json().catch(() => null)
    if (!scope.isCurrent())
      throw new UserFacingError('登录状态已变化，请重新读取。')
    if (response.status === 401) {
      this.onUnauthorized()
      throw new UserFacingError('请先登录。')
    }
    if (!response.ok) {
      const message =
        value &&
        typeof value === 'object' &&
        'message' in value &&
        typeof value.message === 'string' &&
        value.message.length < 200
          ? value.message
          : '操作失败，请稍后重试。'
      throw new UserFacingError(message)
    }
    return value
  }
  async read() {
    return memoryStateSchema.parse(await this.request('memory'))
  }
  async update(action: MemoryAction) {
    return memoryStateSchema.parse(await this.request('memory', action))
  }
  async versions(input: ConversationVersionRequest) {
    return conversationVersionsSchema.parse(
      await this.request(`conversations/${input.conversationId}/versions`),
    )
  }
  async restore(input: ConversationVersionRequest) {
    await this.request(`conversations/${input.conversationId}/versions`, {
      versionId: input.versionId,
    })
  }
}
