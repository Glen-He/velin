import type { MessageAttachment } from './attachments.js'
import type { ContextInfo } from './context.js'

export type { MessageAttachment } from './attachments.js'

export const reasoningEffortIds = ['none', 'low', 'high', 'max'] as const
export type ReasoningEffortId = (typeof reasoningEffortIds)[number]
export const defaultReasoningEffort: ReasoningEffortId = 'none'

export type ReasoningEffortInfo = {
  id: ReasoningEffortId
  name: string
}

export const reasoningEfforts: readonly ReasoningEffortInfo[] = [
  { id: 'none', name: '关闭' },
  { id: 'low', name: '低' },
  { id: 'high', name: '高' },
  { id: 'max', name: '最大' },
]

type ChatModelDefinition = {
  id: string
  name: string
  supportsImages?: boolean
  supportedReasoningEfforts?: readonly ReasoningEffortId[]
}

// 每个内置模型明确声明能力，不为未声明的模型自动添加推理档位。
const chatModelDefinitions = [
  {
    id: 'deepseek-flash',
    name: 'DeepSeek-Flash',
    supportsImages: true,
    supportedReasoningEfforts: reasoningEffortIds,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek-V4-Pro',
    supportedReasoningEfforts: reasoningEffortIds,
  },
] as const satisfies readonly ChatModelDefinition[]

export type ChatModelId = (typeof chatModelDefinitions)[number]['id']
export const defaultChatModel: ChatModelId = 'deepseek-flash'

export type ChatModelInfo = {
  id: ChatModelId
  name: string
  supportsImages: boolean
  // 空数组表示该模型不提供推理强度选择。
  supportedReasoningEfforts: readonly ReasoningEffortId[]
}

function resolveChatModel<Id extends ChatModelId>(model: {
  id: Id
  name: string
  supportsImages?: boolean
  supportedReasoningEfforts?: readonly ReasoningEffortId[]
}): ChatModelInfo & { id: Id } {
  return {
    id: model.id,
    name: model.name,
    supportsImages: model.supportsImages ?? false,
    supportedReasoningEfforts: model.supportedReasoningEfforts ?? [],
  }
}

export const chatModels: readonly ChatModelInfo[] =
  chatModelDefinitions.map(resolveChatModel)

export const chatModelIds: readonly ChatModelId[] = chatModels.map(
  (model) => model.id,
)

export function isChatModelId(value: string): value is ChatModelId {
  return chatModels.some((model) => model.id === value)
}

export function findChatModel(modelId: ChatModelId): ChatModelInfo {
  return chatModels.find((model) => model.id === modelId) ?? chatModels[0]
}

export function reasoningEffortsForModel(
  model: ChatModelInfo,
): readonly ReasoningEffortInfo[] {
  return model.supportedReasoningEfforts.map(
    (effortId) =>
      reasoningEfforts.find((effort) => effort.id === effortId) ??
      reasoningEfforts[0],
  )
}

export function defaultReasoningEffortForModel(
  model: ChatModelInfo,
): ReasoningEffortId {
  return model.supportedReasoningEfforts[0] ?? defaultReasoningEffort
}

export function isReasoningEffortSupported(
  model: ChatModelInfo,
  effort: ReasoningEffortId,
): boolean {
  return model.supportedReasoningEfforts.length === 0
    ? effort === defaultReasoningEffort
    : model.supportedReasoningEfforts.includes(effort)
}

export function normalizeReasoningEffort(
  model: ChatModelInfo,
  effort: ReasoningEffortId,
): ReasoningEffortId {
  const supported = model.supportedReasoningEfforts
  if (supported.length === 0) return defaultReasoningEffort
  if (supported.includes(effort)) return effort

  // 当前档位不可用时取语义最接近的档位，距离相同取较低档。
  const requestedIndex = reasoningEffortIds.indexOf(effort)
  return supported.reduce((nearest, candidate) => {
    const nearestDistance = Math.abs(
      reasoningEffortIds.indexOf(nearest) - requestedIndex,
    )
    const candidateDistance = Math.abs(
      reasoningEffortIds.indexOf(candidate) - requestedIndex,
    )
    return candidateDistance < nearestDistance ? candidate : nearest
  })
}

export type MessageRole = 'user' | 'assistant'

export type MessageStatus =
  | 'streaming'
  | 'completed'
  | 'incomplete'
  | 'failed'
  | 'cancelled'

export type Message = {
  context?: ContextInfo
  model?: string
  reasoningEffort?: string
  id: string
  role: MessageRole
  content: string
  reasoning: string
  attachments: MessageAttachment[]
  createdAt: number
  status: MessageStatus
}

export type Conversation = {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  isPersisted?: true
}

export type ConversationSummary = {
  id: string
  title: string
  model: string
  createdAt: number
  updatedAt: number
}

export type ConversationHistoryPage = {
  revision: string
  conversation: ConversationSummary
  messages: Message[]
  hasMore: boolean
  nextBefore: string | null
}

export type ConversationListPage = {
  conversations: ConversationSummary[]
  nextCursor: string | null
}

export function conversationTitle(content: string) {
  const text = content.replace(/\s+/g, ' ').trim()
  return text.length > 30 ? `${text.slice(0, 30)}…` : text || '新对话'
}

const generatedTitleCharacterLimit = 30

// 模型输出可能带引号、前缀或多个句子；这里只保留一个可展示的单行标题。
export function normalizeGeneratedTitle(raw: string): string | null {
  const endingPunctuation = /[。．.!！?？,，;；:：]+$/g
  const title = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:标题|title)\s*[:：]\s*/i, '')
    .trim()
    .replace(endingPunctuation, '')
    .trim()
    .replace(/^["'“”‘’「」『』《》]+|["'“”‘’「」『』《》]+$/g, '')
    .trim()
    .replace(endingPunctuation, '')
    .trim()

  if (!title) return null
  const characters = [...title]
  if (characters.length > 120) return null
  return characters.length > generatedTitleCharacterLimit
    ? `${characters.slice(0, generatedTitleCharacterLimit).join('')}…`
    : title
}
