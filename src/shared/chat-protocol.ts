export const chatIpcChannels = {
  send: 'velin:chat:send',
  event: 'velin:chat:event',
  stop: 'velin:chat:stop',
  openExternalLink: 'velin:chat:open-external-link',
} as const

export type SendMessageRequest = {
  requestId: string
  conversationId: string
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
}

export type StopMessageRequest = {
  requestId: string
  conversationId: string
}

type ChatEventBase = {
  requestId: string
  conversationId: string
}

export type ChatEvent =
  | (ChatEventBase & {
      type: 'message-start'
      messageId: string
    })
  | (ChatEventBase & {
      type: 'text-delta'
      messageId: string
      delta: string
    })
  | (ChatEventBase & {
      type: 'message-complete'
      messageId: string
    })
  | (ChatEventBase & {
      type: 'message-stopped'
    })
  | (ChatEventBase & {
      type: 'error'
      messageId?: string
      message: string
    })
