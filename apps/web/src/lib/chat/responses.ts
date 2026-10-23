import { z } from 'zod'
import { isValidStorageText } from '@velin/contracts/policy'

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative().max(2_147_483_647),
  output_tokens: z.number().int().nonnegative().max(2_147_483_647),
})
const responseSchema = z.object({
  id: z.string().min(1).max(200),
  model: z.string().max(200).refine(isValidStorageText).optional(),
  status: z.string().optional(),
  usage: z.unknown().optional(),
  output_text: z.string().refine(isValidStorageText).optional(),
  output: z
    .array(
      z.object({
        type: z.string(),
        content: z
          .array(
            z.object({
              type: z.string(),
              text: z.string().refine(isValidStorageText).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
})
export function readResponse(value: unknown) {
  const response = responseSchema.parse(value)
  const usage = usageSchema.safeParse(response.usage)
  const text =
    response.output_text ??
    response.output
      ?.flatMap((item) =>
        item.type === 'message'
          ? (item.content
              ?.filter((part) => part.type === 'output_text')
              .map((part) => part.text ?? '') ?? [])
          : [],
      )
      .join('') ??
    ''
  return {
    id: response.id,
    model: response.model,
    status: response.status,
    text,
    usage: usage.success ? usage.data : undefined,
  }
}

export function createResponsesEventReader() {
  let sequence = -1
  let id: string | undefined
  let terminal = false
  return {
    get terminal() {
      return terminal
    },
    read(value: unknown) {
      const envelope = z
        .object({
          type: z.string(),
          sequence_number: z.number().int().nonnegative(),
        })
        .parse(value)
      if (terminal || envelope.sequence_number <= sequence)
        throw new Error('Responses event order is invalid.')
      sequence = envelope.sequence_number
      if (envelope.type === 'response.created') {
        if (id) throw new Error('Responses creation was repeated.')
        const parsed = z
          .object({ response: z.object({ id: z.string().min(1).max(200) }) })
          .parse(value)
        id = parsed.response.id
      }
      if (
        envelope.type === 'response.output_text.delta' ||
        envelope.type === 'response.reasoning_text.delta'
      ) {
        if (!id) throw new Error('Responses delta preceded creation.')
        const parsed = z
          .object({ delta: z.string().refine(isValidStorageText) })
          .parse(value)
        return {
          kind:
            envelope.type === 'response.output_text.delta'
              ? ('content' as const)
              : ('reasoning' as const),
          delta: parsed.delta,
        }
      }
      if (
        [
          'response.completed',
          'response.incomplete',
          'response.failed',
        ].includes(envelope.type)
      ) {
        const parsed = z.object({ response: z.unknown() }).parse(value)
        const response = readResponse(parsed.response)
        if (!id || response.id !== id)
          throw new Error('Responses identity changed.')
        if (response.status !== envelope.type.slice('response.'.length))
          throw new Error('Responses terminal status is inconsistent.')
        terminal = true
        if (envelope.type === 'response.failed')
          throw new Error('Responses generation failed.')
        return {
          kind: 'terminal' as const,
          incomplete: envelope.type === 'response.incomplete',
          ...response,
        }
      }
      if (envelope.type === 'error') throw new Error('Responses stream failed.')
      return { kind: 'ignore' as const }
    },
  }
}
