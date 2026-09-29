import { ArrowDown, ArrowUp, Check, Copy, Pencil, X } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { code } from '@streamdown/code'
import { Streamdown } from 'streamdown'
import type { Components, ControlsConfig, IconMap, StreamdownTranslations } from 'streamdown'
import type { Conversation, Message } from '../../shared/chat'
import Composer from './Composer'

type ChatViewProps = {
  conversation?: Conversation
  errorMessage?: string
  isStreaming: boolean
  sendOnEnter: boolean
  onSendMessage: (content: string) => void
  onEditMessage: (
    conversationId: string,
    messageId: string,
    content: string,
  ) => boolean
  onStopMessage: (conversationId: string) => void
}

type MessageBubbleProps = {
  conversationId: string
  isStreaming: boolean
  isStreamingAssistant: boolean
  message: Message
  sendOnEnter: boolean
  onEditMessage: ChatViewProps['onEditMessage']
}

const scrollAwayThreshold = 80
const emptyMessages: Message[] = []
const streamdownPlugins = { code }
const streamdownControls = {
  code: { copy: true, download: false },
  table: false,
  image: false,
} satisfies ControlsConfig
const streamdownTranslations = {
  copyCode: '复制代码',
  copied: '已复制',
} satisfies Partial<StreamdownTranslations>
const streamdownIcons = {
  CopyIcon: Copy,
  CheckIcon: Check,
} satisfies Partial<IconMap>

