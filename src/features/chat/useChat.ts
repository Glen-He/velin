import { useEffect, useState, useSyncExternalStore } from 'react'
import { createChatStore } from './chat-store'

export function useChat() {
  const [store] = useState(() => createChatStore(window.velin.chat))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => {
    const unsubscribe = window.velin.chat.subscribe(store.receive)
    return () => {
      unsubscribe()
      store.reset()
    }
  }, [store])
  const conversation = state.conversations.find(
    (item) => item.id === state.activeConversationId,
  )
  return {
    ...state,
    conversation,
    store,
    request: conversation ? state.requests[conversation.id] : undefined,
    error: conversation ? state.errors[conversation.id] : undefined,
  }
}
