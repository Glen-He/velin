import { useLayoutEffect, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './modal.css'

// 原生模态提供背景 inert、键盘约束与 Escape 关闭。
// 焦点进入对话框容器，用户操作前不抢输入框焦点。
export function Modal({
  label,
  onClose,
  children,
  focusKey,
  describedBy,
}: {
  label: string
  onClose: () => void
  children: ReactNode
  focusKey?: string
  describedBy?: string
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
  useLayoutEffect(() => {
    const dialog = ref.current
    // 提交后禁用当前控件可能使焦点落到 body；仅恢复最上层模态的焦点。
    if (
      dialog?.open &&
      document.activeElement === document.body &&
      [...document.querySelectorAll('dialog[open]')].at(-1) === dialog
    ) {
      dialog.focus({ preventScroll: true })
    }
  })
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
    // Chromium 在原生对话框的 Tab 边界可能短暂聚焦 body。
    // 显式循环边缘焦点，保证键盘始终停留在可见控件上。
    if (
      !first ||
      document.activeElement === dialog ||
      (event.shiftKey && document.activeElement === first) ||
      (!event.shiftKey && document.activeElement === last)
    ) {
      event.preventDefault()
      ;(event.shiftKey ? last : first)?.focus()
    }
  }
  return createPortal(
    <dialog
      ref={ref}
      className="velin-modal-root"
      aria-label={label}
      aria-describedby={describedBy}
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
