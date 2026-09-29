import { ArrowUp, Plus, Square } from 'lucide-react'
import { useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

type ComposerProps = {
  isStreaming: boolean
  sendOnEnter: boolean
  onSend: (content: string) => void
  onStop: () => void
}

function Composer({ isStreaming, sendOnEnter, onSend, onStop }: ComposerProps) {
  const isComposingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState('')
  const canSend = value.trim().length > 0

  function resizeTextarea(textarea: HTMLTextAreaElement) {
    const maxHeight = 160
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }

  function submit() {
    if (isStreaming || !canSend) {
      return
    }

    onSend(value)
    setValue('')

    if (textareaRef.current) {
      textareaRef.current.style.height = ''
      textareaRef.current.style.overflowY = 'hidden'
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
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
    submit()
  }

  return (
    <div className="composer-shell">
      <form className="composer" onSubmit={handleSubmit}>
        <button
          className="composer-attachment-button"
          type="button"
          aria-label="添加附件"
          title="添加附件"
        >
          <Plus className="composer-attachment-icon" aria-hidden="true" />
        </button>
        <textarea
          ref={textareaRef}
          maxLength={8_000}
          aria-label="输入消息"
          placeholder="输入消息..."
          rows={1}
          disabled={isStreaming}
          value={value}
          onChange={(event) => {
            setValue(event.currentTarget.value)
            resizeTextarea(event.currentTarget)
          }}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            isComposingRef.current = true
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false
          }}
        />
        {isStreaming ? (
          <button
            className="send-button stop-button"
            type="button"
            onClick={onStop}
            aria-label="停止生成"
            title="停止生成"
          >
            <Square className="send-button-icon" aria-hidden="true" />
          </button>
        ) : (
          <button
            className="send-button"
            type="submit"
            disabled={!canSend}
            aria-label="发送消息"
            title="发送消息"
          >
            <ArrowUp className="send-button-icon" aria-hidden="true" />
          </button>
        )}
      </form>
    </div>
  )
}

export default Composer
