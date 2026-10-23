import 'server-only'
import { deepseek, chatModel, providerUserId } from './model'
import { readResponse } from './responses'
import { databasePool } from '../database/connection'
import { z } from 'zod'
import { logger } from '../logging'

export async function auxiliaryResponse(input: {
  instructions: string
  input: string
  maxOutputTokens: number
  outputSchema?: z.ZodType
  requestId?: string
  userId?: string
  signal: AbortSignal
}) {
  if (!deepseek) throw new Error('Model service is not configured.')
  for (let attempt = 0; attempt < 2; attempt++) {
    input.signal.throwIfAborted()
    const result = await deepseek.responses.create(
      {
        model: chatModel,
        ...(input.userId ? { user: providerUserId(input.userId) } : {}),
        instructions:
          input.instructions +
          (attempt
            ? '\n上次响应未通过结构校验。本次必须只输出符合所提供schema的JSON对象；禁止前言、Markdown围栏、额外字段或解释。'
            : ''),
        input: input.input,
        reasoning: { effort: 'none' },
        max_output_tokens: input.maxOutputTokens,
        store: false,
        stream: false,
        ...(input.outputSchema
          ? {
              text: {
                format: {
                  type: 'json_schema' as const,
                  name: 'velin_output',
                  strict: true,
                  schema: z.toJSONSchema(input.outputSchema, {
                    target: 'draft-7',
                  }),
                },
              },
            }
          : {}),
      },
      { signal: input.signal },
    )
    const parsed = readResponse(result)
    if (input.requestId && parsed.usage)
      await databasePool.query(
        'update chat_request_usage set context_input_tokens = coalesce(context_input_tokens, 0) + $2, context_output_tokens = coalesce(context_output_tokens, 0) + $3 where request_id = $1',
        [
          input.requestId,
          parsed.usage.input_tokens,
          parsed.usage.output_tokens,
        ],
      )
    if (parsed.status !== 'completed' || !parsed.text.trim())
      throw new Error('Auxiliary response did not complete.')
    if (!input.outputSchema) return parsed
    let value: unknown
    try {
      value = JSON.parse(parsed.text)
    } catch {
      value = undefined
    }
    const validated = input.outputSchema.safeParse(value)
    if (validated.success)
      return { ...parsed, text: JSON.stringify(validated.data) }
    if (attempt === 0)
      logger.info('chat.auxiliary_format_retry', {
        generationId: input.requestId,
        purpose: 'structured-output',
      })
  }
  throw new Error('Auxiliary response did not match its output schema.')
}
