import type { z } from 'zod'
import type { chatEventSchema } from './chat-validation.js'

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

export type ChatEvent = z.infer<typeof chatEventSchema>
