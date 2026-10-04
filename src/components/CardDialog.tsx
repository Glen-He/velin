import { Modal } from '@velin/ui/Modal.tsx'
import type { ReactNode } from 'react'

export type CardDialogWidth = 'edit' | 'list'

// 居中卡片对话框：Portal 到窗口根层，遮罩点击与 Escape 关闭。
// edit 用于单字段编辑与确认，list 用于设备等多行列表；宽度是上限而非下限。
export function CardDialog({
  title,
  onClose,
  width = 'edit',
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
