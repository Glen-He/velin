import { z } from 'zod'
import { contextInfoSchema } from './context.js'
import { attachmentLimits } from './attachments.js'
import {
  chatModels,
  defaultChatModel,
  defaultReasoningEffortForModel,
  isChatModelId,
  isReasoningEffortSupported,
  reasoningEffortIds,
} from './chat.js'
import type { ChatModelId, ChatModelInfo } from './chat.js'
import {
  chatLimits,
  conversationTitleMessage,
  isValidConversationTitle,
  isValidStorageText,
} from './policy.js'

const eventBase = { requestId: z.uuid(), conversationId: z.uuid() }
const messageBase = { ...eventBase, messageId: z.uuid() }
const conversationIdSchema = z.uuid()
export const chatSequenceCursorSchema = z
  .string()
  .max(19)
  .refine(
    (value) =>
      /^[1-9]\d{0,18}$/.test(value) &&
      BigInt(value) <= 9_223_372_036_854_775_807n,
  )
const messageStatusSchema = z.enum([
  'streaming',
  'completed',
  'incomplete',
  'failed',
  'cancelled',
])
const messageRoleSchema = z.enum(['user', 'assistant'])
const chatModelIdSchema = z.custom<ChatModelId>(
  (value) => typeof value === 'string' && isChatModelId(value),
  { message: '模型无效。' },
)
export const messageAttachmentSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['file', 'image']),
    name: z.string().min(1).max(200),
    mimeType: z.string().min(1).max(100),
    sizeBytes: z.number().int().nonnegative(),
    status: z.enum(['processing', 'ready', 'failed', 'canceled']),
    thumbnail: z.string().max(attachmentLimits.thumbnailCharacters).optional(),
    pageCount: z.number().int().positive().optional(),
    ocrPageRange: z.string().max(120).optional(),
    ocrError: z.string().max(500).optional(),
    progress: z
      .object({
        completed: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const chatStopRequestSchema = z.object(eventBase).strict()

const chatRequestBodySchema = z
  .object({
    ...eventBase,
    userMessageId: z.uuid(),
    content: z
      .string()
      .min(1)
      .max(chatLimits.messageCharacters)
      .refine(isValidStorageText)
      .refine((value) => value.trim().length > 0),
    model: chatModelIdSchema.default(defaultChatModel),
    reasoningEffort: z.enum(reasoningEffortIds).optional(),
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          if (/^[+-]/u.test(value)) return false
          new Intl.DateTimeFormat('en', { timeZone: value })
          return true
        } catch {
          return false
        }
      })
      .transform(
        (value) =>
          new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions()
            .timeZone,
      )
      .optional(),
    attachmentIds: z
      .array(z.uuid())
      .max(attachmentLimits.maxFiles)
      .default([])
      .refine(
        (ids) => new Set(ids).size === ids.length,
        '附件列表不能包含重复项。',
      ),
  })
  .strict()

export function createChatRequestSchema(
  models: readonly ChatModelInfo[] = chatModels,
) {
  return chatRequestBodySchema
    .superRefine((value, ctx) => {
      const model = models.find((candidate) => candidate.id === value.model)
      if (!model) {
        ctx.addIssue({
          code: 'custom',
          path: ['model'],
          message: '模型不可用。',
        })
        return
      }
      if (
        !isReasoningEffortSupported(
          model,
          value.reasoningEffort ?? defaultReasoningEffortForModel(model),
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['reasoningEffort'],
          message: '当前模型不支持该推理强度。',
        })
      }
    })
    .transform((value) => ({
      ...value,
      reasoningEffort:
        value.reasoningEffort ??
        defaultReasoningEffortForModel(
          models.find((model) => model.id === value.model)!,
        ),
    }))
}
export const chatRequestSchema = createChatRequestSchema()
export const chatHistoryLoadRequestSchema = z
  .object({
    conversationId: conversationIdSchema,
    before: chatSequenceCursorSchema.optional(),
  })
  .strict()

export const chatHistoryDeleteRequestSchema = z
  .object({ conversationId: conversationIdSchema })
  .strict()

const conversationTitleSchema = z
  .string()
  .transform((value) => value.trim())
  .refine(isValidConversationTitle, conversationTitleMessage)

export const chatRenameRequestSchema = z
  .object({
    conversationId: conversationIdSchema,
    title: conversationTitleSchema,
  })
  .strict()

