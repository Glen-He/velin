import { arrayMove } from '@dnd-kit/sortable'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import {
  Group,
  Panel,
  Separator,
  usePanelRef,
} from 'react-resizable-panels'
import type {
  Layout,
  LayoutChangedMeta,
} from 'react-resizable-panels'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Conversation, Message, MessageRole } from './shared/chat'
import type { SendMessageRequest } from './shared/chat-protocol'
import ChatView from './features/chat/ChatView'
import ConversationSidebar from './features/conversations/ConversationSidebar'
import SettingsView, { SettingsNavigation } from './features/settings/SettingsView'
import AuthView from './features/auth/AuthView'
import type { AuthUser } from './shared/auth-protocol'
import type { AuthFlow, AuthIntent } from './shared/auth-protocol'
import { getSidebarDragDecision } from './shared/sidebar-gesture'
import type { SidebarDragPhase } from './shared/sidebar-gesture'
import type {
  AppearanceMode,
  InterfaceFontScale,
  SettingsSection,
} from './features/settings/SettingsView'

type ActiveRequest = {
  requestId: string
  conversationId: string
  messageId?: string
}

type ActiveRequests = Record<string, ActiveRequest>
type ConversationErrors = Record<string, string | undefined>
type SidebarMode = 'open' | 'peek' | 'closed'
type AppView = 'chat' | 'settings'

const defaultSidebarWidth = 260
const minimumSidebarWidth = defaultSidebarWidth
const maximumSidebarWidth = 420
const sidebarCollapsePullDistance = 72
const sidebarAnimationDuration = 145
const preferenceStorageKeys = {
  appearanceMode: 'velin:preference:appearance-mode',
  edgeRevealEnabled: 'velin:preference:edge-reveal-enabled',
  fontScale: 'velin:preference:font-scale',
  sendOnEnter: 'velin:preference:send-on-enter',
} as const

type SidebarPointerDrag = {
  pointerId: number
  startX: number
  startedAtMinimum: boolean
  phase: SidebarDragPhase
}

function readStoredChoice<T extends string>(
  key: string,
  allowedValues: readonly T[],
  fallback: T,
) {
  try {
    const storedValue = window.localStorage.getItem(key)

    if (storedValue && allowedValues.includes(storedValue as T)) {
      return storedValue as T
    }
  } catch {
    // Preferences remain usable for this session if storage is unavailable.
  }

  return fallback
}

function readStoredBoolean(key: string, fallback: boolean) {
  try {
    const storedValue = window.localStorage.getItem(key)

    if (storedValue === 'true') {
      return true
    }

    if (storedValue === 'false') {
      return false
    }
  } catch {
    // Preferences remain usable for this session if storage is unavailable.
  }

  return fallback
}

function storePreference(key: string, value: string | boolean) {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // The visible setting still applies even if persistence is unavailable.
  }
}

function createConversation(firstMessage: Message): Conversation {
  return {
    id: crypto.randomUUID(),
    title: createConversationTitle(firstMessage.content),
    messages: [firstMessage],
    createdAt: firstMessage.createdAt,
    updatedAt: firstMessage.createdAt,
  }
}

function createMessage(role: MessageRole, content: string): Message {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
  }
}

function createConversationTitle(content: string) {
  const compactContent = content.replace(/\s+/g, ' ').trim()

  if (compactContent.length <= 30) {
    return compactContent || '新对话'
  }

  return `${compactContent.slice(0, 30)}…`
}

function buildPromptMessages(messages: Message[]): SendMessageRequest['messages'] {
  const prompt: SendMessageRequest['messages'] = []
  let totalLength = 0

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const { role, content } = messages[index]
    if (content.trim().length === 0) continue
    if (
      prompt.length === 32 ||
      content.length > 8_000 ||
      totalLength + content.length > 32_000
    ) break

    prompt.unshift({ role, content })
    totalLength += content.length
  }

  return prompt
}

function removeActiveRequest(
  currentRequests: ActiveRequests,
  conversationId: string,
  requestId: string,
) {
  const currentRequest = currentRequests[conversationId]

  if (!currentRequest || currentRequest.requestId !== requestId) {
    return currentRequests
  }

  const nextRequests = { ...currentRequests }
  delete nextRequests[conversationId]
  return nextRequests
}

