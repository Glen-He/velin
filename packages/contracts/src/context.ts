import { z } from 'zod'
export const historySourceSchema = z
  .object({
    conversationId: z.uuid(),
    messageId: z.uuid(),
    title: z.string().max(200),
    role: z.enum(['user', 'assistant']),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    excerpt: z
      .string()
      .max(2000)
      .refine((value) => Array.from(value).length <= 1000),
  })
  .strict()
export type HistorySource = z.infer<typeof historySourceSchema>
export const contextInfoSchema = z
  .object({
    policyVersion: z.number().int().positive(),
    summaryUsed: z.boolean(),
    memoryCount: z.number().int().min(0).max(200),
    historySources: z.array(historySourceSchema).max(8),
    retrievalDegraded: z.boolean(),
    documentPartial: z.boolean(),
    documentsSummarized: z.boolean(),
    imagesLimited: z.boolean(),
    tokenUpperBound: z.number().int().nonnegative(),
    sources: z
      .array(
        z
          .object({
            attachmentId: z.uuid(),
            name: z.string().max(200),
            page: z.number().int().positive().nullable(),
            excerpt: z.string().max(1000),
          })
          .strict(),
      )
      .max(8),
  })
  .strict()
export type ContextInfo = z.infer<typeof contextInfoSchema>
