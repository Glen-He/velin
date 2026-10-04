import { ActionGroup, Button } from './Button'
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { errorMessage } from '@velin/contracts/error-copy'
import { Modal } from './Modal'
import './confirmation-dialog.css'

// 两端共用确认、占用和错误恢复；实际授权与写入仍由各自边界执行。
export function ConfirmationDialog({
  title,
  children,
  confirmLabel,
  pendingLabel = '处理中…',
  failureMessage = '操作失败，请稍后重试。',
  onConfirm,
  onClose,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  pendingLabel?: string
  failureMessage?: string
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const descriptionId = useId()
  const active = useRef(false)
  const occupied = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  async function confirm() {
    if (occupied.current) return
    occupied.current = true
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      if (active.current) onClose()
    } catch (cause) {
      if (active.current) setError(errorMessage(cause, failureMessage))
    } finally {
      if (active.current) {
        occupied.current = false
        setBusy(false)
      }
    }
  }
  return (
    <Modal label={title} describedBy={descriptionId} onClose={onClose}>
      <div className="confirmation-scrim" onPointerDown={onClose}>
        <section
          className="confirmation-card"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <h2 className="confirmation-title">{title}</h2>
          <p className="confirmation-description" id={descriptionId}>
            {children}
          </p>
          <p
            className="confirmation-feedback"
            role={error ? 'alert' : undefined}
          >
            {error ?? ''}
          </p>
          <ActionGroup className="confirmation-actions">
            <Button variant="outline" type="button" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="danger-primary"
              sizeLabel={confirmLabel}
              type="button"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? pendingLabel : confirmLabel}
            </Button>
          </ActionGroup>
        </section>
      </div>
    </Modal>
  )
}
