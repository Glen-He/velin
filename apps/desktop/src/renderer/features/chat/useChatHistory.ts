import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { errorMessage } from '@velin/contracts/error-copy'
import type { AuthUser } from '@velin/contracts/auth-protocol'
import type { ChatOrderRequest } from '@velin/contracts/chat-protocol'
import type { createChatStore } from './chat-store'

type ChatStore = ReturnType<typeof createChatStore>
type ListStatus = 'idle' | 'loading' | 'loaded' | 'error'

function readHistoryError(error: unknown, fallback: string) {
  return errorMessage(error, fallback)
}

export function useChatHistory(
  authUser: AuthUser | null,
  store: ChatStore,
  activeConversationId: string | null,
) {
  const [listStatus, setListStatus] = useState<ListStatus>('idle')
  const [listError, setListError] = useState<string | null>(null)
  const [listPage, setListPage] = useState<{
    search: string
    ids: string[]
    nextCursor: string | null
    loadingMore: boolean
  }>({ search: '', ids: [], nextCursor: null, loadingMore: false })
  const [loadingEarlierFor, setLoadingEarlierFor] = useState<string | null>(
    null,
  )
  const [earlierError, setEarlierError] = useState<{
    conversationId: string
    message: string
  } | null>(null)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null)
  const [orderFallback, setOrderFallback] = useState<string[] | null>(null)
  const [pendingMove, setPendingMove] = useState<ChatOrderRequest | null>(null)
  const orderBusyRef = useRef(false)
  const authUserIdRef = useRef<string | null>(authUser?.id ?? null)
  const listVersionRef = useRef(0)
  const listSearchRef = useRef('')
  const orderVersionRef = useRef(0)
  const orderQueueRef = useRef(Promise.resolve())
  const scopeVersionRef = useRef(0)
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const activeHistoryStatus = activeConversationId
    ? snapshot.history[activeConversationId]?.status
    : undefined
  const remoteStreaming =
    snapshot.conversations
      .find((item) => item.id === activeConversationId)
      ?.messages.some((message) => message.status === 'streaming') === true &&
    !snapshot.requests[activeConversationId ?? '']

  useEffect(() => {
    authUserIdRef.current = authUser?.id ?? null
    scopeVersionRef.current += 1
    orderBusyRef.current = false
    // Main 的账号事件结束旧账号的网络操作展示；清理与请求代次在同一边界完成。
    // oxlint-disable-next-line react/set-state-in-effect
    setPendingOrder(null)
    setPendingMove(null)
    setOrderFallback(null)
    setOrderError(null)
    setLoadingEarlierFor(null)
    setEarlierError(null)
    return () => {
      scopeVersionRef.current += 1
      listVersionRef.current += 1
      orderVersionRef.current += 1
    }
  }, [authUser?.id])

  const loadList = useCallback(
    async (userId: string | null, search = '', before?: string) => {
      const version = ++listVersionRef.current
      listSearchRef.current = search
      if (!userId) {
        setListStatus('idle')
        setListError(null)
        setListPage({
          search: '',
          ids: [],
          nextCursor: null,
          loadingMore: false,
        })
        return
      }

      if (before) setListPage((current) => ({ ...current, loadingMore: true }))
      else {
        setListStatus('loading')
        setListPage({ search, ids: [], nextCursor: null, loadingMore: false })
      }
      setListError(null)
      try {
        const page = await window.velin.chat.listConversations({
          ...(search ? { search } : {}),
          ...(before ? { before } : {}),
        })
        if (
          listVersionRef.current !== version ||
          authUserIdRef.current !== userId
        ) {
          return
        }
        store.hydrateConversations(
          page.conversations,
          Boolean(before) || Boolean(search),
        )
        setListPage((current) => ({
          search,
          ids: [
            ...new Set([
              ...(before ? current.ids : []),
              ...page.conversations.map((item) => item.id),
            ]),
          ],
          nextCursor: page.nextCursor,
          loadingMore: false,
        }))
        setListStatus('loaded')
      } catch (error) {
        if (
          listVersionRef.current !== version ||
          authUserIdRef.current !== userId
        ) {
          return
        }
        setListStatus('error')
        setListPage((current) => ({ ...current, loadingMore: false }))
        setListError(readHistoryError(error, '读取对话列表失败，请稍后重试。'))
      }
    },
    [store],
  )

  useEffect(() => {
    // 列表来自 Main 的外部读取，进入 loading 后必须由请求结果结束。
    // oxlint-disable-next-line react/set-state-in-effect
    void loadList(authUser?.id ?? null)
  }, [authUser?.id, loadList])

  useEffect(() => {
    if (snapshot.conversationRevision > 0 && authUserIdRef.current) {
      void loadList(authUserIdRef.current, listSearchRef.current)
    }
  }, [snapshot.conversationRevision, loadList])

  const loadConversation = useCallback(
    async (conversationId: string) => {
      const userId = authUserIdRef.current
      const scope = scopeVersionRef.current
      if (!userId || !store.beginHistoryLoad(conversationId)) return
      const isCurrent = store.captureHistoryRead(conversationId)
      try {
        const page = await window.velin.chat.loadConversation({
          conversationId,
        })
        if (
          authUserIdRef.current !== userId ||
          scopeVersionRef.current !== scope ||
          !isCurrent()
        )
          return
        store.completeHistoryLoad(conversationId, page)
      } catch (error) {
        if (
          authUserIdRef.current !== userId ||
          scopeVersionRef.current !== scope ||
          !isCurrent()
        )
          return
        store.failHistoryLoad(
          conversationId,
          readHistoryError(error, '读取对话失败，请稍后重试。'),
        )
      }
    },
    [store],
  )

  useEffect(() => {
    if (!activeConversationId) return
    const history = store.getSnapshot().history[activeConversationId]
    if (!history || history.status === 'idle') {
      void loadConversation(activeConversationId)
    }
  }, [activeConversationId, activeHistoryStatus, loadConversation, store])

  useEffect(() => {
    if (
      !authUser?.id ||
      !activeConversationId ||
      activeHistoryStatus !== 'loaded'
    )
      return
    let active = true
    let pending = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const scope = scopeVersionRef.current
    const refresh = async () => {
      if (pending || store.getSnapshot().requests[activeConversationId]) return
      pending = true
      const isCurrent = store.captureHistoryRead(activeConversationId)
      try {
        const page = await window.velin.chat.loadConversation({
          conversationId: activeConversationId,
        })
        if (!active || scopeVersionRef.current !== scope || !isCurrent()) return
        failures = 0
        store.refreshHistory(activeConversationId, page)
      } catch (error) {
        if (!active || scopeVersionRef.current !== scope || !isCurrent()) return
        failures += 1
        if (failures >= 3)
          store.failHistoryLoad(
            activeConversationId,
            readHistoryError(error, '刷新对话失败，请重新读取。'),
          )
      } finally {
        pending = false
        if (active && remoteStreaming && failures < 3)
          timer = setTimeout(() => void refresh(), 2_000)
      }
    }
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    if (remoteStreaming) timer = setTimeout(() => void refresh(), 2_000)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [
    authUser?.id,
    activeConversationId,
    activeHistoryStatus,
    remoteStreaming,
    store,
  ])

  const loadEarlier = useCallback(async () => {
    const scope = scopeVersionRef.current
    const conversationId = store.getSnapshot().activeConversationId
    if (!conversationId || loadingEarlierFor) return
    if (store.getSnapshot().requests[conversationId]) return
    const history = store.getSnapshot().history[conversationId]
    if (history?.status !== 'loaded' || !history.hasMore || !history.nextBefore)
      return
    const userId = authUserIdRef.current
    if (!userId) return
    const isCurrent = store.captureHistoryRead(conversationId)

    setLoadingEarlierFor(conversationId)
    setEarlierError(null)
    try {
      const page = await window.velin.chat.loadConversation({
        conversationId,
        before: history.nextBefore,
      })
      if (
        authUserIdRef.current !== userId ||
        scopeVersionRef.current !== scope ||
        !isCurrent()
      )
        return
      store.prependHistory(conversationId, page)
    } catch (error) {
      if (
        authUserIdRef.current !== userId ||
        scopeVersionRef.current !== scope ||
        !isCurrent()
      )
        return
      setEarlierError({
        conversationId,
        message: readHistoryError(error, '读取更早消息失败，请重试。'),
      })
    } finally {
      if (
        authUserIdRef.current === userId &&
        scopeVersionRef.current === scope
      ) {
        setLoadingEarlierFor(null)
      }
    }
  }, [loadingEarlierFor, store])

  const retryActiveHistory = useCallback(() => {
    const conversationId = store.getSnapshot().activeConversationId
    if (conversationId) void loadConversation(conversationId)
  }, [loadConversation, store])

  const retryList = useCallback(() => {
    void loadList(authUserIdRef.current, listPage.search)
  }, [loadList, listPage.search])

  const searchList = useCallback(
    (search: string) => {
      void loadList(authUserIdRef.current, search.trim().slice(0, 100))
    },
    [loadList],
  )

  const loadMoreConversations = useCallback(() => {
    if (
      listStatus === 'loading' ||
      listPage.loadingMore ||
      !listPage.nextCursor
    )
      return
    void loadList(authUserIdRef.current, listPage.search, listPage.nextCursor)
  }, [listPage, listStatus, loadList])

  const persistOrder = useCallback(
    async (move: ChatOrderRequest, fallback: string[], version: number) => {
      const userId = authUserIdRef.current
      const scope = scopeVersionRef.current
      if (!userId) return

      try {
        await window.velin.chat.reorderConversations(move)
        if (
          version !== orderVersionRef.current ||
          authUserIdRef.current !== userId
        ) {
          return
        }
        setOrderError(null)
        setPendingOrder(null)
        setPendingMove(null)
        setOrderFallback(null)
      } catch (error) {
        if (
          version !== orderVersionRef.current ||
          authUserIdRef.current !== userId
        ) {
          return
        }
        store.setConversationOrder(fallback)
        const message = readHistoryError(
          error,
          '保存对话排序失败，请稍后重试。',
        )
        setOrderError(message)
        if (message.includes('列表已变化')) {
          setPendingOrder(null)
          setOrderFallback(null)
          void loadList(userId)
        }
      } finally {
        if (scopeVersionRef.current === scope) orderBusyRef.current = false
      }
    },
    [loadList, store],
  )

  const queueOrder = useCallback(
    (move: ChatOrderRequest, fallback: string[], version: number) => {
      const scope = scopeVersionRef.current
      orderQueueRef.current = orderQueueRef.current
        .then(() => {
          if (
            scopeVersionRef.current !== scope ||
            version !== orderVersionRef.current
          )
            return
          return persistOrder(move, fallback, version)
        })
        .catch(() => {})
    },
    [persistOrder],
  )

  const reorderConversations = useCallback(
    (source: string, target: string) => {
      if (orderBusyRef.current) return
      const previous = store
        .getSnapshot()
        .conversations.map((conversation) => conversation.id)
      store.reorder(source, target)
      const next = store
        .getSnapshot()
        .conversations.map((conversation) => conversation.id)
      if (
        previous.length === next.length &&
        previous.every((id, index) => id === next[index])
      ) {
        return
      }

      const version = ++orderVersionRef.current
      const move: ChatOrderRequest = {
        sourceId: source,
        targetId: target,
        placement:
          previous.indexOf(source) > previous.indexOf(target)
            ? 'before'
            : 'after',
      }
      orderBusyRef.current = true
      setPendingOrder(next)
      setPendingMove(move)
      setOrderFallback(previous)
      setOrderError(null)
      queueOrder(move, previous, version)
    },
    [queueOrder, store],
  )

  const retryOrder = useCallback(() => {
    if (!pendingOrder || !orderFallback || !pendingMove || orderBusyRef.current)
      return
    orderBusyRef.current = true
    const version = ++orderVersionRef.current
    store.setConversationOrder(pendingOrder)
    setOrderError(null)
    queueOrder(pendingMove, orderFallback, version)
  }, [orderFallback, pendingOrder, pendingMove, queueOrder, store])

  const renameConversation = useCallback(
    async (conversationId: string, title: string) => {
      const scope = scopeVersionRef.current
      let saved: string
      try {
        saved = await window.velin.chat.renameConversation({
          conversationId,
          title,
        })
      } catch (error) {
        throw new Error(readHistoryError(error, '重命名对话失败，请稍后重试。'))
      }
      if (scopeVersionRef.current === scope) {
        store.rename(conversationId, saved)
        // 写入成功后使更早的列表读取失效，再读取当前搜索，防止旧标题回写。
        void loadList(authUserIdRef.current, listSearchRef.current)
      }
    },
    [store, loadList],
  )

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      const scope = scopeVersionRef.current
      store.stop(conversationId)
      try {
        await window.velin.chat.deleteConversation({ conversationId })
      } catch (error) {
        throw new Error(readHistoryError(error, '删除对话失败，请稍后重试。'))
      }
      if (scopeVersionRef.current === scope) {
        store.remove(conversationId)
        void loadList(authUserIdRef.current, listSearchRef.current)
      }
    },
    [store, loadList],
  )

  return {
    restoreVersion: async (conversationId: string, versionId: string) => {
      const scope = scopeVersionRef.current
      if (!store.beginHistoryRestore(conversationId))
        throw new Error('请等待当前操作结束后再恢复版本。')
      const isCurrent = store.captureHistoryRead(conversationId)
      let restored = false
      try {
        await window.velin.memory.restoreVersion({ conversationId, versionId })
        restored = true
        if (scopeVersionRef.current !== scope || !isCurrent()) return
        const page = await window.velin.chat.loadConversation({
          conversationId,
        })
        if (scopeVersionRef.current === scope && isCurrent())
          store.completeHistoryLoad(conversationId, page)
      } catch (cause) {
        const message = restored
          ? '版本已恢复，但重新读取失败，请重试。'
          : readHistoryError(cause, '恢复版本失败，请重新读取后重试。')
        if (scopeVersionRef.current === scope && isCurrent())
          store.failHistoryLoad(conversationId, message)
        throw new Error(message)
      }
    },
    listStatus,
    listError,
    retryList,
    searchList,
    loadMoreConversations,
    hasMoreConversations: listPage.nextCursor !== null,
    isLoadingMoreConversations: listPage.loadingMore,
    isOrderSaving: pendingOrder !== null && orderError === null,
    searchConversations: listPage.search
      ? listPage.ids.flatMap((id) => {
          const conversation = snapshot.conversations.find(
            (item) => item.id === id,
          )
          return conversation ? [conversation] : []
        })
      : null,
    listConversations: snapshot.conversations.filter(
      (conversation) =>
        listPage.ids.includes(conversation.id) ||
        !conversation.isPersisted ||
        conversation.id === activeConversationId ||
        snapshot.requests[conversation.id],
    ),
    loadEarlier,
    isLoadingEarlier:
      loadingEarlierFor !== null && loadingEarlierFor === activeConversationId,
    earlierError:
      earlierError?.conversationId === activeConversationId
        ? earlierError.message
        : null,
    retryActiveHistory,
    deleteConversation,
    renameConversation,
    reorderConversations,
    orderError,
    retryOrder,
  }
}