export const chatTitleUpdateSchema = z
  .object({ title: conversationTitleSchema })
  .strict()

export const chatRenameResponseSchema = z
  .object({ title: z.string().min(1).max(200) })
  .strict()

export const chatOrderRequestSchema = z
  .object({
    sourceId: conversationIdSchema,
    targetId: conversationIdSchema,
    placement: z.enum(['before', 'after']),
  })
  .strict()
  .refine(
    (value) => value.sourceId !== value.targetId,
    'Conversation order requires different source and target.',
  )

export const chatListRequestSchema = z
  .object({
    before: chatSequenceCursorSchema.optional(),
    search: z.string().trim().max(100).refine(isValidStorageText).optional(),
  })
  .strict()

export const chatAttachmentPickRequestSchema = z
  .object({
    accountId: z.string().min(1).max(128),
    kind: z.enum(['file', 'image']),
    remaining: z.number().int().min(1).max(attachmentLimits.maxFiles),
    conversationId: z.uuid().optional(),
  })
  .strict()

export const chatAttachmentUploadRequestSchema = z
  .object({
    accountId: z.string().min(1).max(128),
    name: z.string().min(1).max(200),
    mimeType: z.string().min(1).max(100),
    pageRange: z.string().max(120).optional(),
    conversationId: z.uuid().optional(),
  })
  .strict()

export const chatPendingAttachmentsRequestSchema = z
  .object({ conversationId: z.uuid().optional() })
  .strict()

export const chatPendingAttachmentsResponseSchema = z
  .object({ attachments: z.array(messageAttachmentSchema).max(100) })
  .strict()

export const chatAttachmentReprocessRequestSchema = z
  .object({
    attachmentId: z.uuid(),
    pageRange: z.string().max(120),
  })
  .strict()

export const chatAttachmentDeleteRequestSchema = z
  .object({ attachmentId: z.uuid() })
  .strict()

export const chatAttachmentStatusRequestSchema = z
  .object({ attachmentId: z.uuid() })
  .strict()

export const chatAttachmentCancelRequestSchema = z
  .object({ attachmentId: z.uuid() })
  .strict()

export const chatAttachmentUploadResponseSchema = z
  .object({ attachment: messageAttachmentSchema })
  .strict()

export const chatEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...messageBase,
      type: z.literal('context-ready'),
      model: z.string().min(1).max(200),
      reasoningEffort: z.enum(reasoningEffortIds),
      context: contextInfoSchema,
    })
    .strict(),
  z
    .object({
      ...messageBase,
      type: z.literal('message-start'),
    })
    .strict(),
  z
    .object({
      ...messageBase,
      type: z.literal('text-delta'),
      delta: z.string().max(chatLimits.deltaCharacters),
    })
    .strict(),
  z
    .object({
      ...messageBase,
      type: z.literal('reasoning-delta'),
      delta: z.string().max(chatLimits.deltaCharacters),
    })
    .strict(),
  z
    .object({
      ...messageBase,
      type: z.literal('message-complete'),
      title: z.string().min(1).max(200).optional(),
      incomplete: z.boolean().optional(),
    })
    .strict(),
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

export const conversationSummarySchema = z
  .object({
    id: conversationIdSchema,
    title: z.string().min(1).max(200),
    model: z.string().min(1).max(100),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()

export const persistedMessageSchema = z
  .object({
    context: contextInfoSchema.optional(),
    model: z.string().max(200).optional(),
    reasoningEffort: z.string().max(30).optional(),
    id: z.uuid(),
    role: messageRoleSchema,
    content: z.string().max(chatLimits.responseCharacters),
    reasoning: z.string().max(chatLimits.responseCharacters),
    attachments: z
      .array(messageAttachmentSchema)
      .max(attachmentLimits.maxFiles),
    createdAt: z.number().int().nonnegative(),
    status: messageStatusSchema,
  })
  .strict()

export const chatHistoryListResponseSchema = z
  .object({
    conversations: z.array(conversationSummarySchema).max(100),
    nextCursor: chatSequenceCursorSchema.nullable(),
  })
  .strict()

export const chatHistoryPageResponseSchema = z
  .object({
    revision: chatSequenceCursorSchema,
    conversation: conversationSummarySchema,
    messages: z.array(persistedMessageSchema).max(100),
    hasMore: z.boolean(),
    nextBefore: chatSequenceCursorSchema.nullable(),
  })
  .strict()
