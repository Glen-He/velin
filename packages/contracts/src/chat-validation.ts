import { z } from 'zod'
import { chatLimits } from './policy.js'

export const chatRequestSchema = z
  .object({
    requestId: z.uuid(),
    conversationId: z.uuid(),
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
