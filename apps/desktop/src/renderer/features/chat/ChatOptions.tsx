import {
  chatModels,
  findChatModel,
  normalizeReasoningEffort,
  reasoningEffortsForModel,
  type ChatModelId,
  type ReasoningEffortId,
} from '@velin/contracts/chat'
import { TruncatedText } from '@velin/ui/TruncatedText.tsx'
import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ReasoningSlider } from './ReasoningSlider'

type ChatOptionsProps = {
  chatModel: ChatModelId
  reasoningEffort: ReasoningEffortId
  onChatModelChange: (model: ChatModelId) => void
  onReasoningEffortChange: (effort: ReasoningEffortId) => void
}

export function ChatOptions({
  chatModel,
  reasoningEffort,
  onChatModelChange,
  onReasoningEffortChange,
}: ChatOptionsProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const selectedModel = findChatModel(chatModel)
  const effortOptions = reasoningEffortsForModel(selectedModel)
  const effectiveEffort = normalizeReasoningEffort(
    selectedModel,
    reasoningEffort,
  )
  const selectedEffort =
    effortOptions.find((effort) => effort.id === effectiveEffort) ?? null
  const showSlider = effortOptions.length > 1

  useEffect(() => {
    if (!open) return
    menuRef.current
      ?.querySelector<HTMLElement>('[aria-checked="true"]')
      ?.focus()
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className="chat-options" ref={rootRef}>
      <button
        className="chat-option-button"
        ref={triggerRef}
        type="button"
        aria-label={
          selectedEffort
            ? `模型 ${selectedModel.name}，推理强度 ${selectedEffort.name}`
            : `模型 ${selectedModel.name}`
        }
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <TruncatedText className="chat-option-model">
          {selectedModel.name}
        </TruncatedText>
        {selectedEffort ? (
          <span className="chat-option-effort">{selectedEffort.name}</span>
        ) : null}
        <ChevronDown
          className={`chat-option-chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div
          className="chat-option-menu"
          role="menu"
          ref={menuRef}
          onKeyDown={(event) => {
            if (event.key === 'Tab') {
              setOpen(false)
              triggerRef.current?.focus()
              return
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
              return
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                '[role="menuitemradio"], [role="menuitem"], [role="slider"]',
              ),
            ]
            const index = items.indexOf(document.activeElement as HTMLElement)
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : (index +
                      (event.key === 'ArrowDown' ? 1 : -1) +
                      items.length) %
                    items.length
            event.preventDefault()
            items[next]?.focus()
          }}
        >
          <div className="chat-option-group" role="group">
            {chatModels.map((model) => (
              <button
                className="chat-option-item"
                type="button"
                role="menuitemradio"
                aria-checked={model.id === chatModel}
                key={model.id}
                onClick={() => {
                  onChatModelChange(model.id)
                }}
              >
                <TruncatedText>{model.name}</TruncatedText>
                {model.id === chatModel ? (
                  <Check className="chat-option-check" aria-hidden="true" />
                ) : null}
              </button>
            ))}
          </div>
          {showSlider ? (
            <>
              <div className="chat-option-divider" role="separator" />
              <ReasoningSlider
                key={selectedModel.id}
                options={effortOptions}
                value={effectiveEffort}
                onChange={onReasoningEffortChange}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
