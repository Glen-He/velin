import { z } from 'zod'
import { chatLimits } from './policy.js'

const eventBase = { requestId: z.uuid(), conversationId: z.uuid() }
const messageBase = { ...eventBase, messageId: z.uuid() }

export const chatStopRequestSchema = z.object(eventBase).strict()

export const chatEventSchema = z.discriminatedUnion('type', [
  z.object({ ...messageBase, type: z.literal('message-start') }).strict(),
  z
    .object({
      ...messageBase,
      type: z.literal('text-delta'),
      delta: z.string().max(64 * 1024),
    })
    .strict(),
  z.object({ ...messageBase, type: z.literal('message-complete') }).strict(),
  z.object({ ...eventBase, type: z.literal('message-stopped') }).strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('error'),
      messageId: z.uuid().optional(),
      message: z.string().min(1).max(200),
    })
    .strict(),
])

export const chatRequestSchema = z
  .object({
    ...eventBase,
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            content: z
              .string()
              .min(1)
              .max(chatLimits.messageCharacters)
              .refine((value) => value.trim().length > 0),
          })
          .strict(),
      )
      .min(1)
      .max(chatLimits.messages),
  })
  .strict()
  .refine(
    (request) =>
      request.messages.at(-1)?.role === 'user' &&
      request.messages.reduce(
        (size, message) => size + message.content.length,
        0,
      ) <= chatLimits.promptCharacters,
  )
