import {
  ArrowDown,
  ArrowUp,
  Brain,
  Check,
  ChevronRight,
  Copy,
  LoaderCircle,
  Pencil,
  RefreshCw,
  History,
  X,
} from 'lucide-react'
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import type {
  ChatModelId,
  Conversation,
  Message,
  MessageAttachment,
  ReasoningEffortId,
} from '@velin/contracts/chat'
import { AttachmentChips } from './AttachmentChips'
import Composer from './Composer'
import { ConversationVersionsDialog } from './ConversationVersionsDialog'
import type { ChatHistoryStatus } from './chat-store'
import { chatKeyAction } from './keyboard-policy'
import { chatLimits } from '@velin/contracts/policy'
import { copyFeedbackDurationMs } from '@velin/ui/clipboard-feedback.ts'

type ChatViewProps = {
  onRestoreVersion: (conversationId: string, versionId: string) => Promise<void>
  accountId: string | null
  conversation?: Conversation
  errorMessage?: string
  isStreaming: boolean
  sendOnEnter: boolean
  historyStatus?: ChatHistoryStatus
  historyError?: string
  chatModel: ChatModelId
  reasoningEffort: ReasoningEffortId
  onChatModelChange: (model: ChatModelId) => void
  onReasoningEffortChange: (effort: ReasoningEffortId) => void
  hasEarlierMessages: boolean
  isLoadingEarlier: boolean
  earlierError?: string | null
  onLoadEarlier: () => void
  onRetryHistory: () => void
  onSendMessage: (content: string, attachments: MessageAttachment[]) => boolean
  onEditMessage: (
    conversationId: string,
    messageId: string,
    content: string,
  ) => boolean
  onRegenerateMessage: (conversationId: string, messageId: string) => boolean
  onStopMessage: (conversationId: string) => void
}

type MessageBubbleProps = {
  onOpenVersions?: () => void
  canRetry?: boolean
  conversationId: string
  isStreaming: boolean
  isStreamingAssistant: boolean
  message: Message
  sendOnEnter: boolean
  canRegenerate: boolean
  onEditMessage: ChatViewProps['onEditMessage']
  onRegenerate: (conversationId: string, messageId: string) => boolean
}

const scrollAwayThreshold = 80
const emptyMessages: Message[] = []
const AssistantMarkdown = lazy(() => import('./AssistantMarkdown'))

type ScrollPosition = {
  conversationId?: string
  isAwayFromBottom: boolean
}

