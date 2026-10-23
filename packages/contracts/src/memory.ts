import { z } from 'zod'
import { isValidStorageText } from './policy.js'

export const memoryEntrySchema = z
  .object({
    id: z.uuid(),
    topic: z.string().min(1).max(100),
    content: z.string().min(1).max(1000),
    origin: z.enum(['manual', 'automatic']),
    version: z.number().int().positive(),
    sourceConversationId: z.uuid().nullable(),
    sourceQuote: z.string().max(1000).nullable(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
export const memoryStateSchema = z
  .object({
    enabled: z.boolean(),
    referenceHistory: z.boolean(),
    entries: z.array(memoryEntrySchema).max(200),
  })
  .strict()
export const memoryWriteSchema = z
  .object({
    id: z.uuid().optional(),
    version: z.number().int().positive().optional(),
    topic: z.string().trim().min(1).max(100).refine(isValidStorageText),
    content: z.string().trim().min(1).max(1000).refine(isValidStorageText),
  })
  .strict()
  .refine((value) => Boolean(value.id) === Boolean(value.version))
export const memoryActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('settings'),
      enabled: z.boolean().optional(),
      referenceHistory: z.boolean().optional(),
    })
    .strict()
    .refine(
      (value) =>
        value.enabled !== undefined || value.referenceHistory !== undefined,
    ),
  z.object({ action: z.literal('save'), entry: memoryWriteSchema }).strict(),
  z
    .object({
      action: z.literal('delete'),
      id: z.uuid(),
      version: z.number().int().positive(),
    })
    .strict(),
  z.object({ action: z.literal('clear') }).strict(),
])
export const conversationVersionSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.number().int().nonnegative(),
    preview: z.string().max(200),
    messageCount: z.number().int().nonnegative(),
  })
  .strict()
export const conversationVersionsSchema = z
  .array(conversationVersionSchema)
  .max(50)
export const conversationVersionRequestSchema = z
  .object({ conversationId: z.uuid(), versionId: z.uuid().optional() })
  .strict()
export type MemoryState = z.infer<typeof memoryStateSchema>
export type MemoryAction = z.infer<typeof memoryActionSchema>
export type MemoryEntry = z.infer<typeof memoryEntrySchema>
export type ConversationVersion = z.infer<typeof conversationVersionSchema>
export type ConversationVersionRequest = z.infer<
  typeof conversationVersionRequestSchema
>
export const memoryIpcChannels = {
  read: 'velin:memory:read',
  update: 'velin:memory:update',
  versions: 'velin:chat:versions',
  restoreVersion: 'velin:chat:restore-version',
} as const