function removeEmptyAssistantMessage(
  conversations: Conversation[],
  conversationId: string,
  messageId: string | undefined,
) {
  if (!messageId) return conversations

  return conversations.map((conversation) => {
    if (conversation.id !== conversationId) return conversation
    const messages = conversation.messages.filter(
      (message) => message.id !== messageId || message.content.length > 0,
    )
    return messages.length === conversation.messages.length
      ? conversation
      : { ...conversation, messages }
  })
}

function App() {
  const [appView, setAppView] = useState<AppView>('chat')
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [isAuthViewOpen, setIsAuthViewOpen] = useState(false)
  const [isOpeningAuthBrowser, setIsOpeningAuthBrowser] = useState(false)
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>('general')
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() =>
    readStoredChoice<AppearanceMode>(
      preferenceStorageKeys.appearanceMode,
      ['system', 'light', 'dark'],
      'system',
    ),
  )
  const [fontScale, setFontScale] = useState<InterfaceFontScale>(() =>
    readStoredChoice<InterfaceFontScale>(
      preferenceStorageKeys.fontScale,
      ['small', 'default', 'large'],
      'default',
    ),
  )
  const [sendOnEnter, setSendOnEnter] = useState(() =>
    readStoredBoolean(preferenceStorageKeys.sendOnEnter, true),
  )
  const [edgeRevealEnabled, setEdgeRevealEnabled] = useState(() =>
    readStoredBoolean(preferenceStorageKeys.edgeRevealEnabled, true),
  )
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  )
  const [activeRequests, setActiveRequests] = useState<ActiveRequests>({})
  const [conversationErrors, setConversationErrors] = useState<ConversationErrors>({})
  const activeRequestsRef = useRef<ActiveRequests>({})
  const authenticatedUserIdRef = useRef<string | null>(null)
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('open')
  const [isSidebarPanelCollapsible, setIsSidebarPanelCollapsible] =
    useState(false)
  const [isSidebarResizing, setIsSidebarResizing] = useState(false)
  const [isSidebarAnimating, setIsSidebarAnimating] = useState(false)
  const [isEdgeRevealArmed, setIsEdgeRevealArmed] = useState(true)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth)
  const sidebarPanelRef = usePanelRef()
  const sidebarWidthRef = useRef(defaultSidebarWidth)
  const sidebarModeRef = useRef<SidebarMode>('open')
  const sidebarPointerDragRef = useRef<SidebarPointerDrag | null>(null)
  const sidebarPointerCleanupRef = useRef<(() => void) | null>(null)
  const sidebarAnimationTimerRef = useRef<number | null>(null)
  const sidebarVisibilityIntentRef = useRef<'hide' | 'show' | null>(null)
  const isSidebarOpen = sidebarMode !== 'closed'

  useEffect(() => {
    let isDisposed = false
    let receivedStateEvent = false

    const applyAuthUser = (user: AuthUser | null) => {
      const previousUserId = authenticatedUserIdRef.current
      if (previousUserId && previousUserId !== user?.id) {
        for (const request of Object.values(activeRequestsRef.current)) {
          window.velin.chat.stop({
            requestId: request.requestId,
            conversationId: request.conversationId,
          })
        }
        activeRequestsRef.current = {}
        setActiveRequests({})
        setConversations([])
        setActiveConversationId(null)
        setConversationErrors({})
      }
      authenticatedUserIdRef.current = user?.id ?? null
      setAuthUser(user)
    }

    const unsubscribeState = window.velin.auth.subscribe(({ user, reason }) => {
      if (isDisposed) {
        return
      }

      receivedStateEvent = true
      applyAuthUser(user)
      if (reason === 'session-expired') {
        setAuthError(null)
        setAuthNotice('登录状态已失效，请重新登录后继续对话。')
        setIsAuthViewOpen(true)
        setIsOpeningAuthBrowser(false)
      } else if (user) {
        setAuthError(null)
        setAuthNotice(null)
        setIsAuthViewOpen(false)
        setIsOpeningAuthBrowser(false)
      }
    })
    const unsubscribeErrors = window.velin.auth.subscribeErrors((error) => {
      if (isDisposed) {
        return
      }

      setAuthError(error.message)
      setIsOpeningAuthBrowser(false)
    })

    void window.velin.auth
      .getState()
      .then(({ user }) => {
        if (!isDisposed && !receivedStateEvent) {
          applyAuthUser(user)
        }
      })
      .catch(() => {
        if (!isDisposed) {
          setAuthError('暂时无法连接认证服务，请确认本地服务已经启动。')
        }
      })

    return () => {
      isDisposed = true
      unsubscribeState()
      unsubscribeErrors()
    }
  }, [])

  useEffect(() => {
    return window.velin.menu.subscribe((action) => {
      if (action === 'open-settings') {
        setAppView('settings')
        return
      }

      if (action === 'sign-out') {
        void handleSignOut()
        return
      }

      setActiveConversationId(null)
      setAppView('chat')
    })
  }, [])

  async function handleRequestSignIn(
    intent: AuthIntent = 'sign-in',
    flow: AuthFlow = 'browser',
  ) {
    setAuthError(null)
    setIsOpeningAuthBrowser(true)

    try {
      return await window.velin.auth.requestSignIn(intent, flow)
    } catch {
      setAuthError('无法打开系统浏览器，请稍后重试。')
      return null
    } finally {
      setIsOpeningAuthBrowser(false)
    }
  }

  async function handleSignOut() {
    setAuthError(null)

    try {
      await window.velin.auth.signOut()
      setAuthUser(null)
      setIsAuthViewOpen(false)
      setAppView('chat')
    } catch {
      setAuthError('退出登录失败，请检查网络后重试。')
    }
  }

  async function handleAuthenticateCode(code: string) {
    setAuthError(null)
    await window.velin.auth.authenticateCode(code)
  }

  function openAuthView(notice: string | null = null) {
    setAuthError(null)
    setAuthNotice(notice)
    setIsAuthViewOpen(true)
  }

  // 对话属于登录后的能力：未登录时不发送请求，直接把认证页带到用户面前。
  function ensureSignedIn() {
    if (authUser) {
      return true
    }

    openAuthView('请先登录或注册，再开始对话。')
    return false
  }

  useLayoutEffect(() => {
    const root = document.documentElement

    if (appearanceMode === 'system') {
      delete root.dataset.theme
    } else {
      root.dataset.theme = appearanceMode
    }
    storePreference(preferenceStorageKeys.appearanceMode, appearanceMode)

    return () => {
      delete root.dataset.theme
    }
  }, [appearanceMode])

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.fontScale = fontScale
    storePreference(preferenceStorageKeys.fontScale, fontScale)

    return () => {
      delete root.dataset.fontScale
    }
  }, [fontScale])

  useEffect(() => {
    storePreference(preferenceStorageKeys.sendOnEnter, sendOnEnter)
  }, [sendOnEnter])

  useEffect(() => {
    storePreference(
      preferenceStorageKeys.edgeRevealEnabled,
      edgeRevealEnabled,
    )
  }, [edgeRevealEnabled])

  useEffect(() => {
    const unsubscribe = window.velin.chat.subscribe((event) => {
      const activeRequest = activeRequestsRef.current[event.conversationId]

      if (!activeRequest || activeRequest.requestId !== event.requestId) {
        return
      }

      if (event.type === 'message-start') {
        const timestamp = Date.now()
        const nextRequests = {
          ...activeRequestsRef.current,
          [event.conversationId]: {
            ...activeRequest,
            messageId: event.messageId,
          },
        }
        activeRequestsRef.current = nextRequests
        setActiveRequests(nextRequests)

        setConversations((currentConversations) =>
          currentConversations.map((conversation) => {
            if (conversation.id !== event.conversationId) {
              return conversation
            }

            return {
              ...conversation,
              messages: [
                ...conversation.messages,
                {
                  id: event.messageId,
                  role: 'assistant',
                  content: '',
                  createdAt: timestamp,
                },
              ],
              updatedAt: timestamp,
            }
          }),
        )
        return
      }

      if (
        event.type === 'text-delta' &&
        activeRequest.messageId === event.messageId
      ) {
        setConversations((currentConversations) =>
          currentConversations.map((conversation) => {
            if (conversation.id !== event.conversationId) {
              return conversation
            }

            return {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === event.messageId
                  ? { ...message, content: message.content + event.delta }
                  : message,
              ),
              updatedAt: Date.now(),
            }
          }),
        )
        return
      }

      if (
        event.type === 'message-complete' &&
        activeRequest.messageId === event.messageId
      ) {
        const nextRequests = removeActiveRequest(
          activeRequestsRef.current,
          event.conversationId,
          event.requestId,
        )
        activeRequestsRef.current = nextRequests
        setActiveRequests(nextRequests)
        return
      }

      if (event.type === 'message-stopped') {
        setConversations((currentConversations) =>
          removeEmptyAssistantMessage(
            currentConversations,
            event.conversationId,
            activeRequest.messageId,
          ),
        )
        const nextRequests = removeActiveRequest(
          activeRequestsRef.current,
          event.conversationId,
          event.requestId,
        )
        activeRequestsRef.current = nextRequests
        setActiveRequests(nextRequests)
        return
      }

      if (
        event.type === 'error' &&
        (event.messageId === undefined ||
          activeRequest.messageId === event.messageId)
      ) {
        setConversations((currentConversations) =>
          removeEmptyAssistantMessage(
            currentConversations,
            event.conversationId,
            activeRequest.messageId,
          ),
        )
        const nextRequests = removeActiveRequest(
          activeRequestsRef.current,
          event.conversationId,
          event.requestId,
        )
        activeRequestsRef.current = nextRequests
        setActiveRequests(nextRequests)
        setConversationErrors((currentErrors) => ({
          ...currentErrors,
          [event.conversationId]: event.message,
        }))
      }
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    let settlingFrame: number | null = null
    const applySidebarLayout = () => {
      const sidebarPanel = sidebarPanelRef.current
      const visibilityIntent = sidebarVisibilityIntentRef.current

      if (!sidebarPanel) {
        return
      }

      if (visibilityIntent === 'show' && sidebarPanel.isCollapsed()) {
        sidebarPanel.expand()
        sidebarPanel.resize(sidebarWidth)
      } else if (visibilityIntent === 'hide' && !sidebarPanel.isCollapsed()) {
        sidebarPanel.collapse()
      } else if (
        sidebarModeRef.current !== 'closed' &&
        Math.abs(sidebarPanel.getSize().inPixels - sidebarWidth) >= 0.5
      ) {
        sidebarPanel.resize(sidebarWidth)
      }
    }
    const animationFrame = window.requestAnimationFrame(() => {
      const activeDrag = sidebarPointerDragRef.current
      if (activeDrag && activeDrag.phase !== 'resizing') {
        // Let the drag-only transition rule leave the rendered frame before
        // issuing the same animated collapse/expand command as the button.
        settlingFrame = window.requestAnimationFrame(applySidebarLayout)
      } else {
        applySidebarLayout()
      }
    })

    return () => {
      window.cancelAnimationFrame(animationFrame)
      if (settlingFrame !== null) {
        window.cancelAnimationFrame(settlingFrame)
      }
    }
  }, [sidebarMode, sidebarPanelRef, sidebarWidth])

  useEffect(() => {
    if (isSidebarOpen || isEdgeRevealArmed) {
      return
    }

    const armEdgeRevealAfterPointerLeaves = (event: PointerEvent) => {
      if (event.clientX > 12) {
        setIsEdgeRevealArmed(true)
      }
    }

    window.addEventListener('pointermove', armEdgeRevealAfterPointerLeaves)

    return () => {
      window.removeEventListener('pointermove', armEdgeRevealAfterPointerLeaves)
    }
  }, [isEdgeRevealArmed, isSidebarOpen])

  useEffect(
    () => () => {
      sidebarPointerCleanupRef.current?.()

      if (sidebarAnimationTimerRef.current !== null) {
        window.clearTimeout(sidebarAnimationTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    let isSubscribed = true
    const windowApi = window.velin.window
    const unsubscribe = windowApi.subscribeFullScreenState(setIsFullScreen)

    void windowApi
      .getFullScreenState()
      .then((nextIsFullScreen) => {
        if (isSubscribed) {
          setIsFullScreen(nextIsFullScreen)
        }
      })
      .catch(() => {
        // Main/preload can briefly be unavailable while Electron restarts in development.
      })

    return () => {
      isSubscribed = false
      unsubscribe()
    }
  }, [])

  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  )

  function handleNewConversation() {
    if (!ensureSignedIn()) return
    setActiveConversationId(null)
    setAppView('chat')
  }

  function handleDeleteConversation(conversationId: string) {
    const conversationIndex = conversations.findIndex(
      (conversation) => conversation.id === conversationId,
    )

    if (conversationIndex === -1) {
      return
    }

    const activeRequest = activeRequestsRef.current[conversationId]

    if (activeRequest) {
      const nextRequests = removeActiveRequest(
        activeRequestsRef.current,
        conversationId,
        activeRequest.requestId,
      )
      activeRequestsRef.current = nextRequests
      setActiveRequests(nextRequests)

      window.velin.chat.stop({
        requestId: activeRequest.requestId,
        conversationId,
      })
    }

    const remainingConversations = conversations.filter(
      (conversation) => conversation.id !== conversationId,
    )

    setConversationErrors((currentErrors) => {
      const nextErrors = { ...currentErrors }
      delete nextErrors[conversationId]
      return nextErrors
    })

    if (remainingConversations.length === 0) {
      setConversations([])
      setActiveConversationId(null)
      return
    }

    setConversations(remainingConversations)

    if (activeConversationId === conversationId) {
      const nextActiveIndex = Math.min(
        conversationIndex,
        remainingConversations.length - 1,
      )
      setActiveConversationId(remainingConversations[nextActiveIndex].id)
    }
  }

  function handleReorderConversation(
    sourceConversationId: string,
    targetConversationId: string,
  ) {
    if (sourceConversationId === targetConversationId) {
      return
    }

    setConversations((currentConversations) => {
      const sourceIndex = currentConversations.findIndex(
        (conversation) => conversation.id === sourceConversationId,
      )
      const targetIndex = currentConversations.findIndex(
        (conversation) => conversation.id === targetConversationId,
      )

      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
        return currentConversations
      }

      return arrayMove(currentConversations, sourceIndex, targetIndex)
    })
  }

  function handleSendMessage(content: string) {
    if (!ensureSignedIn()) {
      return
    }

    if (content.trim().length === 0 || content.length > 8_000) return

    const userMessage = createMessage('user', content)
    const newConversation = activeConversation
      ? undefined
      : createConversation(userMessage)
    const conversationId = activeConversation?.id ?? newConversation?.id

    if (!conversationId) {
      return
    }

    if (activeRequestsRef.current[conversationId]) {
      return
    }

    const request: SendMessageRequest = {
      requestId: crypto.randomUUID(),
      conversationId,
      messages: buildPromptMessages([
        ...(activeConversation?.messages ?? []),
        userMessage,
      ]),
    }

    if (newConversation) {
      setConversations((currentConversations) => [
        newConversation,
        ...currentConversations,
      ])
      setActiveConversationId(newConversation.id)
    } else {
      setConversations((currentConversations) =>
        currentConversations.map((conversation) => {
          if (conversation.id !== conversationId) {
            return conversation
          }

          return {
            ...conversation,
            title:
              !conversation.messages.some((message) => message.role === 'user')
                ? createConversationTitle(content)
                : conversation.title,
            messages: [...conversation.messages, userMessage],
            updatedAt: userMessage.createdAt,
          }
        }),
      )
    }

    const nextRequests = {
      ...activeRequestsRef.current,
      [conversationId]: {
        requestId: request.requestId,
        conversationId,
      },
    }
    activeRequestsRef.current = nextRequests
    setActiveRequests(nextRequests)
    setConversationErrors((currentErrors) => {
      const nextErrors = { ...currentErrors }
      delete nextErrors[conversationId]
      return nextErrors
    })

    window.velin.chat.send(request)
  }

  function handleEditMessage(
    conversationId: string,
    messageId: string,
    content: string,
  ) {
    if (
      content.trim().length === 0 ||
      content.length > 8_000 ||
      activeRequestsRef.current[conversationId]
    ) {
      return false
    }

    const conversation = conversations.find(
      (currentConversation) => currentConversation.id === conversationId,
    )
    const messageIndex = conversation?.messages.findIndex(
      (message) => message.id === messageId,
    )

    if (
      !conversation ||
      messageIndex === undefined ||
      messageIndex < 0 ||
      conversation.messages[messageIndex].role !== 'user'
    ) {
      return false
    }

    if (!ensureSignedIn()) {
      return false
    }

    const updatedAt = Date.now()
    const request: SendMessageRequest = {
      requestId: crypto.randomUUID(),
      conversationId,
      messages: buildPromptMessages([
        ...conversation.messages.slice(0, messageIndex),
        { ...conversation.messages[messageIndex], content },
      ]),
    }

    setConversations((currentConversations) =>
      currentConversations.map((currentConversation) => {
        if (currentConversation.id !== conversationId) {
          return currentConversation
        }

        const currentMessageIndex = currentConversation.messages.findIndex(
          (message) => message.id === messageId,
        )

        if (
          currentMessageIndex < 0 ||
          currentConversation.messages[currentMessageIndex].role !== 'user'
        ) {
          return currentConversation
        }

        const isFirstUserMessage = !currentConversation.messages
          .slice(0, currentMessageIndex)
          .some((message) => message.role === 'user')
        const editedMessage: Message = {
          ...currentConversation.messages[currentMessageIndex],
          content,
        }

        return {
          ...currentConversation,
          title: isFirstUserMessage
            ? createConversationTitle(content)
            : currentConversation.title,
          messages: [
            ...currentConversation.messages.slice(0, currentMessageIndex),
            editedMessage,
          ],
          updatedAt,
        }
      }),
    )

    const nextRequests = {
      ...activeRequestsRef.current,
      [conversationId]: {
        requestId: request.requestId,
        conversationId,
      },
    }
    activeRequestsRef.current = nextRequests
    setActiveRequests(nextRequests)
    setConversationErrors((currentErrors) => {
      const nextErrors = { ...currentErrors }
      delete nextErrors[conversationId]
      return nextErrors
    })

    window.velin.chat.send(request)
    return true
  }

  function handleStopMessage(conversationId: string) {
    const activeRequest = activeRequestsRef.current[conversationId]

    if (!activeRequest) {
      return
    }

    window.velin.chat.stop({
      requestId: activeRequest.requestId,
      conversationId,
    })
  }

  const currentRequest = activeConversation
    ? activeRequests[activeConversation.id]
    : undefined
  const currentError = activeConversation
    ? conversationErrors[activeConversation.id]
    : undefined

  function startSidebarAnimation() {
    if (sidebarAnimationTimerRef.current !== null) {
      window.clearTimeout(sidebarAnimationTimerRef.current)
    }

    setIsSidebarAnimating(true)
    sidebarAnimationTimerRef.current = window.setTimeout(() => {
      sidebarAnimationTimerRef.current = null
      setIsSidebarAnimating(false)
    }, sidebarAnimationDuration)
  }

  function showSidebar() {
    startSidebarAnimation()
    sidebarModeRef.current = 'open'
    sidebarVisibilityIntentRef.current = 'show'
    setIsSidebarPanelCollapsible(true)
    setSidebarMode('open')
  }

  function peekSidebar() {
    if (sidebarModeRef.current !== 'closed') {
      return
    }

    startSidebarAnimation()
    sidebarModeRef.current = 'peek'
    sidebarVisibilityIntentRef.current = 'show'
    setIsSidebarPanelCollapsible(true)
    setSidebarMode('peek')
  }

  function hideSidebar({ resetWidthOnShow = false } = {}) {
    if (resetWidthOnShow) {
      sidebarWidthRef.current = defaultSidebarWidth
      setSidebarWidth(defaultSidebarWidth)
    }
    startSidebarAnimation()
    sidebarModeRef.current = 'closed'
    sidebarVisibilityIntentRef.current = 'hide'
    setIsEdgeRevealArmed(true)
    setIsSidebarPanelCollapsible(true)
    setIsSidebarResizing(false)
    setSidebarMode('closed')
  }

  function resetSidebarWidth() {
    startSidebarAnimation()
    sidebarWidthRef.current = defaultSidebarWidth
    sidebarVisibilityIntentRef.current = 'show'
    sidebarModeRef.current = 'open'
    setSidebarWidth(defaultSidebarWidth)
    setIsSidebarPanelCollapsible(true)
    setSidebarMode('open')
    const sidebarPanel = sidebarPanelRef.current
    if (sidebarPanel?.isCollapsed()) {
      sidebarPanel.expand()
    }
    sidebarPanel?.resize(defaultSidebarWidth)
  }

  function handleSidebarPointerLeave() {
    if (sidebarModeRef.current === 'peek') {
      hideSidebar()
    }
  }

  function handleSidebarResizePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    sidebarPointerCleanupRef.current?.()

    const currentWidth =
      sidebarPanelRef.current?.getSize().inPixels ?? sidebarWidthRef.current
    const drag: SidebarPointerDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startedAtMinimum: currentWidth <= minimumSidebarWidth + 0.5,
      phase: 'resizing',
    }

    sidebarPointerDragRef.current = drag
    setIsSidebarResizing(true)

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== drag.pointerId) {
        return
      }

      const currentPanelWidth =
        sidebarPanelRef.current?.getSize().inPixels ?? sidebarWidthRef.current
      const decision = getSidebarDragDecision(
        drag,
        pointerEvent.clientX,
        currentPanelWidth,
        minimumSidebarWidth,
        sidebarCollapsePullDistance,
      )

      if (drag.phase !== 'resizing' || decision) {
        pointerEvent.preventDefault()
        pointerEvent.stopImmediatePropagation()
      }

      if (decision === 'restore') {
        drag.phase = 'restored'
        sidebarWidthRef.current = defaultSidebarWidth
        setSidebarWidth(defaultSidebarWidth)
        showSidebar()
        return
      }

      if (decision !== 'collapse') {
        return
      }

      drag.phase = 'collapsed'
      hideSidebar({ resetWidthOnShow: true })
    }

    const finishPointerDrag = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== drag.pointerId) {
        return
      }

      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', finishPointerDrag, true)
      window.removeEventListener('pointercancel', finishPointerDrag, true)
      if (drag.phase !== 'resizing') {
        window.requestAnimationFrame(() => {
          if (sidebarPointerDragRef.current === drag) {
            sidebarPointerDragRef.current = null
          }
        })
      } else {
        sidebarPointerDragRef.current = null
      }
      sidebarPointerCleanupRef.current = null
      setIsSidebarResizing(false)
    }

    sidebarPointerCleanupRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', finishPointerDrag, true)
      window.removeEventListener('pointercancel', finishPointerDrag, true)
      sidebarPointerDragRef.current = null
      sidebarPointerCleanupRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', finishPointerDrag, true)
    window.addEventListener('pointercancel', finishPointerDrag, true)
  }

  function handleSidebarLayoutChanged(
    _layout: Layout,
    meta: LayoutChangedMeta,
  ) {
    const measuredSidebarWidth =
      sidebarPanelRef.current?.getSize().inPixels ?? sidebarWidthRef.current
    const visibilityIntent = sidebarVisibilityIntentRef.current

    if (visibilityIntent === 'hide') {
      if (measuredSidebarWidth <= 1) {
        sidebarVisibilityIntentRef.current = null
        sidebarModeRef.current = 'closed'
        setSidebarMode('closed')
      }

      return
    }

    if (visibilityIntent === 'show') {
      if (measuredSidebarWidth > 1) {
        sidebarVisibilityIntentRef.current = null
        setIsSidebarPanelCollapsible(false)
      }

      return
    }

    if (
      !meta.isUserInteraction ||
      (sidebarPointerDragRef.current &&
        sidebarPointerDragRef.current.phase !== 'resizing')
    ) {
      return
    }

    if (measuredSidebarWidth <= 1) {
      sidebarWidthRef.current = defaultSidebarWidth
      setSidebarWidth(defaultSidebarWidth)
      sidebarModeRef.current = 'closed'
      setSidebarMode('closed')
      setIsEdgeRevealArmed(false)
      return
    }

    sidebarWidthRef.current = measuredSidebarWidth
    setSidebarWidth((currentWidth) =>
      Math.abs(currentWidth - measuredSidebarWidth) < 0.5
        ? currentWidth
        : measuredSidebarWidth,
    )

    if (sidebarModeRef.current === 'closed') {
      sidebarModeRef.current = 'open'
      setSidebarMode('open')
    }

  }

  if (isAuthViewOpen) {
    return (
      <AuthView
        errorMessage={authError}
        isOpeningBrowser={isOpeningAuthBrowser}
        noticeMessage={authNotice}
        onAuthenticateCode={handleAuthenticateCode}
        onClose={() => {
          setAuthError(null)
          setAuthNotice(null)
          setIsAuthViewOpen(false)
        }}
        onOpenAuthorizationPage={() =>
          void handleRequestSignIn('sign-in', 'manual-code')
        }
        onRegister={() => handleRequestSignIn('sign-up')}
        onSignIn={() => handleRequestSignIn('sign-in')}
      />
    )
  }

  return (
    <div
      className={`app-shell is-${appView}-view${
        isSidebarOpen ? '' : ' is-sidebar-collapsed'
      }${isFullScreen ? ' is-full-screen' : ''}`}
    >
      <div className="window-titlebar">
        <div className="window-titlebar-drag-surface" aria-hidden="true" />
        <button
          className="sidebar-toggle no-drag"
          type="button"
          aria-label={isSidebarOpen ? '隐藏侧边栏' : '显示侧边栏'}
          aria-expanded={isSidebarOpen}
          title={isSidebarOpen ? '隐藏侧边栏' : '显示侧边栏'}
          onClick={isSidebarOpen ? () => hideSidebar() : showSidebar}
        >
          {isSidebarOpen ? (
            <PanelLeftClose aria-hidden="true" />
          ) : (
            <PanelLeftOpen aria-hidden="true" />
          )}
        </button>
      </div>
      {!isSidebarOpen && isEdgeRevealArmed && edgeRevealEnabled ? (
        <div
          className="sidebar-edge-reveal no-drag"
          aria-hidden="true"
          onPointerEnter={peekSidebar}
        />
      ) : null}
      <Group
        className={`panel-group${isSidebarResizing ? ' is-resizing' : ''}${
          isSidebarAnimating ? ' is-sidebar-animating' : ''
        }`}
        onLayoutChanged={handleSidebarLayoutChanged}
        orientation="horizontal"
        resizeTargetMinimumSize={{ coarse: 24, fine: 8 }}
        style={{ height: '100vh', width: '100vw' }}
      >
        <Panel
          className="sidebar-panel"
          collapsedSize={0}
          collapsible={isSidebarPanelCollapsible}
          defaultSize={defaultSidebarWidth}
          groupResizeBehavior="preserve-pixel-size"
          id="sidebar"
          maxSize={maximumSidebarWidth}
          minSize={minimumSidebarWidth}
          panelRef={sidebarPanelRef}
        >
          <div className="sidebar-surface-stack" onPointerLeave={handleSidebarPointerLeave}>
            <div
              className="workspace-surface conversation-sidebar-surface"
              aria-hidden={appView !== 'chat'}
              inert={appView !== 'chat'}
            >
              <ConversationSidebar
                isActive={appView === 'chat'}
                conversations={conversations}
                activeConversationId={activeConversationId}
                authUser={authUser}
                onNewConversation={handleNewConversation}
                onDeleteConversation={handleDeleteConversation}
                onOpenSettings={() => setAppView('settings')}
                onSignIn={() => openAuthView()}
                onSignOut={() => void handleSignOut()}
                onReorderConversation={handleReorderConversation}
                onSelectConversation={setActiveConversationId}
              />
            </div>
            <div
              className="workspace-surface settings-sidebar-surface"
              aria-hidden={appView !== 'settings'}
              inert={appView !== 'settings'}
            >
              <SettingsNavigation
                activeSection={settingsSection}
                onBack={() => setAppView('chat')}
                onSectionChange={setSettingsSection}
              />
            </div>
          </div>
        </Panel>
        <Separator
          className="sidebar-resize-handle no-drag"
          disableDoubleClick
          id="sidebar-resize-handle"
          inert={isSidebarOpen ? undefined : true}
          aria-label="调整侧边栏宽度"
          onDoubleClick={resetSidebarWidth}
          onPointerDown={handleSidebarResizePointerDown}
        />
        <Panel className="chat-panel-container" id="chat" minSize={440}>
          <div className="content-surface-stack">
            <div
              className="workspace-surface chat-content-surface"
              aria-hidden={appView !== 'chat'}
              inert={appView !== 'chat'}
            >
              <ChatView
                conversation={activeConversation}
                errorMessage={currentError}
                isStreaming={currentRequest !== undefined}
                sendOnEnter={sendOnEnter}
                onEditMessage={handleEditMessage}
                onSendMessage={handleSendMessage}
                onStopMessage={handleStopMessage}
              />
            </div>
            <div
              className="workspace-surface settings-content-surface"
              aria-hidden={appView !== 'settings'}
              inert={appView !== 'settings'}
            >
              <SettingsView
                activeSection={settingsSection}
                appearanceMode={appearanceMode}
                authUser={authUser}
                edgeRevealEnabled={edgeRevealEnabled}
                fontScale={fontScale}
                sendOnEnter={sendOnEnter}
                onAppearanceModeChange={setAppearanceMode}
                onChangeDisplayName={(name) =>
                  window.velin.auth.updateDisplayName(name)
                }
                onUploadAvatar={(image) => window.velin.auth.uploadAvatar(image)}
                onEdgeRevealEnabledChange={setEdgeRevealEnabled}
                onFontScaleChange={setFontScale}
                onOpenSecuritySettings={() =>
                  void window.velin.auth.openSecuritySettings()
                }
                onSignIn={() => openAuthView()}
                onSendOnEnterChange={setSendOnEnter}
                onSignOut={() => void handleSignOut()}
              />
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  )
}

export default App
