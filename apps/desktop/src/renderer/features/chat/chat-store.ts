import {
  conversationTitle,
  defaultChatModel,
  defaultReasoningEffort,
} from '@velin/contracts/chat'
import type {
  ChatModelId,
  Conversation,
  ConversationHistoryPage,
  ConversationSummary,
  Message,
  MessageAttachment,
  MessageStatus,
  ReasoningEffortId,
} from '@velin/contracts/chat'
import type {
  ChatEvent,
  SendMessageRequest,
  StopMessageRequest,
} from '@velin/contracts/chat-protocol'
import type { VelinApi } from '@velin/contracts/velin-api'
import { chatLimits } from '@velin/contracts/policy'

type ActiveRequest = {
  requestId: string
  conversationId: string
  messageId?: string
  previousConversation?: Conversation
  generatedTitleAllowed?: false
}
export type ChatSendOptions = {
  model: ChatModelId
  reasoningEffort: ReasoningEffortId
  attachments?: MessageAttachment[]
}
const defaultSendOptions: ChatSendOptions = {
  model: defaultChatModel,
  reasoningEffort: defaultReasoningEffort,
}
export type ChatHistoryStatus =
  | 'idle'
  | 'loading'
  | 'restoring'
  | 'loaded'
  | 'error'
export type ChatHistoryState = {
  revision?: string
  status: ChatHistoryStatus
  error?: string
  hasMore: boolean
  nextBefore: string | null
}
export type ChatState = {
  conversationRevision: number
  conversations: Conversation[]
  activeConversationId: string | null
  requests: Record<string, ActiveRequest>
  errors: Record<string, string | undefined>
  history: Record<string, ChatHistoryState>
}

const initialHistory = (): ChatHistoryState => ({
  status: 'idle',
  hasMore: false,
  nextBefore: null,
})

const emptyState = (): ChatState => ({
  conversationRevision: 0,
  conversations: [],
  activeConversationId: null,
  requests: {},
  errors: {},
  history: {},
})

function setMessageStatus(
  messages: Message[],
  messageId: string | undefined,
  status: MessageStatus,
) {
  if (!messageId) return messages
  return messages.map((message) =>
    message.id === messageId ? { ...message, status } : message,
  )
}

