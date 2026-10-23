import { ActionGroup, Button } from '@velin/ui/Button.tsx'
import {
  conversationTitleLimit,
  conversationTitleMessage,
  isValidConversationTitle,
} from '@velin/contracts/policy'
import { errorMessage } from '@velin/contracts/error-copy'
import { useEffect, useId, useRef, useState } from 'react'
import { CardDialog } from '../../components/CardDialog'

export function RenameConversationDialog({
  initialTitle,
  onSave,
  onClose,
}: {
  initialTitle: string
  onSave: (title: string) => Promise<void>
  onClose: () => void
}) {
  const feedbackId = useId()
  const active = useRef(false)
  const [title, setTitle] = useState(initialTitle)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const normalized = title.trim()
  const count = [...normalized].length
  const isValid = isValidConversationTitle(normalized)
  const canSave = isValid && !saving

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  async function submit() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await onSave(normalized)
      if (active.current) onClose()
    } catch (cause) {
      if (active.current) {
        setError(errorMessage(cause, '重命名对话失败，请稍后重试。'))
      }
    } finally {
      if (active.current) setSaving(false)
    }
  }

  return (
    <CardDialog title="重命名对话" onClose={onClose}>
      <form
        className="conversation-rename-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <input
          className="field-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          maxLength={conversationTitleLimit * 2}
          aria-label="对话标题"
          aria-invalid={!isValid}
          aria-describedby={feedbackId}
          value={title}
          disabled={saving}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <p
          className="card-dialog-feedback"
          id={feedbackId}
          role={error ? 'alert' : undefined}
        >
          {error ??
            (isValid
              ? `${count}/${conversationTitleLimit}`
              : conversationTitleMessage)}
        </p>
        <ActionGroup className="card-dialog-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" sizeLabel="保存" disabled={!canSave}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </ActionGroup>
      </form>
    </CardDialog>
  )
}
