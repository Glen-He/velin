import { ActionGroup, Button } from '@velin/ui/Button.tsx'
import {
  attachmentLimits,
  formatOcrPageRange,
  parseOcrPageRange,
  type MessageAttachment,
} from '@velin/contracts/attachments'
import { useEffect, useId, useRef, useState } from 'react'
import { CardDialog } from '../../components/CardDialog'

export function AttachmentOcrDialog({
  attachment,
  onApply,
  onClose,
}: {
  attachment: MessageAttachment
  onApply: (pageRange: string) => Promise<string | null>
  onClose: () => void
}) {
  const feedbackId = useId()
  const active = useRef(false)
  const [value, setValue] = useState(attachment.ocrPageRange ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parsed = parseOcrPageRange(value)
  const validationMessage =
    parsed && !parsed.ok
      ? parsed.error === 'limit'
        ? `一次最多识别 ${attachmentLimits.pdfOcrPages} 页。`
        : '页码格式无效，请使用如 3-8,12 的格式。'
      : null
  const canSubmit = !validationMessage && !busy

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const pageRange = parsed?.ok ? formatOcrPageRange(parsed.pages) : ''
      const message = await onApply(pageRange)
      if (!active.current) return
      if (message) {
        setError(message)
      } else {
        onClose()
      }
    } finally {
      if (active.current) setBusy(false)
    }
  }

  return (
    <CardDialog title="OCR 页码" onClose={onClose}>
      <form
        className="conversation-rename-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <p className="attachment-ocr-hint">
          {attachment.name}：只对扫描页生效；留空时自动识别最多{' '}
          {attachmentLimits.pdfOcrPages} 页扫描页。
          {attachment.pageCount ? `PDF 共 ${attachment.pageCount} 页。` : ''}
        </p>
        <input
          className="field-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          maxLength={120}
          placeholder="例如 3-8,12"
          aria-label="OCR 页码范围"
          aria-invalid={Boolean(validationMessage)}
          aria-describedby={feedbackId}
          value={value}
          disabled={busy}
          onChange={(event) => {
            setValue(event.currentTarget.value)
            setError(null)
          }}
        />
        <p
          className={`card-dialog-feedback${
            error || validationMessage ? ' is-error' : ''
          }`}
          id={feedbackId}
          role={error ? 'alert' : undefined}
        >
          {error ??
            validationMessage ??
            (parsed?.ok
              ? `将识别第 ${formatOcrPageRange(parsed.pages)} 页`
              : '留空：自动选择扫描页')}
        </p>
        <ActionGroup className="card-dialog-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            {busy ? '关闭' : '取消'}
          </Button>
          <Button type="submit" sizeLabel="开始识别" disabled={!canSubmit}>
            {busy ? '提交中…' : '开始识别'}
          </Button>
        </ActionGroup>
      </form>
    </CardDialog>
  )
}