// 流式状态转换都基于同一份同步状态，React 读取快照；
// 不维护可能与已渲染对话不一致的平行 ref。
export function applyChatEvent(
  state: ChatState,
  event: ChatEvent,
  now: number,
): ChatState {
  const request = state.requests[event.conversationId]
  if (!request || request.requestId !== event.requestId) return state
  if (event.type === 'context-ready') {
    if (request.messageId !== event.messageId) return state
    return {
      ...state,
      conversations: state.conversations.map((conversation) =>
        conversation.id !== event.conversationId
          ? conversation
          : {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === event.messageId
                  ? {
                      ...message,
                      context: event.context,
                      model: event.model,
                      reasoningEffort: event.reasoningEffort,
                    }
                  : message,
              ),
            },
      ),
    }
  }
  if (event.type === 'message-start') {
    if (request.messageId) return state // 重复开始事件不能追加第二条回复。
    return {
      ...state,
      conversationRevision:
        state.conversationRevision +
        (state.conversations.find((item) => item.id === event.conversationId)
          ?.isPersisted
          ? 0
          : 1),
      requests: {
        ...state.requests,
        [event.conversationId]: { ...request, messageId: event.messageId },
      },
      conversations: state.conversations.map((item) =>
        item.id !== event.conversationId
          ? item
          : {
              ...item,
              isPersisted: true,
              updatedAt: now,
              messages: [
                ...item.messages,
                {
                  id: event.messageId,
                  role: 'assistant',
                  content: '',
                  reasoning: '',
                  attachments: [],
                  createdAt: now,
                  status: 'streaming',
                },
              ],
            },
      ),
    }
  }
  if (event.type === 'text-delta') {
    if (request.messageId !== event.messageId) return state
    return {
      ...state,
      conversations: state.conversations.map((item) =>
        item.id !== event.conversationId
          ? item
          : {
              ...item,
              updatedAt: now,
              messages: item.messages.map((message) =>
                message.id !== event.messageId
                  ? message
                  : { ...message, content: message.content + event.delta },
              ),
            },
      ),
    }
  }
  if (event.type === 'reasoning-delta') {
    if (request.messageId !== event.messageId) return state
    return {
      ...state,
      conversations: state.conversations.map((item) =>
        item.id !== event.conversationId
          ? item
          : {
              ...item,
              updatedAt: now,
              messages: item.messages.map((message) =>
                message.id !== event.messageId
                  ? message
                  : {
                      ...message,
                      reasoning: message.reasoning + event.delta,
                    },
              ),
            },
      ),
    }
  }
  if (
    (event.type === 'message-complete' || event.type === 'error') &&
    event.messageId &&
    request.messageId !== event.messageId
  )
    return state
  const requests = { ...state.requests }
  delete requests[event.conversationId]
  const terminalMessageId =
    event.type === 'message-stopped'
      ? request.messageId
      : (event.messageId ?? request.messageId)
  const terminalStatus: MessageStatus =
    event.type === 'message-complete'
      ? event.incomplete
        ? 'incomplete'
        : 'completed'
      : event.type === 'message-stopped'
        ? 'cancelled'
        : 'failed'
  const generatedTitle =
    event.type === 'message-complete' && request.generatedTitleAllowed !== false
      ? event.title
      : undefined

  return {
    ...state,
    requests,
    errors:
      event.type === 'error'
        ? { ...state.errors, [event.conversationId]: event.message }
        : state.errors,
    conversations: state.conversations.map((item) => {
      if (item.id !== event.conversationId) return item
      if (
        event.type === 'error' &&
        !request.messageId &&
        request.previousConversation
      ) {
        return request.previousConversation
      }
      const updated = setMessageStatus(
        item.messages,
        terminalMessageId,
        terminalStatus,
      )
      return {
        ...item,
        ...(generatedTitle ? { title: generatedTitle } : {}),
        messages:
          terminalStatus === 'completed'
            ? updated
            : updated.filter(
                (message) =>
                  message.id !== terminalMessageId ||
                  message.content.length > 0 ||
                  message.reasoning.length > 0,
              ),
      }
    }),
  }
}