function ReasoningBlock({
  content,
  isStreaming,
}: {
  content: string
  isStreaming: boolean
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const open = manualOpen ?? isStreaming

  if (!content.trim()) return null

  return (
    <div className="message-reasoning">
      <button
        className="message-reasoning-toggle"
        type="button"
        aria-expanded={open}
        onClick={() => setManualOpen(!open)}
      >
        <Brain className="message-reasoning-icon" aria-hidden="true" />
        <span>思考过程</span>
        <ChevronRight
          className={`message-reasoning-chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? <div className="message-reasoning-content">{content}</div> : null}
    </div>
  )
}

function MessageBubble({
  conversationId,
  isStreaming,
  isStreamingAssistant,
  message,
  sendOnEnter,
  canRegenerate,
  onEditMessage,
  onRegenerate,
  onOpenVersions,
  canRetry,
}: MessageBubbleProps) {
  const isUserMessage = message.role === 'user'
  const isComposingRef = useRef(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(message.content)
  const [copyFeedback, setCopyFeedback] = useState(0)
  const isCopyPending = !isUserMessage && message.status === 'streaming'
  const canCopy = !isCopyPending && message.content.length > 0
  const canSubmitEdit = editValue.trim().length > 0 && !isStreaming

  useEffect(() => {
    if (copyFeedback === 0) {
      return
    }

    const timer = window.setTimeout(
      () => setCopyFeedback(0),
      copyFeedbackDurationMs,
    )
    return () => window.clearTimeout(timer)
  }, [copyFeedback])

  useLayoutEffect(() => {
    const editor = editorRef.current

    if (!isEditing || !editor) {
      return
    }

    editor.style.height = 'auto'
    editor.style.height = `${Math.min(editor.scrollHeight, 240)}px`
    editor.style.overflowY = editor.scrollHeight > 240 ? 'auto' : 'hidden'
    editor.focus()
    editor.setSelectionRange(editor.value.length, editor.value.length)
  }, [isEditing])

  async function copyMessage() {
    if (!message.content) {
      return
    }

    try {
      await navigator.clipboard.writeText(message.content)
      setCopyFeedback((currentFeedback) => currentFeedback + 1)
    } catch {
      setCopyFeedback(0)
    }
  }

  function resizeEditor(editor: HTMLTextAreaElement) {
    editor.style.height = 'auto'
    editor.style.height = `${Math.min(editor.scrollHeight, 240)}px`
    editor.style.overflowY = editor.scrollHeight > 240 ? 'auto' : 'hidden'
  }

  function cancelEditing() {
    setEditValue(message.content)
    setIsEditing(false)
  }

  function submitEdit() {
    if (!canSubmitEdit) {
      return
    }

    if (onEditMessage(conversationId, message.id, editValue)) {
      setIsEditing(false)
    }
  }

  function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submitEdit()
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const action = chatKeyAction(
      {
        key: event.key,
        isComposing: event.nativeEvent.isComposing || isComposingRef.current,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
      },
      sendOnEnter,
    )
    if (action === 'cancel') {
      event.preventDefault()
      cancelEditing()
      return
    }
    if (action !== 'submit') return

    event.preventDefault()
    submitEdit()
  }

  return (
    <div
      className={`message-row ${isUserMessage ? 'is-user' : 'is-assistant'}`}
    >
      <div className={`message-stack${isEditing ? ' is-editing' : ''}`}>
        {!isUserMessage ? (
          <ReasoningBlock
            content={message.reasoning}
            isStreaming={isStreamingAssistant}
          />
        ) : null}
        {isEditing ? (
          <form className="message-editor" onSubmit={handleEditSubmit}>
            {message.attachments.length > 0 ? (
              <AttachmentChips
                attachments={message.attachments}
                variant="message"
              />
            ) : null}
            <textarea
              ref={editorRef}
              maxLength={chatLimits.messageCharacters}
              aria-label="编辑消息"
              rows={1}
              value={editValue}
              onChange={(event) => {
                setEditValue(event.currentTarget.value)
                resizeEditor(event.currentTarget)
              }}
              onKeyDown={handleEditKeyDown}
              onCompositionStart={() => {
                isComposingRef.current = true
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false
              }}
            />
            <div className="message-editor-actions">
              <button
                className="message-editor-button"
                type="button"
                aria-label="取消编辑"
                onClick={cancelEditing}
              >
                <X aria-hidden="true" />
              </button>
              <button
                className="message-editor-button is-primary"
                type="submit"
                disabled={!canSubmitEdit}
                aria-label="发送修改后的消息"
              >
                <ArrowUp aria-hidden="true" />
              </button>
            </div>
          </form>
        ) : (
          <div
            className={`message-bubble ${
              isUserMessage ? 'user-message' : 'assistant-message'
            }`}
          >
            <div className="message-content">
              {isUserMessage ? (
                message.content
              ) : (
                <Suspense fallback={<span>{message.content}</span>}>
                  <AssistantMarkdown
                    content={message.content}
                    isStreaming={isStreamingAssistant}
                  />
                </Suspense>
              )}
            </div>
            {isUserMessage && message.attachments.length > 0 ? (
              <AttachmentChips
                attachments={message.attachments}
                variant="message"
              />
            ) : null}
          </div>
        )}
        {!isUserMessage && message.context ? (
          <details className="message-context">
            <summary>
              {[
                message.model,
                message.context.summaryUsed ? '已接续历史摘要' : '',
                message.context.memoryCount
                  ? `参考 ${message.context.memoryCount} 条个人记忆`
                  : '',
                message.context.sources.length
                  ? `参考 ${message.context.sources.length} 处资料`
                  : '',
                message.context.historySources.length
                  ? `参考 ${new Set(message.context.historySources.map((source) => source.messageId)).size} 条历史消息`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ') || '本轮上下文'}
            </summary>
            {message.context.retrievalDegraded ? (
              <p>部分历史检索暂不可用，本轮参考的信息可能不完整。</p>
            ) : null}
            {message.context.historySources.map((source, index) => (
              <div key={`${source.messageId}:${index}`}>
                <p>
                  往事{index + 1} · {source.title} ·{' '}
                  {new Date(source.createdAt).toLocaleDateString('zh-CN')} ·{' '}
                  {source.role === 'user' ? '你的消息' : '助手回复'}
                </p>
                <blockquote>{source.excerpt}</blockquote>
              </div>
            ))}
            {message.context.documentPartial ? (
              <p>
                {message.context.documentsSummarized
                  ? '本轮使用全文逐段整理结果，压缩可能遗漏细节，可继续追问具体原文。'
                  : '本轮使用相关摘录，未提供文件全文。'}
              </p>
            ) : null}
            {message.context.sources.map((source, index) => (
              <div key={`${source.attachmentId}:${index}`}>
                <p>
                  资料{index + 1} · {source.name}
                  {source.page ? ` · 第${source.page}页` : ''}
                </p>
                <blockquote>{source.excerpt}</blockquote>
              </div>
            ))}
          </details>
        ) : null}
        {!isUserMessage && message.context?.imagesLimited ? (
          <p className="message-status">本轮图片超出预算，仅提供了近期图片。</p>
        ) : null}
        {!isUserMessage && message.status === 'incomplete' ? (
          <p className="message-status">回复未完整生成，可重新生成。</p>
        ) : !isUserMessage && message.status === 'failed' ? (
          <p className="message-status is-failed">生成失败</p>
        ) : !isUserMessage && message.status === 'cancelled' ? (
          <p className="message-status">生成已停止</p>
        ) : null}
        {!isEditing ? (
          <div className="message-actions" aria-label="消息操作">
            {onOpenVersions ? (
              <button
                className="message-action-button"
                type="button"
                disabled={isStreaming}
                aria-label="查看历史版本"
                onClick={onOpenVersions}
              >
                <History aria-hidden="true" />
              </button>
            ) : null}
            {canRetry ? (
              <button
                className="message-action-button"
                type="button"
                disabled={isStreaming}
                aria-label="重试本轮"
                onClick={() =>
                  onEditMessage(conversationId, message.id, message.content)
                }
              >
                <RefreshCw aria-hidden="true" />
              </button>
            ) : null}
            <button
              className={`message-action-button${
                isCopyPending ? ' is-pending' : ''
              }`}
              type="button"
              disabled={!canCopy}
              aria-label={
                isCopyPending
                  ? '正在生成，完成后可复制'
                  : copyFeedback > 0
                    ? '已复制'
                    : '复制消息'
              }
              onClick={() => void copyMessage()}
            >
              {isCopyPending ? (
                <LoaderCircle
                  className="message-action-spinner"
                  aria-hidden="true"
                />
              ) : copyFeedback > 0 ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
            </button>
            {!isUserMessage && canRegenerate ? (
              <button
                className="message-action-button"
                type="button"
                disabled={isStreaming}
                aria-label={
                  message.status === 'completed'
                    ? '重新生成回复'
                    : '重试生成回复'
                }
                onClick={() => onRegenerate(conversationId, message.id)}
              >
                <RefreshCw aria-hidden="true" />
              </button>
            ) : null}
            {isUserMessage ? (
              <button
                className="message-action-button"
                type="button"
                disabled={isStreaming}
                aria-label={
                  isStreaming ? '编辑消息（请先停止当前回复）' : '编辑消息'
                }
                onClick={() => {
                  setEditValue(message.content)
                  setIsEditing(true)
                }}
              >
                <Pencil aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ChatView({
  accountId,
  conversation,
  errorMessage,
  isStreaming,
  sendOnEnter,
  historyStatus,
  historyError,
  chatModel,
  reasoningEffort,
  onChatModelChange,
  onReasoningEffortChange,
  hasEarlierMessages,
  isLoadingEarlier,
  earlierError,
  onLoadEarlier,
  onRetryHistory,
  onSendMessage,
  onEditMessage,
  onRegenerateMessage,
  onStopMessage,
  onRestoreVersion,
}: ChatViewProps) {
  const [versionsFor, setVersionsFor] = useState<string | null>(null)
  const messages = conversation?.messages ?? emptyMessages
  const remoteStreaming =
    !isStreaming && messages.some((message) => message.status === 'streaming')
  const restoring = historyStatus === 'restoring'
  const isReadOnly = remoteStreaming || restoring
  const hasMessages = messages.length > 0
  const isHistoryPending =
    conversation !== undefined &&
    (historyStatus === 'idle' || historyStatus === 'loading')
  const isHistoryFailed =
    conversation !== undefined && historyStatus === 'error'
  const panelRef = useRef<HTMLElement>(null)
  const composerAreaRef = useRef<HTMLDivElement>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const shouldFollowMessagesRef = useRef(true)
  const scrollAnimationTimerRef = useRef<number | null>(null)
  const prependMetricsRef = useRef<{
    firstMessageId: string
    scrollHeight: number
    scrollTop: number
  } | null>(null)
  const [scrollPosition, setScrollPosition] = useState<ScrollPosition>({
    conversationId: conversation?.id,
    isAwayFromBottom: false,
  })
  const isAwayFromBottom =
    scrollPosition.conversationId === conversation?.id &&
    scrollPosition.isAwayFromBottom

  function updateScrollPosition(isAway: boolean) {
    setScrollPosition((currentPosition) =>
      currentPosition.conversationId === conversation?.id &&
      currentPosition.isAwayFromBottom === isAway
        ? currentPosition
        : {
            conversationId: conversation?.id,
            isAwayFromBottom: isAway,
          },
    )
  }

  function measureScrollPosition(messageList: HTMLDivElement) {
    const distanceFromBottom =
      messageList.scrollHeight -
      messageList.clientHeight -
      messageList.scrollTop
    const nextIsAwayFromBottom = distanceFromBottom > scrollAwayThreshold

    shouldFollowMessagesRef.current = !nextIsAwayFromBottom
    updateScrollPosition(nextIsAwayFromBottom)
  }

  function handleMessageListScroll() {
    const messageList = messageListRef.current

    if (!messageList || scrollAnimationTimerRef.current !== null) {
      return
    }

    measureScrollPosition(messageList)
  }

  function scrollToBottom() {
    const messageList = messageListRef.current

    if (!messageList) {
      return
    }

    shouldFollowMessagesRef.current = true
    updateScrollPosition(false)
    if (scrollAnimationTimerRef.current !== null) {
      window.clearTimeout(scrollAnimationTimerRef.current)
      scrollAnimationTimerRef.current = null
    }
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    messageList.scrollTo({
      top: messageList.scrollHeight,
      behavior: reducedMotion ? 'instant' : 'smooth',
    })
    if (reducedMotion) {
      measureScrollPosition(messageList)
      return
    }

    scrollAnimationTimerRef.current = window.setTimeout(() => {
      scrollAnimationTimerRef.current = null

      if (messageListRef.current) {
        measureScrollPosition(messageListRef.current)
      }
    }, 420)
  }

  function handleSendMessage(
    content: string,
    attachments: MessageAttachment[],
  ) {
    shouldFollowMessagesRef.current = true
    updateScrollPosition(false)
    return onSendMessage(content, attachments)
  }

  function handleLoadEarlier() {
    const messageList = messageListRef.current
    const firstMessage = messages[0]

    if (!messageList || !firstMessage || isLoadingEarlier) {
      return
    }

    prependMetricsRef.current = {
      firstMessageId: firstMessage.id,
      scrollHeight: messageList.scrollHeight,
      scrollTop: messageList.scrollTop,
    }
    onLoadEarlier()
  }

  function handleEditMessage(
    conversationId: string,
    messageId: string,
    content: string,
  ) {
    const didEdit = onEditMessage(conversationId, messageId, content)

    if (didEdit) {
      shouldFollowMessagesRef.current = true
      updateScrollPosition(false)
    }

    return didEdit
  }

  useLayoutEffect(() => {
    const messageList = messageListRef.current

    if (scrollAnimationTimerRef.current !== null) {
      window.clearTimeout(scrollAnimationTimerRef.current)
      scrollAnimationTimerRef.current = null
    }
    shouldFollowMessagesRef.current = true
    prependMetricsRef.current = null

    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight
    }
  }, [conversation?.id])

  useLayoutEffect(() => {
    const messageList = messageListRef.current
    const metrics = prependMetricsRef.current

    if (!messageList || !metrics) {
      return
    }
    if (messages[0]?.id === metrics.firstMessageId) {
      return
    }

    messageList.scrollTop =
      messageList.scrollHeight - metrics.scrollHeight + metrics.scrollTop
    prependMetricsRef.current = null
  }, [messages])

  useLayoutEffect(() => {
    const messageList = messageListRef.current

    if (!messageList) {
      return
    }

    if (shouldFollowMessagesRef.current) {
      messageList.scrollTop = messageList.scrollHeight
    }
  }, [messages])

  useLayoutEffect(() => {
    const panel = panelRef.current
    const area = composerAreaRef.current
    const form = area?.querySelector<HTMLFormElement>('.composer')
    if (!panel || !area || !form) return

    // 截止线跟随输入框的真实中线，包含多行、附件、缩放与错误反馈引起的变化。
    const updateViewport = () => {
      const panelBounds = panel.getBoundingClientRect()
      const formBounds = form.getBoundingClientRect()
      const halfHeight = formBounds.height / 2
      const inset = Math.max(
        0,
        panelBounds.bottom - formBounds.top - halfHeight,
      )
      panel.style.setProperty('--chat-dock-inset', `${inset}px`)
      panel.style.setProperty(
        '--chat-composer-left',
        `${formBounds.left - panelBounds.left}px`,
      )
      panel.style.setProperty('--chat-composer-width', `${formBounds.width}px`)
      panel.style.setProperty(
        '--chat-composer-radius',
        getComputedStyle(form).borderTopLeftRadius,
      )
      panel.style.setProperty('--chat-composer-half-height', `${halfHeight}px`)
      if (shouldFollowMessagesRef.current && messageListRef.current) {
        messageListRef.current.scrollTop = messageListRef.current.scrollHeight
      }
    }
    updateViewport()
    const observer = new ResizeObserver(updateViewport)
    observer.observe(panel)
    observer.observe(area)
    observer.observe(form)
    return () => observer.disconnect()
  }, [hasMessages, isHistoryPending, isHistoryFailed, conversation?.id])

  useEffect(
    () => () => {
      if (scrollAnimationTimerRef.current !== null) {
        window.clearTimeout(scrollAnimationTimerRef.current)
      }
    },
    [],
  )

  const composer = (
    <Composer
      key={`${accountId ?? 'anonymous'}:${conversation?.id ?? 'new-conversation'}`}
      accountId={accountId}
      conversationId={conversation?.id}
      isStreaming={isStreaming}
      isReadOnly={isReadOnly}
      sendOnEnter={sendOnEnter}
      chatModel={chatModel}
      reasoningEffort={reasoningEffort}
      onChatModelChange={onChatModelChange}
      onReasoningEffortChange={onReasoningEffortChange}
      onSend={handleSendMessage}
      onStop={() => onStopMessage(conversation?.id ?? '')}
    />
  )

  if (isHistoryPending) {
    return <main className="chat-panel is-empty" aria-busy="true" />
  }

  if (isHistoryFailed) {
    return (
      <main className="chat-panel is-empty">
        <div className="chat-history-state">
          <p className="chat-error" role="alert">
            {historyError ?? '读取对话失败，请稍后重试。'}
          </p>
          <button
            className="history-retry-button"
            type="button"
            onClick={onRetryHistory}
          >
            重新读取
          </button>
        </div>
      </main>
    )
  }

  return (
    <main
      ref={panelRef}
      aria-busy={restoring || undefined}
      className={`chat-panel${hasMessages ? '' : ' is-empty'}`}
    >
      {versionsFor && versionsFor === conversation?.id ? (
        <ConversationVersionsDialog
          key={versionsFor}
          conversationId={versionsFor}
          onClose={() => setVersionsFor(null)}
          onRestore={(versionId) => onRestoreVersion(versionsFor, versionId)}
        />
      ) : null}
      {hasMessages ? (
        <div
          ref={messageListRef}
          className="message-list"
          aria-live="polite"
          onScroll={handleMessageListScroll}
        >
          {hasEarlierMessages ? (
            <div className="history-load-earlier">
              <button
                className="history-load-earlier-button"
                type="button"
                disabled={isLoadingEarlier || isStreaming || isReadOnly}
                onClick={handleLoadEarlier}
              >
                加载更早消息
              </button>
              {earlierError ? (
                <p className="history-load-error" role="alert">
                  {earlierError}
                </p>
              ) : null}
            </div>
          ) : null}
          {messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              conversationId={conversation?.id ?? ''}
              isStreaming={isStreaming || isReadOnly}
              isStreamingAssistant={
                (isStreaming || remoteStreaming) &&
                message.role === 'assistant' &&
                index === messages.length - 1
              }
              message={message}
              onOpenVersions={
                index === messages.length - 1 && conversation
                  ? () => setVersionsFor(conversation.id)
                  : undefined
              }
              canRetry={
                index === messages.length - 1 &&
                message.role === 'user' &&
                Boolean(errorMessage)
              }
              sendOnEnter={sendOnEnter}
              canRegenerate={
                index === messages.length - 1 &&
                message.role === 'assistant' &&
                message.status !== 'streaming'
              }
              onEditMessage={handleEditMessage}
              onRegenerate={onRegenerateMessage}
            />
          ))}
        </div>
      ) : (
        <div className="empty-chat-content" aria-live="polite">
          <div className="empty-chat-stack">
            <div className="empty-state">
              <h1>随时可以开始。</h1>
            </div>
            {errorMessage ? (
              <div className="chat-error" role="alert">
                {errorMessage}
              </div>
            ) : null}
            {composer}
          </div>
        </div>
      )}

      {hasMessages ? (
        <div className="composer-area" ref={composerAreaRef}>
          {isReadOnly ? (
            <p className="message-status" role="status">
              {restoring
                ? '正在恢复历史版本…'
                : '此对话正在其他窗口生成回复，完成后可继续。'}
            </p>
          ) : null}
          {isAwayFromBottom ? (
            <button
              className={`scroll-to-bottom-button${
                isStreaming ? ' is-streaming' : ''
              }`}
              type="button"
              aria-label={isStreaming ? '正在生成，跳到底部' : '跳到底部'}
              onClick={scrollToBottom}
            >
              {isStreaming ? (
                <span className="generation-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                <ArrowDown aria-hidden="true" />
              )}
            </button>
          ) : null}
          {errorMessage ? (
            <div className="chat-error" role="alert">
              {errorMessage}
            </div>
          ) : null}
          <div className="composer-dock">
            {composer}
            <div className="composer-footer" aria-hidden="true" />
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default ChatView
