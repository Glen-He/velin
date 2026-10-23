import type { Conversation } from '@velin/contracts/chat'

export function filterConversations(
  conversations: Conversation[],
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return conversations
  return conversations.filter((conversation) =>
    conversation.title.toLocaleLowerCase().includes(normalized),
  )
}
