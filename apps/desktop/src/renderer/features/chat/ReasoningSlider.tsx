import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type {
  ReasoningEffortInfo,
  ReasoningEffortId,
} from '@velin/contracts/chat'

export function ReasoningSlider({
  options,
  value,
  onChange,
}: {
  options: readonly ReasoningEffortInfo[]
  value: ReasoningEffortId
  onChange: (value: ReasoningEffortId) => void
}) {
  const railRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)
  const sessionRef = useRef<{
    pointerId: number
    offset: number
    target: HTMLDivElement
    cleanup: () => void
  } | null>(null)
  const [previewRatio, setPreviewRatio] = useState<number | null>(null)
  const index = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  )
  const ratio = previewRatio ?? index / Math.max(1, options.length - 1)
  const previewIndex =
    previewRatio !== null ? Math.round(ratio * (options.length - 1)) : index
  const preview = options[previewIndex]
  function position(clientX: number, offset = 0) {
    const bounds = railRef.current?.getBoundingClientRect()
    return bounds?.width
      ? Math.max(
          0,
          Math.min(1, (clientX - offset - bounds.left) / bounds.width),
        )
      : ratio
  }
  function commit(nextIndex: number) {
    const next = options[Math.max(0, Math.min(options.length - 1, nextIndex))]
    if (next && next.id !== value) onChange(next.id)
  }
  function clearSession(updatePreview = true) {
    const session = sessionRef.current
    sessionRef.current = null
    if (session) {
      session.cleanup()
      if (session.target.hasPointerCapture(session.pointerId))
        session.target.releasePointerCapture(session.pointerId)
    }
    if (updatePreview) setPreviewRatio(null)
  }
  useEffect(() => () => clearSession(false), [])
  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || options.length < 2) return
    event.preventDefault()
    clearSession()
    const target = event.currentTarget
    target.focus()
    const thumb = thumbRef.current?.getBoundingClientRect()
    const offset =
      thumb && event.clientX >= thumb.left && event.clientX <= thumb.right
        ? event.clientX - (thumb.left + thumb.width / 2)
        : 0
    const move = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== sessionRef.current?.pointerId) return
      pointer.preventDefault()
      setPreviewRatio(position(pointer.clientX, offset))
    }
    const finish = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== sessionRef.current?.pointerId) return
      const nextIndex = Math.round(
        position(pointer.clientX, offset) * (options.length - 1),
      )
      clearSession()
      // 最终坐标决定档位，不依赖 React 预览提交时序，也不因中途丢失捕获而回弹。
      commit(nextIndex)
    }
    const cancel = () => clearSession()
    const cancelPointer = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId === sessionRef.current?.pointerId) cancel()
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', cancelPointer, true)
      window.removeEventListener('blur', cancel)
    }
    sessionRef.current = { pointerId: event.pointerId, offset, target, cleanup }
    window.addEventListener('pointermove', move, {
      capture: true,
      passive: false,
    })
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', cancelPointer, true)
    window.addEventListener('blur', cancel)
    target.setPointerCapture(event.pointerId)
    setPreviewRatio(position(event.clientX, offset))
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : ['ArrowLeft', 'ArrowDown'].includes(event.key)
            ? index - 1
            : ['ArrowRight', 'ArrowUp'].includes(event.key)
              ? index + 1
              : null
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    clearSession()
    commit(next)
  }
  return (
    <div className="chat-reasoning-slider">
      <div className="chat-reasoning-level" aria-live="polite">
        {preview?.name}
      </div>
      <div
        className={`chat-reasoning-control${previewRatio !== null ? ' is-dragging' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label="推理强度"
        aria-valuemin={0}
        aria-valuemax={options.length - 1}
        aria-valuenow={previewIndex}
        aria-valuetext={preview?.name}
        onKeyDown={keyDown}
        onPointerDown={start}
      >
        <div className="chat-reasoning-track" aria-hidden="true">
          <div className="chat-reasoning-progress">
            <span
              className="chat-reasoning-fill"
              style={{
                opacity: ratio <= 0 ? 0 : 1,
                width: `calc(${ratio * 100}% + ${1 - 2 * ratio} * var(--reasoning-inset))`,
              }}
            />
          </div>
          <div className="chat-reasoning-rail" ref={railRef}>
            {options.map((option, optionIndex) => (
              <span
                className="chat-reasoning-dot-button"
                key={option.id}
                style={{
                  left: `${(optionIndex / Math.max(1, options.length - 1)) * 100}%`,
                }}
              >
                <span
                  className={`chat-reasoning-dot${optionIndex <= previewIndex ? ' is-filled' : ''}`}
                />
              </span>
            ))}
            <span
              className="chat-reasoning-thumb"
              ref={thumbRef}
              style={{ left: `${ratio * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
