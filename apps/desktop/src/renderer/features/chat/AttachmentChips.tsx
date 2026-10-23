import type { MessageAttachment } from '@velin/contracts/chat'
import { FileText, X } from 'lucide-react'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type AttachmentChipsProps = {
  attachments: MessageAttachment[]
  onRemove?: (attachmentId: string) => void
  onConfigureOcr?: (attachment: MessageAttachment) => void
  onCancelOcr?: (attachmentId: string) => void
  cancelingIds?: ReadonlySet<string>
  removingIds?: ReadonlySet<string>
  ocrDisabled?: boolean
  variant?: 'composer' | 'message'
}

export function AttachmentChips({
  attachments,
  onRemove,
  onConfigureOcr,
  onCancelOcr,
  cancelingIds,
  removingIds,
  ocrDisabled = false,
  variant = 'composer',
}: AttachmentChipsProps) {
  if (attachments.length === 0) return null

  return (
    <div className={`attachment-chips is-${variant}`} aria-label="附件">
      {attachments.map((attachment) => (
        <span
          className={`attachment-chip${
            attachment.kind === 'image' ? ' is-image' : ''
          }`}
          key={attachment.id}
        >
          {attachment.kind === 'image' && attachment.thumbnail ? (
            <img
              className="attachment-chip-image"
              src={attachment.thumbnail}
              alt={attachment.name}
            />
          ) : (
            <FileText className="attachment-chip-icon" aria-hidden="true" />
          )}
          <span className="attachment-chip-name" title={attachment.name}>
            {attachment.name}
          </span>
          <span className="attachment-chip-size">
            {formatSize(attachment.sizeBytes)}
          </span>
          {attachment.status === 'processing' ? (
            <>
              <span className="attachment-chip-status" aria-busy="true">
                {attachment.progress && attachment.progress.total > 0
                  ? `OCR ${attachment.progress.completed}/${attachment.progress.total}`
                  : attachment.mimeType === 'application/pdf'
                    ? 'OCR 准备中'
                    : '处理中'}
              </span>
              {onCancelOcr && attachment.mimeType === 'application/pdf' ? (
                <button
                  className="attachment-chip-action"
                  type="button"
                  aria-label={`停止识别 ${attachment.name}`}
                  disabled={cancelingIds?.has(attachment.id)}
                  onClick={() => onCancelOcr(attachment.id)}
                >
                  {cancelingIds?.has(attachment.id) ? '停止中' : '停止'}
                </button>
              ) : null}
            </>
          ) : (
            <>
              {attachment.status !== 'ready' ? (
                <span className="attachment-chip-status is-error">
                  {attachment.status === 'failed' ? '失败' : '已停止'}
                </span>
              ) : null}
              {onConfigureOcr &&
              attachment.kind === 'file' &&
              attachment.mimeType === 'application/pdf' ? (
                <button
                  className="attachment-chip-action"
                  type="button"
                  aria-label={`设置 ${attachment.name} 的 OCR 页码`}
                  disabled={ocrDisabled}
                  onClick={() => onConfigureOcr(attachment)}
                >
                  OCR
                </button>
              ) : null}
              {onRemove ? (
                <button
                  className="attachment-chip-remove"
                  type="button"
                  aria-label={`${removingIds?.has(attachment.id) ? '正在移除附件' : '移除附件'} ${attachment.name}`}
                  disabled={ocrDisabled || removingIds?.has(attachment.id)}
                  onClick={() => onRemove(attachment.id)}
                >
                  <X aria-hidden="true" />
                </button>
              ) : null}
            </>
          )}
        </span>
      ))}
    </div>
  )
}
