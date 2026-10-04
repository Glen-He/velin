import type { Conversation, Message } from '@velin/contracts/chat'
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
}
export type ChatState = {
  conversations: Conversation[]
  activeConversationId: string | null
  requests: Record<string, ActiveRequest>
  errors: Record<string, string | undefined>
}
const emptyState = (): ChatState => ({
  conversations: [],
  activeConversationId: null,
  requests: {},
  errors: {},
})

export function conversationTitle(content: string) {
  const text = content.replace(/\s+/g, ' ').trim()
  return text.length > 30 ? `${text.slice(0, 30)}…` : text || '新对话'
}

export function promptMessages(
  messages: Message[],
): SendMessageRequest['messages'] {
  const prompt: SendMessageRequest['messages'] = []
  let length = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    const { role, content } = messages[index]
    if (!content.trim()) continue
    if (
      prompt.length === chatLimits.messages ||
      content.length > chatLimits.messageCharacters ||
      length + content.length > chatLimits.promptCharacters
    )
      break
    prompt.unshift({ role, content })
    length += content.length
  }
  return prompt
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
  if (event.type === 'message-start') {
    if (request.messageId) return state // 重复开始事件不能追加第二条回复。
    return {
      ...state,
      requests: {
        ...state.requests,
        [event.conversationId]: { ...request, messageId: event.messageId },
      },
      conversations: state.conversations.map((item) =>
        item.id !== event.conversationId
          ? item
          : {
              ...item,
              updatedAt: now,
              messages: [
                ...item.messages,
                {
                  id: event.messageId,
                  role: 'assistant',
                  content: '',
                  createdAt: now,
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
  if (
    (event.type === 'message-complete' || event.type === 'error') &&
    event.messageId &&
    request.messageId !== event.messageId
  )
    return state
  const requests = { ...state.requests }
  delete requests[event.conversationId]
  return {
    ...state,
    requests,
    errors:
      event.type === 'error'
        ? { ...state.errors, [event.conversationId]: event.message }
        : state.errors,
    conversations:
      event.type === 'message-complete'
        ? state.conversations
        : state.conversations.map((item) =>
            item.id !== event.conversationId
              ? item
              : {
                  ...item,
                  messages: item.messages.filter(
                    (message) =>
                      message.id !== request.messageId ||
                      message.content.length > 0,
                  ),
                },
          ),
  }
}

export function createChatStore(
  gateway: Pick<VelinApi['chat'], 'send' | 'stop'>,
) {
  let state = emptyState()
  const listeners = new Set<() => void>()
  function update(next: ChatState) {
    if (next === state) return
    state = next
    listeners.forEach((listener) => listener())
  }
  function start(conversation: Conversation, messages: Message[]) {
    const request = {
      requestId: crypto.randomUUID(),
      conversationId: conversation.id,
      messages: promptMessages(messages),
    }
    const errors = { ...state.errors }
    delete errors[conversation.id]
    const previous = state
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
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    receive(event: ChatEvent) {
      update(applyChatEvent(state, event, Date.now()))
    },
    select(id: string | null) {
      if (id === null || state.conversations.some((item) => item.id === id))
        update({ ...state, activeConversationId: id })
    },
    send(content: string) {
      if (!content.trim() || content.length > chatLimits.messageCharacters)
        return false
      const active = state.conversations.find(
        (item) => item.id === state.activeConversationId,
      )
      if (active && state.requests[active.id]) return false
      const message: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        createdAt: Date.now(),
      }
      const messages = [...(active?.messages ?? []), message]
      return start(
        {
          id: active?.id ?? crypto.randomUUID(),
          title: active?.title ?? conversationTitle(content),
          messages,
          createdAt: active?.createdAt ?? message.createdAt,
          updatedAt: message.createdAt,
        },
        messages,
      )
    },
    edit(conversationId: string, messageId: string, content: string) {
      if (
        !content.trim() ||
        content.length > chatLimits.messageCharacters ||
        state.requests[conversationId]
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
          title: index === 0 ? conversationTitle(content) : conversation.title,
        },
        messages,
      )
    },
    stop,
    remove(id: string) {
      const index = state.conversations.findIndex((item) => item.id === id)
      if (index < 0) return
      stop(id)
      const conversations = state.conversations.filter((item) => item.id !== id)
      const errors = { ...state.errors }
      delete errors[id]
      update({
        ...state,
        conversations,
        errors,
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
    reset() {
      const requests = Object.values(state.requests)
      update(emptyState())
      requests.forEach(({ requestId, conversationId }) =>
        dispatchStop({ requestId, conversationId }),
      )
    },
  }
}
