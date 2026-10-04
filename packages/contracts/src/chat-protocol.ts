import type { z } from 'zod'
import type {
  chatEventSchema,
  chatRequestSchema,
  chatStopRequestSchema,
} from './chat-validation.js'

export const chatIpcChannels = {
  send: 'velin:chat:send',
  event: 'velin:chat:event',
  stop: 'velin:chat:stop',
  openExternalLink: 'velin:chat:open-external-link',
} as const

export type SendMessageRequest = z.infer<typeof chatRequestSchema>
export type StopMessageRequest = z.infer<typeof chatStopRequestSchema>

export type ChatEvent = z.infer<typeof chatEventSchema>
