import { useLayoutEffect, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './modal.css'

// Native modality supplies inert background, keyboard containment and Escape.
// Focus enters the dialog itself, leaving form fields quiet until user input.
export function Modal({
  label,
  onClose,
  children,
  focusKey,
}: {
  label: string
  onClose: () => void
  children: ReactNode
  focusKey?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    dialog.showModal()
    dialog.focus({ preventScroll: true })
    return () => {
      dialog.close()
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [focusKey])
  function containTab(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return
    const dialog = event.currentTarget
    const controls = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]',
      ),
    ].filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        !element.closest('[inert]') &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility === 'visible',
    )
    const first = controls[0]
    const last = controls.at(-1)
    // Chromium briefly focuses body at the native dialog's Tab boundary.
    // Cycle the edges explicitly so the keyboard stays on a visible control.
    if (
      !first ||
      document.activeElement === dialog ||
      (event.shiftKey && document.activeElement === first) ||
      (!event.shiftKey && document.activeElement === last)
    ) {
      event.preventDefault()
      ;(event.shiftKey ? last : first)?.focus({ preventScroll: true })
    }
  }
  return createPortal(
    <dialog
      ref={ref}
      className="velin-modal-root"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={containTab}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      {children}
    </dialog>,
    document.body,
  )
}
