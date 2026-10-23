import { usePreferences } from './features/preferences/usePreferences'
import { useSidebar } from './features/shell/useSidebar'
import { useChat } from './features/chat/useChat'
import { useChatHistory } from './features/chat/useChatHistory'
import {
  chatDraftStorageKey,
  storeChatDraft,
  pruneChatDrafts,
} from './features/chat/draft-storage'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import ChatView from './features/chat/ChatView'
import ConversationSidebar from './features/conversations/ConversationSidebar'
import { RenameConversationDialog } from './features/conversations/RenameConversationDialog'
import SettingsView from './features/settings/SettingsView'
import { SettingsNavigation } from './features/settings/SettingsNavigation'
import AuthView from './features/auth/AuthView'
import { ConfirmationDialog } from '@velin/ui/ConfirmationDialog.tsx'
import type { AuthUser } from '@velin/contracts/auth-protocol'
import type { MessageAttachment } from '@velin/contracts/chat'
import type { AuthFlow, AuthIntent } from '@velin/contracts/auth-protocol'
import type { SettingsSection } from './features/settings/types'

type AppView = 'chat' | 'settings'

function App() {
  const {
    isSidebarOpen,
    isSidebarResizing,
    isSidebarAnimating,
    isEdgeRevealArmed,
    isFullScreen,
    preferredSidebarWidth,
    showSidebar,
    hideSidebar,
    peekSidebar,
    resetSidebarWidth,
    handleSidebarPointerLeave,
    startSidebarResize,
    moveSidebarResize,
    endSidebarResize,
    handleSidebarResizeKeyDown,
    minimumSidebarWidth,
    maximumSidebarWidth,
  } = useSidebar()
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false)
  const [pendingDeleteConversationId, setPendingDeleteConversationId] =
    useState<string | null>(null)
  const [pendingRenameConversationId, setPendingRenameConversationId] =
    useState<string | null>(null)
  const [appView, setAppView] = useState<AppView>('chat')
  const [chatScope, setChatScope] = useState(0)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [isAuthViewOpen, setIsAuthViewOpen] = useState(false)
  const [isOpeningAuthBrowser, setIsOpeningAuthBrowser] = useState(false)
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>('general')
  const {
    appearanceMode,
    setAppearanceMode,
    fontScale,
    setFontScale,
    sendOnEnter,
    setSendOnEnter,
    edgeRevealEnabled,
    setEdgeRevealEnabled,
    chatModel,
    setChatModel,
    reasoningEffort,
    setReasoningEffort,
  } = usePreferences()
  const {
    conversations,
    activeConversationId,
    conversation: activeConversation,
    request: currentRequest,
    error: currentError,
    history: activeHistory,
    store: chat,
  } = useChat()
  const chatHistory = useChatHistory(authUser, chat, activeConversationId)
  const pendingDeleteConversation = conversations.find(
    (conversation) => conversation.id === pendingDeleteConversationId,
  )
  const pendingRenameConversation = conversations.find(
    (conversation) => conversation.id === pendingRenameConversationId,
  )
  const setActiveConversationId = chat.select
  const authenticatedUserIdRef = useRef<string | null>(null)
  useEffect(() => {
    pruneChatDrafts()
    const timer = window.setInterval(pruneChatDrafts, 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    let isDisposed = false
    let receivedStateEvent = false

    const applyAuthUser = (user: AuthUser | null) => {
      const previousUserId = authenticatedUserIdRef.current
      if (previousUserId && previousUserId !== user?.id) {
        setSignOutDialogOpen(false)
        chat.reset()
        setChatScope((value) => value + 1)
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
  }, [chat])

  useEffect(() => {
    return window.velin.menu.subscribe((action) => {
      if (action === 'open-settings') {
        setAppView('settings')
        return
      }

      if (action === 'sign-out') {
        if (authenticatedUserIdRef.current) setSignOutDialogOpen(true)
        return
      }

      setActiveConversationId(null)
      setAppView('chat')
    })
  }, [setActiveConversationId])

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
      throw new Error('退出登录失败，请检查网络后重试。')
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

  function handleNewConversation() {
    if (!ensureSignedIn()) return
    chat.select(null)
    setAppView('chat')
  }
  const handleDeleteConversation = (conversationId: string) =>
    setPendingDeleteConversationId(conversationId)
  async function handleConfirmDeleteConversation() {
    const conversationId = pendingDeleteConversationId
    if (!conversationId) return
    await chatHistory.deleteConversation(conversationId)
    // 会话删除后服务端待发送附件会级联清理，本地文字草稿也不应继续滞留。
    storeChatDraft(
      chatDraftStorageKey(authUser?.id ?? null, conversationId),
      '',
    )
  }
  const handleRenameConversation = (conversationId: string) =>
    setPendingRenameConversationId(conversationId)
  const handleReorderConversation = chatHistory.reorderConversations
  const sendOptions = { model: chatModel, reasoningEffort }
  function handleSendMessage(
    content: string,
    attachments: MessageAttachment[],
  ) {
    return (
      ensureSignedIn() && chat.send(content, { ...sendOptions, attachments })
    )
  }
  function handleEditMessage(
    conversationId: string,
    messageId: string,
    content: string,
  ) {
    return (
      ensureSignedIn() &&
      chat.edit(conversationId, messageId, content, sendOptions)
    )
  }
  function handleRegenerateMessage(conversationId: string, messageId: string) {
    return (
      ensureSignedIn() &&
      chat.regenerate(conversationId, messageId, sendOptions)
    )
  }
  const handleStopMessage = chat.stop

  const authView = isAuthViewOpen ? (
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
  ) : null

  const appShellClassName = [
    'app-shell',
    `is-${appView}-view`,
    isSidebarOpen ? '' : 'is-sidebar-collapsed',
    isFullScreen ? 'is-full-screen' : '',
    isSidebarResizing ? 'is-sidebar-resizing' : '',
    isSidebarAnimating ? 'is-sidebar-animating' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      {authView}
      {signOutDialogOpen && authUser ? (
        <ConfirmationDialog
          key={authUser.id}
          title="退出登录"
          confirmLabel="退出登录"
          pendingLabel="退出中…"
          failureMessage="退出登录失败，请检查网络后重试。"
          onClose={() => setSignOutDialogOpen(false)}
          onConfirm={handleSignOut}
        >
          确认要退出当前账号吗？当前登录会话将被移除。
        </ConfirmationDialog>
      ) : null}
      {pendingRenameConversation && pendingRenameConversationId ? (
        <RenameConversationDialog
          key={pendingRenameConversationId}
          initialTitle={pendingRenameConversation.title}
          onClose={() => setPendingRenameConversationId(null)}
          onSave={(title) =>
            chatHistory.renameConversation(pendingRenameConversation.id, title)
          }
        />
      ) : null}
      {pendingDeleteConversation && pendingDeleteConversationId ? (
        <ConfirmationDialog
          key={pendingDeleteConversationId}
          title="删除对话"
          confirmLabel="删除"
          pendingLabel="删除中…"
          failureMessage="删除对话失败，请稍后重试。"
          onClose={() => setPendingDeleteConversationId(null)}
          onConfirm={handleConfirmDeleteConversation}
        >
          确认要删除“{pendingDeleteConversation.title}”吗？删除后无法恢复。
        </ConfirmationDialog>
      ) : null}
      <div
        hidden={isAuthViewOpen}
        inert={isAuthViewOpen}
        className={appShellClassName}
        style={
          { '--sidebar-width': `${preferredSidebarWidth}px` } as CSSProperties
        }
      >
        <div className="window-titlebar">
          <div className="window-titlebar-drag-surface" aria-hidden="true" />
          <button
            className="sidebar-toggle no-drag"
            type="button"
            aria-label={isSidebarOpen ? '隐藏侧边栏' : '显示侧边栏'}
            aria-expanded={isSidebarOpen}
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
        <div className="sidebar-panel" id="sidebar-panel">
          <div
            className="sidebar-surface-stack"
            onPointerLeave={handleSidebarPointerLeave}
          >
            <div
              className="workspace-surface conversation-sidebar-surface"
              aria-hidden={appView !== 'chat'}
              inert={appView !== 'chat'}
            >
              <ConversationSidebar
                key={authUser?.id ?? 'guest'}
                isActive={appView === 'chat'}
                conversations={
                  chatHistory.searchConversations ??
                  chatHistory.listConversations
                }
                hasMore={chatHistory.hasMoreConversations}
                isLoadingMore={chatHistory.isLoadingMoreConversations}
                isOrderSaving={chatHistory.isOrderSaving}
                onLoadMore={chatHistory.loadMoreConversations}
                onSearchQueryChange={chatHistory.searchList}
                activeConversationId={activeConversationId}
                authUser={authUser}
                isHistoryLoading={chatHistory.listStatus === 'loading'}
                historyError={
                  chatHistory.listStatus === 'error'
                    ? chatHistory.listError
                    : null
                }
                orderError={chatHistory.orderError}
                onRetryHistory={chatHistory.retryList}
                onRetryOrder={chatHistory.retryOrder}
                onNewConversation={handleNewConversation}
                onDeleteConversation={handleDeleteConversation}
                onRenameConversation={handleRenameConversation}
                onOpenSettings={() => setAppView('settings')}
                onSignIn={() => openAuthView()}
                onSignOut={() => setSignOutDialogOpen(true)}
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
        </div>
        <div
          className="sidebar-resize-handle no-drag"
          role="separator"
          tabIndex={isSidebarOpen ? 0 : -1}
          aria-controls="sidebar-panel"
          aria-hidden={isSidebarOpen ? undefined : true}
          aria-label="调整侧边栏宽度"
          aria-orientation="vertical"
          aria-valuemin={minimumSidebarWidth}
          aria-valuemax={maximumSidebarWidth}
          aria-valuenow={preferredSidebarWidth}
          aria-valuetext={`${preferredSidebarWidth} 像素`}
          onDoubleClick={resetSidebarWidth}
          onKeyDown={handleSidebarResizeKeyDown}
          onPointerDown={startSidebarResize}
          onPointerMove={moveSidebarResize}
          onPointerUp={endSidebarResize}
          onPointerCancel={endSidebarResize}
          onLostPointerCapture={endSidebarResize}
        />
        <div className="main-content">
          <div className="content-surface-stack">
            <div
              className="workspace-surface chat-content-surface"
              aria-hidden={appView !== 'chat'}
              inert={appView !== 'chat'}
            >
              <ChatView
                key={chatScope}
                accountId={authUser?.id ?? null}
                conversation={activeConversation}
                errorMessage={currentError}
                isStreaming={currentRequest !== undefined}
                sendOnEnter={sendOnEnter}
                chatModel={chatModel}
                reasoningEffort={reasoningEffort}
                onChatModelChange={setChatModel}
                onReasoningEffortChange={setReasoningEffort}
                historyStatus={activeHistory?.status}
                historyError={activeHistory?.error}
                hasEarlierMessages={activeHistory?.hasMore ?? false}
                isLoadingEarlier={chatHistory.isLoadingEarlier}
                earlierError={chatHistory.earlierError}
                onLoadEarlier={chatHistory.loadEarlier}
                onRetryHistory={chatHistory.retryActiveHistory}
                onRestoreVersion={chatHistory.restoreVersion}
                onEditMessage={handleEditMessage}
                onRegenerateMessage={handleRegenerateMessage}
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
                onUploadAvatar={(image) =>
                  window.velin.auth.uploadAvatar(image)
                }
                onEdgeRevealEnabledChange={setEdgeRevealEnabled}
                onFontScaleChange={setFontScale}
                onOpenSecuritySettings={() =>
                  void window.velin.auth.openSecuritySettings()
                }
                onSignIn={() => openAuthView()}
                onSendOnEnterChange={setSendOnEnter}
                onSignOut={() => setSignOutDialogOpen(true)}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default App