function externalHttpUrl(value: string | undefined) {
  if (!value) return null

  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

const markdownComponents = {
  a({ href, children }) {
    const url = externalHttpUrl(href)
    if (!url) return <span>{children}</span>

    return (
      <a
        href={url}
        onClick={(event) => {
          event.preventDefault()
          void window.velin.chat.openExternalLink(url)
        }}
      >
        {children}
      </a>
    )
  },
  img({ alt, src }) {
    const url = externalHttpUrl(src)
    return url ? <span className="markdown-image-reference">图片：{alt || url}</span> : null
  },
} satisfies Components

const AssistantMarkdown = memo(function AssistantMarkdown({
  content,
  isStreaming,
}: {
  content: string
  isStreaming: boolean
}) {
  if (!content) return null

  return (
    <Streamdown
      animated={false}
      className="assistant-markdown"
      components={markdownComponents}
      codeBlockMaxHeight={0}
      controls={streamdownControls}
      icons={streamdownIcons}
      isAnimating={isStreaming}
      lineNumbers={false}
      mode={isStreaming ? 'streaming' : 'static'}
      parseIncompleteMarkdown={isStreaming}
      plugins={streamdownPlugins}
      translations={streamdownTranslations}
    >
      {content}
    </Streamdown>
  )
})

type ScrollPosition = {
  conversationId?: string
  isAwayFromBottom: boolean
}

function MessageBubble({
  conversationId,
  isStreaming,
  isStreamingAssistant,
  message,
  sendOnEnter,
  onEditMessage,
}: MessageBubbleProps) {
  const isUserMessage = message.role === 'user'
  const isComposingRef = useRef(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(message.content)
  const [copyFeedback, setCopyFeedback] = useState(0)
  const canSubmitEdit = editValue.trim().length > 0 && !isStreaming

  useEffect(() => {
    if (copyFeedback === 0) {
      return
    }

    const timer = window.setTimeout(() => setCopyFeedback(0), 1600)
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
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEditing()
      return
    }

    if (event.nativeEvent.isComposing || isComposingRef.current) {
      return
    }

    const shouldSend = sendOnEnter
      ? event.key === 'Enter' && !event.shiftKey
      : event.key === 'Enter' && (event.metaKey || event.ctrlKey)

    if (!shouldSend) {
      return
    }

    event.preventDefault()
    submitEdit()
  }

  return (
    <div className={`message-row ${isUserMessage ? 'is-user' : 'is-assistant'}`}>
      <div className={`message-stack${isEditing ? ' is-editing' : ''}`}>
        {isEditing ? (
          <form className="message-editor" onSubmit={handleEditSubmit}>
            <textarea
              ref={editorRef}
              maxLength={8_000}
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
                title="取消"
                onClick={cancelEditing}
              >
                <X aria-hidden="true" />
              </button>
              <button
                className="message-editor-button is-primary"
                type="submit"
                disabled={!canSubmitEdit}
                aria-label="发送修改后的消息"
                title="发送"
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
              {isUserMessage ? message.content : (
                <AssistantMarkdown
                  content={message.content}
                  isStreaming={isStreamingAssistant}
                />
              )}
            </div>
          </div>
        )}
        {!isEditing ? (
          <div className="message-actions" aria-label="消息操作">
            <button
              className="message-action-button"
              type="button"
              disabled={!message.content}
              aria-label={copyFeedback > 0 ? '已复制' : '复制消息'}
              title={copyFeedback > 0 ? '已复制' : '复制'}
              onClick={() => void copyMessage()}
            >
              {copyFeedback > 0 ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
            </button>
            {isUserMessage ? (
              <button
                className="message-action-button"
                type="button"
                disabled={isStreaming}
                aria-label="编辑消息"
                title={isStreaming ? '请先停止当前回复' : '编辑'}
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
  conversation,
  errorMessage,
  isStreaming,
  sendOnEnter,
  onSendMessage,
  onEditMessage,
  onStopMessage,
}: ChatViewProps) {
  const messages = conversation?.messages ?? emptyMessages
  const hasMessages = messages.length > 0
  const messageListRef = useRef<HTMLDivElement>(null)
  const shouldFollowMessagesRef = useRef(true)
  const scrollAnimationTimerRef = useRef<number | null>(null)
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
      messageList.scrollHeight - messageList.clientHeight - messageList.scrollTop
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
    messageList.scrollTo({
      top: messageList.scrollHeight,
      behavior: 'smooth',
    })

    if (scrollAnimationTimerRef.current !== null) {
      window.clearTimeout(scrollAnimationTimerRef.current)
    }

    scrollAnimationTimerRef.current = window.setTimeout(() => {
      scrollAnimationTimerRef.current = null

      if (messageListRef.current) {
        measureScrollPosition(messageListRef.current)
      }
    }, 420)
  }

  function handleSendMessage(content: string) {
    shouldFollowMessagesRef.current = true
    updateScrollPosition(false)
    onSendMessage(content)
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

    shouldFollowMessagesRef.current = true

    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight
    }
  }, [conversation?.id])

  useLayoutEffect(() => {
    const messageList = messageListRef.current

    if (!messageList) {
      return
    }

    if (shouldFollowMessagesRef.current) {
      messageList.scrollTop = messageList.scrollHeight
    }
  }, [messages])

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
      key={conversation?.id ?? 'new-conversation'}
      isStreaming={isStreaming}
      sendOnEnter={sendOnEnter}
      onSend={handleSendMessage}
      onStop={() => onStopMessage(conversation?.id ?? '')}
    />
  )

  return (
    <main className={`chat-panel${hasMessages ? '' : ' is-empty'}`}>
      {hasMessages ? (
        <div
          ref={messageListRef}
          className="message-list"
          aria-live="polite"
          onScroll={handleMessageListScroll}
        >
          {messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              conversationId={conversation?.id ?? ''}
              isStreaming={isStreaming}
              isStreamingAssistant={
                isStreaming &&
                message.role === 'assistant' &&
                index === messages.length - 1
              }
              message={message}
              sendOnEnter={sendOnEnter}
              onEditMessage={handleEditMessage}
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
        <div className="composer-area">
          {isAwayFromBottom ? (
            <button
              className={`scroll-to-bottom-button${
                isStreaming ? ' is-streaming' : ''
              }`}
              type="button"
              aria-label={isStreaming ? '正在生成，跳到底部' : '跳到底部'}
              title={isStreaming ? '正在生成，跳到底部' : '跳到底部'}
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
          {composer}
        </div>
      ) : null}
    </main>
  )
}

export default ChatView