export function createChatStore(
  gateway: Pick<VelinApi['chat'], 'send' | 'stop'>,
) {
  let state = emptyState()
  let historyGeneration = 0
  const historyGenerations = new Map<string, number>()
  function invalidateHistory(conversationId: string) {
    historyGenerations.set(conversationId, ++historyGeneration)
  }
  const listeners = new Set<() => void>()
  function update(next: ChatState) {
    if (next === state) return
    state = next
    listeners.forEach((listener) => listener())
  }
  function start(
    conversation: Conversation,
    content: string,
    userMessageId: string,
    options: ChatSendOptions = defaultSendOptions,
    attachmentIds: string[] = [],
    rollbackOnReject = false,
  ) {
    const request: SendMessageRequest = {
      requestId: crypto.randomUUID(),
      conversationId: conversation.id,
      userMessageId,
      content,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      attachmentIds,
    }
    const errors = { ...state.errors }
    delete errors[conversation.id]
    const previousHistory = state.history[conversation.id]
    const previous = state
    invalidateHistory(conversation.id)
    update({
      ...state,
      activeConversationId: conversation.id,
      conversations: state.conversations.some(
        (item) => item.id === conversation.id,
      )
        ? state.conversations.map((item) =>
            item.id === conversation.id ? conversation : item,
          )
        : [conversation, ...state.conversations],
      requests: {
        ...state.requests,
        [conversation.id]: {
          requestId: request.requestId,
          conversationId: conversation.id,
          previousConversation: rollbackOnReject
            ? state.conversations.find((item) => item.id === conversation.id)
            : undefined,
        },
      },
      history: {
        ...state.history,
        [conversation.id]: {
          status: 'loaded',
          revision: previousHistory?.revision,
          hasMore: previousHistory?.hasMore ?? false,
          nextBefore: previousHistory?.nextBefore ?? null,
        },
      },
      errors,
    })
    try {
      gateway.send(request)
      return true
    } catch {
      update(previous)
      return false
    }
  }
  function stop(conversationId: string) {
    const request = state.requests[conversationId]
    if (!request) return
    // 发送 IPC 前先让本地请求失效，忽略迟到增量与终止事件。
    update(
      applyChatEvent(
        state,
        { ...request, type: 'message-stopped' },
        Date.now(),
      ),
    )
    if (!dispatchStop({ requestId: request.requestId, conversationId })) {
      update({
        ...state,
        errors: {
          ...state.errors,
          [conversationId]: '回复已在本地停止，但停止请求未送达。',
        },
      })
    }
  }
  function dispatchStop(request: StopMessageRequest) {
    try {
      gateway.stop(request)
      return true
    } catch {
      // 传输失败不能中断账号清理或阻止其他请求收到停止通知。
      return false
    }
  }
  function historyState(conversationId: string) {
    return state.history[conversationId] ?? initialHistory()
  }
  return {
    getSnapshot: () => state,
    // 网络读取持有开始时的代次；编辑、重发、恢复和账号清理使旧页立即失效。
    captureHistoryRead(conversationId: string) {
      if (!historyGenerations.has(conversationId))
        invalidateHistory(conversationId)
      const generation = historyGenerations.get(conversationId)
      return () =>
        historyGenerations.get(conversationId) === generation &&
        state.conversations.some((item) => item.id === conversationId)
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    receive(event: ChatEvent) {
      const request = state.requests[event.conversationId]
      const next = applyChatEvent(state, event, Date.now())
      if (
        next !== state &&
        event.type === 'error' &&
        request?.previousConversation &&
        !request.messageId
      ) {
        update({
          ...next,
          history: {
            ...next.history,
            [event.conversationId]: {
              ...historyState(event.conversationId),
              status: 'idle',
            },
          },
        })
      } else update(next)
    },
    hydrateConversations(summaries: ConversationSummary[], append = false) {
      const existing = new Map(
        state.conversations.map((conversation) => [
          conversation.id,
          conversation,
        ]),
      )
      const summaryIds = new Set(summaries.map((summary) => summary.id))
      const conversations = summaries.map((summary) => {
        const current = existing.get(summary.id)
        return current
          ? {
              ...current,
              title: summary.title,
              updatedAt: summary.updatedAt,
              isPersisted: true as const,
            }
          : {
              id: summary.id,
              title: summary.title,
              messages: [],
              createdAt: summary.createdAt,
              updatedAt: summary.updatedAt,
              isPersisted: true as const,
            }
      })
      const localConversations = state.conversations.filter(
        (conversation) => !summaryIds.has(conversation.id),
      )
      const history = { ...state.history }
      for (const summary of summaries) {
        if (!history[summary.id]) history[summary.id] = initialHistory()
      }
      update({
        ...state,
        conversations: append
          ? [...localConversations, ...conversations]
          : [
              ...localConversations.filter(
                (conversation) => state.requests[conversation.id],
              ),
              ...conversations,
              ...localConversations.filter(
                (conversation) => !state.requests[conversation.id],
              ),
            ],
        history,
      })
    },
    beginHistoryLoad(conversationId: string) {
      const current = historyState(conversationId)
      if (
        current.status === 'loaded' ||
        current.status === 'loading' ||
        current.status === 'restoring'
      ) {
        return false
      }
      update({
        ...state,
        history: {
          ...state.history,
          [conversationId]: { ...current, status: 'loading', error: undefined },
        },
      })
      return true
    },
    completeHistoryLoad(conversationId: string, page: ConversationHistoryPage) {
      if (state.requests[conversationId]) return
      const current = state.conversations.find(
        (conversation) => conversation.id === conversationId,
      )
      if (!current) return
      invalidateHistory(conversationId)
      update({
        ...state,
        errors: { ...state.errors, [conversationId]: undefined },
        conversations: state.conversations.map((conversation) =>
          conversation.id !== conversationId
            ? conversation
            : {
                ...conversation,
                title: page.conversation.title,
                messages: page.messages,
                createdAt: page.conversation.createdAt,
                updatedAt: page.conversation.updatedAt,
              },
        ),
        history: {
          ...state.history,
          [conversationId]: {
            status: 'loaded',
            revision: page.revision,
            hasMore: page.hasMore,
            nextBefore: page.nextBefore,
          },
        },
      })
    },
    refreshHistory(conversationId: string, page: ConversationHistoryPage) {
      if (
        state.requests[conversationId] ||
        historyState(conversationId).status === 'restoring'
      )
        return
      const current = state.conversations.find(
        (item) => item.id === conversationId,
      )
      if (!current) return
      const revision = historyState(conversationId).revision
      const changed = revision !== undefined && revision !== page.revision
      if (changed) invalidateHistory(conversationId)
      // 后台刷新只替换服务端最新页覆盖的尾部，保留已读取的更早消息。
      const firstId = page.messages[0]?.id
      const boundary =
        !changed && firstId
          ? current.messages.findIndex((item) => item.id === firstId)
          : -1
      const earlier = boundary >= 0 ? current.messages.slice(0, boundary) : []
      update({
        ...state,
        conversations: state.conversations.map((item) =>
          item.id === conversationId
            ? {
                ...item,
                title: page.conversation.title,
                updatedAt: page.conversation.updatedAt,
                messages: [...earlier, ...page.messages],
              }
            : item,
        ),
        history: {
          ...state.history,
          [conversationId]: {
            status: 'loaded',
            revision: page.revision,
            hasMore:
              earlier.length > 0
                ? (state.history[conversationId]?.hasMore ?? false)
                : page.hasMore,
            nextBefore:
              earlier.length > 0
                ? (state.history[conversationId]?.nextBefore ?? null)
                : page.nextBefore,
          },
        },
      })
    },
    failHistoryLoad(conversationId: string, message: string) {
      if (
        !state.conversations.some(
          (conversation) => conversation.id === conversationId,
        )
      ) {
        return
      }
      update({
        ...state,
        history: {
          ...state.history,
          [conversationId]: {
            ...historyState(conversationId),
            status: 'error',
            error: message,
          },
        },
      })
    },
    prependHistory(conversationId: string, page: ConversationHistoryPage) {
      if (
        state.requests[conversationId] ||
        historyState(conversationId).status === 'restoring'
      )
        return
      const conversation = state.conversations.find(
        (item) => item.id === conversationId,
      )
      if (!conversation) return
      const revision = historyState(conversationId).revision
      if (revision !== undefined && revision !== page.revision) {
        invalidateHistory(conversationId)
        update({
          ...state,
          history: {
            ...state.history,
            [conversationId]: { ...initialHistory(), status: 'idle' },
          },
        })
        return
      }
      const existingIds = new Set(
        conversation.messages.map((message) => message.id),
      )
      const earlier = page.messages.filter(
        (message) => !existingIds.has(message.id),
      )
      update({
        ...state,
        conversations: state.conversations.map((item) =>
          item.id === conversationId
            ? { ...item, messages: [...earlier, ...item.messages] }
            : item,
        ),
        history: {
          ...state.history,
          [conversationId]: {
            status: 'loaded',
            revision: page.revision,
            hasMore: page.hasMore,
            nextBefore: page.nextBefore,
          },
        },
      })
    },
    select(id: string | null) {
      if (id === null || state.conversations.some((item) => item.id === id))
        update({ ...state, activeConversationId: id })
    },
    beginHistoryRestore(conversationId: string) {
      if (
        state.requests[conversationId] ||
        historyState(conversationId).status !== 'loaded'
      )
        return false
      invalidateHistory(conversationId)
      update({
        ...state,
        history: {
          ...state.history,
          [conversationId]: {
            ...historyState(conversationId),
            status: 'restoring',
            error: undefined,
          },
        },
      })
      return true
    },
    send(content: string, options: ChatSendOptions = defaultSendOptions) {
      const attachments = options.attachments ?? []
      if (!content.trim() || content.length > chatLimits.messageCharacters)
        return false
      const active = state.conversations.find(
        (item) => item.id === state.activeConversationId,
      )
      if (active && historyState(active.id).status !== 'loaded') return false
      if (active && state.requests[active.id]) return false
      const message: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        reasoning: '',
        attachments,
        createdAt: Date.now(),
        status: 'completed',
      }
      const messages = [...(active?.messages ?? []), message]
      return start(
        {
          ...(active?.isPersisted ? { isPersisted: true as const } : {}),
          id: active?.id ?? crypto.randomUUID(),
          title: active?.title ?? conversationTitle(content),
          messages,
          createdAt: active?.createdAt ?? message.createdAt,
          updatedAt: message.createdAt,
        },
        content,
        message.id,
        options,
        attachments.map((attachment) => attachment.id),
      )
    },
    edit(
      conversationId: string,
      messageId: string,
      content: string,
      options: ChatSendOptions = defaultSendOptions,
    ) {
      if (
        !content.trim() ||
        content.length > chatLimits.messageCharacters ||
        state.requests[conversationId] ||
        historyState(conversationId).status !== 'loaded'
      )
        return false
      const conversation = state.conversations.find(
        (item) => item.id === conversationId,
      )
      const index =
        conversation?.messages.findIndex((item) => item.id === messageId) ?? -1
      if (
        !conversation ||
        index < 0 ||
        conversation.messages[index].role !== 'user'
      )
        return false
      const messages = [
        ...conversation.messages.slice(0, index),
        { ...conversation.messages[index], content },
      ]
      return start(
        {
          ...conversation,
          messages,
          updatedAt: Date.now(),
          title: conversation.title,
        },
        content,
        messageId,
        options,
        conversation.messages[index].attachments.map(
          (attachment) => attachment.id,
        ),
        true,
      )
    },
    regenerate(
      conversationId: string,
      messageId: string,
      options: ChatSendOptions = defaultSendOptions,
    ) {
      if (
        state.requests[conversationId] ||
        historyState(conversationId).status !== 'loaded'
      ) {
        return false
      }
      const conversation = state.conversations.find(
        (item) => item.id === conversationId,
      )
      const index =
        conversation?.messages.findIndex((item) => item.id === messageId) ?? -1
      if (!conversation || index <= 0) return false
      const assistant = conversation.messages[index]
      const user = conversation.messages[index - 1]
      if (assistant.role !== 'assistant' || user.role !== 'user') return false
      const messages = conversation.messages.slice(0, index)
      return start(
        {
          ...conversation,
          messages,
          updatedAt: Date.now(),
        },
        user.content,
        user.id,
        options,
        user.attachments.map((attachment) => attachment.id),
        true,
      )
    },
    stop,
    remove(id: string) {
      const index = state.conversations.findIndex((item) => item.id === id)
      if (index < 0) return
      stop(id)
      historyGenerations.delete(id)
      const conversations = state.conversations.filter((item) => item.id !== id)
      const errors = { ...state.errors }
      delete errors[id]
      const history = { ...state.history }
      delete history[id]
      update({
        ...state,
        conversations,
        errors,
        history,
        activeConversationId:
          state.activeConversationId === id
            ? (conversations[Math.min(index, conversations.length - 1)]?.id ??
              null)
            : state.activeConversationId,
      })
    },
    reorder(source: string, target: string) {
      const from = state.conversations.findIndex((item) => item.id === source)
      const to = state.conversations.findIndex((item) => item.id === target)
      if (from < 0 || to < 0 || from === to) return
      const conversations = [...state.conversations]
      conversations.splice(to, 0, ...conversations.splice(from, 1))
      update({ ...state, conversations })
    },
    setConversationOrder(ids: string[]) {
      const byId = new Map(
        state.conversations.map((conversation) => [
          conversation.id,
          conversation,
        ]),
      )
      const conversations = ids.map((id) => byId.get(id))
      if (
        conversations.length !== state.conversations.length ||
        conversations.some((conversation) => !conversation)
      ) {
        return
      }
      update({
        ...state,
        conversations: conversations as Conversation[],
      })
    },
    rename(id: string, title: string) {
      if (!state.conversations.some((item) => item.id === id)) return
      update({
        ...state,
        requests: state.requests[id]
          ? {
              ...state.requests,
              [id]: {
                ...state.requests[id],
                generatedTitleAllowed: false,
                ...(state.requests[id].previousConversation
                  ? {
                      previousConversation: {
                        ...state.requests[id].previousConversation,
                        title,
                      },
                    }
                  : {}),
              },
            }
          : state.requests,
        conversations: state.conversations.map((item) =>
          item.id === id ? { ...item, title } : item,
        ),
      })
    },
    reset() {
      const requests = Object.values(state.requests)
      historyGenerations.clear()
      update(emptyState())
      requests.forEach(({ requestId, conversationId }) =>
        dispatchStop({ requestId, conversationId }),
      )
    },
  }
}
