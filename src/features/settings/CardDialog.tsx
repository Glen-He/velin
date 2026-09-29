import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type CardDialogWidth = 'base' | 'large' | 'extra'

// 居中卡片对话框：Portal 到窗口根层，遮罩点击与 Escape 关闭。
// base 是所有对话框的最小宽度；内容更多时按档升到 large / extra。
export function CardDialog({
  title,
  onClose,
  width = 'base',
  children,
}: {
  title: string
  onClose: () => void
  width?: CardDialogWidth
  children: ReactNode
}) {
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return createPortal(
    <div className="card-dialog-scrim" onPointerDown={onClose}>
      <div
        className={`card-dialog is-${width}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 className="card-dialog-title">{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}
