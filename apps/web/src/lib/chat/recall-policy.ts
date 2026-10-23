import { z } from 'zod'
import { retrievalTerms } from './context-policy'
import { isValidStorageText, truncateText } from '@velin/contracts/policy'

export const recallPolicy = {
  queries: 4,
  candidatesPerQuery: 16,
  rerankCandidates: 40,
  sources: 8,
  characters: 12_000,
  queryTimeoutMs: 12_000,
  rerankTimeoutMs: 18_000,
} as const

// DeepSeek 的结构化输出不支持 format:date；传输使用日期模式，边界仍校验真实日历日期。
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => z.iso.date().safeParse(value).success)
  .nullable()
export const recallPlanSchema = z
  .object({
    queries: z
      .array(z.string().trim().min(1).max(240).refine(isValidStorageText))
      .max(3),
    after: daySchema,
    before: daySchema,
  })
  .strict()
  .refine(
    (value) => !value.after || !value.before || value.after <= value.before,
  )
export type RecallPlan = z.infer<typeof recallPlanSchema>

export const recallSelectionSchema = z
  .object({
    evidence: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            quote: z.string().min(1).max(600),
          })
          .strict(),
      )
      .max(recallPolicy.sources),
  })
  .strict()

export type RecallCandidate = {
  id: string
  messageId: string
  conversationId: string
  title: string
  role: 'user' | 'assistant'
  createdAt: number
  updatedAt: number
  content: string
  revision: string
  sequence: string
  position: number
}

export function contextDate(timeZone = 'UTC', date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-')
}

// 候选来源不同，分数不可直接相加；RRF 用各路名次合并，避免一条查询主导所有结果。
export function fuseRecallCandidates(lists: RecallCandidate[][]) {
  const combined = new Map<
    string,
    { candidate: RecallCandidate; score: number }
  >()
  for (const list of lists) {
    const seen = new Set<string>()
    list.forEach((candidate, rank) => {
      if (seen.has(candidate.id)) return
      seen.add(candidate.id)
      const previous = combined.get(candidate.id)
      combined.set(candidate.id, {
        candidate,
        score: (previous?.score ?? 0) + 1 / (60 + rank + 1),
      })
    })
  }
  return [...combined.values()]
    .sort(
      (a, b) =>
        b.score - a.score || b.candidate.createdAt - a.candidate.createdAt,
    )
    .slice(0, recallPolicy.rerankCandidates)
    .map((value) => value.candidate)
}

export function recallQueries(question: string, plan: RecallPlan | null) {
  const queries = [truncateText(question, 2000), ...(plan?.queries ?? [])]
  return [...new Set(queries)]
    .filter((query) => retrievalTerms(query).length)
    .slice(0, recallPolicy.queries)
}

export function selectRecallEvidence(
  candidates: RecallCandidate[],
  selection: z.infer<typeof recallSelectionSchema>,
) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const selected: RecallCandidate[] = []
  const seen = new Set<string>()
  let characters = 0
  for (const evidence of selection.evidence) {
    const candidate = byId.get(evidence.id)
    // 模型只能选择确实存在的原文；不接受它生成的“历史事实”。
    if (
      !candidate ||
      !candidate.content.includes(evidence.quote) ||
      seen.has(candidate.id)
    )
      continue
    if (characters + candidate.content.length > recallPolicy.characters)
      continue
    selected.push(candidate)
    seen.add(candidate.id)
    characters += candidate.content.length
  }
  return selected
}
