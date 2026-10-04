'use client'

import { ActionGroup, Button } from './Button'
import { useId } from 'react'
import { Modal } from './Modal'
import { useDisplayNameEdit } from './useDisplayNameEdit'
import './confirmation-dialog.css'
export function DisplayNameDialog({
  initialName,
  onSave,
  onClose,
}: {
  initialName: string
  onSave: (name: string) => Promise<void>
  onClose: () => void
}) {
  const editor = useDisplayNameEdit(initialName, onSave, onClose)
  const feedbackId = useId()
  return (
    <Modal label="用户名" onClose={onClose}>
      <div className="confirmation-scrim" onPointerDown={onClose}>
        <form
          className="confirmation-card"
          noValidate
          onPointerDown={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault()
            void editor.save()
          }}
        >
          <h2 className="confirmation-title">用户名</h2>
          <input
            className="account-name-input"
            type="text"
            autoComplete="nickname"
            spellCheck={false}
            maxLength={64}
            aria-label="用户名"
            aria-invalid={Boolean(editor.error)}
            aria-describedby={feedbackId}
            value={editor.draft}
            disabled={editor.isSaving}
            onChange={(event) => editor.changeDraft(event.target.value)}
          />
          <p
            className="confirmation-feedback"
            id={feedbackId}
            role={editor.error ? 'alert' : undefined}
          >
            {editor.error ?? `${editor.characterCount}/32`}
          </p>
          <ActionGroup className="confirmation-actions">
            <Button variant="outline" type="button" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="primary"
              sizeLabel="保存"
              type="submit"
              disabled={!editor.canSave}
            >
              {editor.isSaving ? '保存中…' : '保存'}
            </Button>
          </ActionGroup>
        </form>
      </div>
    </Modal>
  )
}
