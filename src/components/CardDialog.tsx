import { Modal } from '@velin/ui/Modal.tsx'
import type { ReactNode } from 'react'

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
  return (
    <Modal label={title} onClose={onClose}>
      <div className="card-dialog-scrim" onPointerDown={onClose}>
        <div
          className={`card-dialog is-${width}`}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <h2 className="card-dialog-title">{title}</h2>
          {children}
        </div>
      </div>
    </Modal>
  )
}
