import {
  chatHistoryListResponseSchema,
  chatHistoryPageResponseSchema,
  chatRenameResponseSchema,
} from '@velin/contracts/chat-validation'
import type {
  ChatHistoryDeleteRequest,
  ChatHistoryLoadRequest,
  ChatOrderRequest,
  ChatListRequest,
  ChatRenameRequest,
} from '@velin/contracts/chat-protocol'
import type {
  ConversationHistoryPage,
  ConversationListPage,
} from '@velin/contracts/chat'
import { errorMessage, UserFacingError } from '@velin/contracts/error-copy'
import { isRecord } from '@velin/contracts/value'
import { credentialScope, serviceUrl } from '../auth/auth-client'

const requestTimeoutMs = 15_000

function readError(value: unknown, fallback: string) {
  return errorMessage(value, fallback)
}

export class ChatHistoryClient {
  private readonly onUnauthorized: () => void

  constructor(onUnauthorized: () => void) {
    this.onUnauthorized = onUnauthorized
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const scope = credentialScope.capture()
    const response = await fetch(`${serviceUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Cookie: scope.cookie,
      },
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([
        scope.signal,
        AbortSignal.timeout(requestTimeoutMs),
      ]),
    })

    if (!scope.isCurrent()) {
      await response.body?.cancel().catch(() => {})
      throw new UserFacingError('登录状态已变化，请重新读取。')
    }
    if (response.status === 401) {
      await response.body?.cancel().catch(() => {})
      if (scope.isCurrent()) this.onUnauthorized()
      throw new UserFacingError('登录状态已过期，请重新登录。')
    }

    return response
  }

  async listConversations(
    request: ChatListRequest = {},
  ): Promise<ConversationListPage> {
    const parameters = new URLSearchParams(request)
    const response = await this.request(
      `/api/chat/conversations?${parameters}`,
      {
        method: 'GET',
      },
    )

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null)
      throw new UserFacingError(
        readError(body, '读取对话列表失败，请稍后重试。'),
      )
    }

    const parsed = chatHistoryListResponseSchema.safeParse(
      await response.json().catch(() => null),
    )
    if (!parsed.success) {
      throw new UserFacingError('对话列表返回的数据不完整，请重新读取。')
    }
    return parsed.data
  }

  async loadConversation(
    request: ChatHistoryLoadRequest,
  ): Promise<ConversationHistoryPage> {
    const url = new URL(
      `/api/chat/conversations/${encodeURIComponent(request.conversationId)}/messages`,
      serviceUrl,
    )
    if (request.before) url.searchParams.set('before', request.before)
    const response = await this.request(url.pathname + url.search, {
      method: 'GET',
    })

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null)
      throw new UserFacingError(readError(body, '读取对话失败，请稍后重试。'))
    }

    const parsed = chatHistoryPageResponseSchema.safeParse(
      await response.json().catch(() => null),
    )
    if (!parsed.success) {
      throw new UserFacingError('对话返回的数据不完整，请重新读取。')
    }
    return parsed.data
  }

  async deleteConversation(request: ChatHistoryDeleteRequest) {
    const response = await this.request(
      `/api/chat/conversations/${encodeURIComponent(request.conversationId)}`,
      { method: 'DELETE' },
    )

    if (response.status === 204) {
      await response.body?.cancel().catch(() => {})
      return
    }

    const body: unknown = await response.json().catch(() => null)
    if (response.status === 404) {
      throw new UserFacingError('该对话不存在或已被删除。')
    }
    if (!isRecord(body)) {
      throw new UserFacingError('删除对话失败，请稍后重试。')
    }
    throw new UserFacingError(readError(body, '删除对话失败，请稍后重试。'))
  }

  async renameConversation(request: ChatRenameRequest): Promise<string> {
    const response = await this.request(
      `/api/chat/conversations/${encodeURIComponent(request.conversationId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: request.title }),
      },
    )

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null)
      if (response.status === 404) {
        throw new UserFacingError('该对话不存在或已被删除。')
      }
      throw new UserFacingError(readError(body, '重命名对话失败，请稍后重试。'))
    }

    const parsed = chatRenameResponseSchema.safeParse(
      await response.json().catch(() => null),
    )
    if (!parsed.success) {
      throw new UserFacingError('对话返回的数据不完整，请重新读取。')
    }
    return parsed.data.title
  }

  async reorderConversations(request: ChatOrderRequest) {
    const response = await this.request('/api/chat/conversations/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    if (response.status === 204) {
      await response.body?.cancel().catch(() => {})
      return
    }

    const body: unknown = await response.json().catch(() => null)
    if (response.status === 409) {
      throw new UserFacingError('对话列表已变化，请重新读取后再排序。')
    }
    throw new UserFacingError(readError(body, '保存对话排序失败，请稍后重试。'))
  }
}
