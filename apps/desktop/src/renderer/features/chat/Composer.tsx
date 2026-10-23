import { useComposerLayout } from './useComposerLayout'
import {
  attachmentLimits,
  isImageAttachmentName,
} from '@velin/contracts/attachments'
import { findChatModel } from '@velin/contracts/chat'
import type {
  ChatModelId,
  MessageAttachment,
  ReasoningEffortId,
} from '@velin/contracts/chat'
import { chatLimits } from '@velin/contracts/policy'
import { errorMessage } from '@velin/contracts/error-copy'
import {
  ArrowUp,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Plus,
  Square,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AttachmentChips } from './AttachmentChips'
import { AttachmentOcrDialog } from './AttachmentOcrDialog'
import { ChatOptions } from './ChatOptions'
import {
  chatDraftStorageKey,
  readChatDraft,
  storeChatDraft,
} from './draft-storage'
import { chatKeyAction } from './keyboard-policy'
import { uploadFiles } from './upload-files'
import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react'

type ComposerProps = {
  accountId: string | null
  conversationId?: string
  isStreaming: boolean
  isReadOnly?: boolean
  sendOnEnter: boolean
  chatModel: ChatModelId
  reasoningEffort: ReasoningEffortId
  onChatModelChange: (model: ChatModelId) => void
  onReasoningEffortChange: (effort: ReasoningEffortId) => void
  onSend: (content: string, attachments: MessageAttachment[]) => boolean
  onStop: () => void
}

function attachmentErrorMessage(error: unknown) {
  return errorMessage(error, '添加文件失败，请稍后重试。')
}

function Composer({
  accountId,
  conversationId,
  isStreaming,
  isReadOnly = false,
  sendOnEnter,
  chatModel,
  reasoningEffort,
  onChatModelChange,
  onReasoningEffortChange,
  onSend,
  onStop,
}: ComposerProps) {
  const isComposingRef = useRef(false)
  const lifecycleRef = useRef<AbortController | null>(null)
  const attachmentActionRef = useRef(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const draftKey = chatDraftStorageKey(accountId, conversationId)
  const [value, setValue] = useState(() => readChatDraft(draftKey))
  const { textareaRef, rowRef } = useComposerLayout(value)
  const valueRef = useRef(value)
  const removedAttachmentIdsRef = useRef(new Set<string>())
  const removingIdsRef = useRef(new Set<string>())
  const [removingIds, setRemovingIds] = useState<ReadonlySet<string>>(new Set())
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])
  const [ocrDialogAttachment, setOcrDialogAttachment] =
    useState<MessageAttachment | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [cancelingIds, setCancelingIds] = useState<ReadonlySet<string>>(
    new Set(),
  )
  const [isPicking, setIsPicking] = useState(false)
  const [isReprocessing, setIsReprocessing] = useState(false)
  const [pendingUploads, setPendingUploads] = useState(0)
  const [pendingImages, setPendingImages] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const supportsImages = findChatModel(chatModel).supportsImages
  const isAddingAttachments = isPicking || pendingUploads > 0
  const imageCount = attachments.filter(
    (attachment) => attachment.kind === 'image',
  ).length
  const remainingSlots =
    attachmentLimits.maxFiles - attachments.length - pendingUploads
  const remainingImages =
    attachmentLimits.maxImages - imageCount - pendingImages
  const hasUnsupportedImages = !supportsImages && imageCount > 0
  const visibleAttachmentError = hasUnsupportedImages
    ? '当前模型不支持图片，请切换模型或移除图片。'
    : attachmentError
  const processingKey = attachments
    .filter((attachment) => attachment.status === 'processing')
    .map((attachment) => attachment.id)
    .join(',')
  const canSend =
    !isReadOnly &&
    removingIds.size === 0 &&
    value.trim().length > 0 &&
    !isAddingAttachments &&
    !isReprocessing &&
    !hasUnsupportedImages &&
    attachments.every((attachment) => attachment.status === 'ready')

  useEffect(() => {
    const controller = new AbortController()
    lifecycleRef.current = controller
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => storeChatDraft(draftKey, value), 300)
    return () => window.clearTimeout(timer)
  }, [draftKey, value])

  useEffect(() => () => storeChatDraft(draftKey, valueRef.current), [draftKey])

  useEffect(() => {
    if (!accountId) return
    let active = true
    void window.velin.chat
      .listPendingAttachments(conversationId ? { conversationId } : {})
      .then((pending) => {
        if (!active) return
        const visible = pending.filter(
          (attachment) => !removedAttachmentIdsRef.current.has(attachment.id),
        )
        if (visible.length === 0) return
        setAttachments((current) => {
          const known = new Set(current.map((attachment) => attachment.id))
          return [
            ...current,
            ...visible.filter((item) => !known.has(item.id)),
          ].slice(0, attachmentLimits.maxFiles)
        })
        const failed = visible.find(
          (attachment) => attachment.status === 'failed',
        )
        if (failed) {
          setAttachmentError(failed.ocrError ?? 'PDF 识别失败，请重试。')
        }
      })
      .catch((error: unknown) => {
        if (active) setAttachmentError(attachmentErrorMessage(error))
      })
    return () => {
      active = false
    }
  }, [accountId, conversationId])

  useEffect(() => {
    if (!processingKey) return
    const ids = processingKey.split(',')
    let active = true
    let timer: number | undefined
    const poll = async () => {
      // 等待本轮所有请求结束，单个失败不阻断其他附件的进度更新。
      const results = await Promise.allSettled(
        ids.map(async (attachmentId) =>
          window.velin.chat.getAttachmentStatus({ attachmentId }),
        ),
      )
      if (!active) return

      setPollError(
        results.some((result) => result.status === 'rejected')
          ? '暂时无法刷新 PDF 识别进度，将自动重试。'
          : null,
      )
      const updates = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      )
      if (updates.length > 0) {
        setAttachments((current) =>
          current.map(
            (attachment) =>
              updates.find((update) => update.id === attachment.id) ??
              attachment,
          ),
        )
        // 取消请求成功只表示已受理，确认终态后才能解除取消中的状态。
        setCancelingIds((current) => {
          const next = new Set(current)
          for (const attachment of updates) {
            if (attachment.status !== 'processing') next.delete(attachment.id)
          }
          return next.size === current.size ? current : next
        })
        const failed = updates.find(
          (attachment) => attachment.status === 'failed',
        )
        if (failed) {
          setAttachmentError(failed.ocrError ?? 'PDF 识别失败，请重试。')
        }
      }
      timer = window.setTimeout(() => void poll(), 1000)
    }
    void poll()
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [processingKey])

  useEffect(() => {
    if (!menuOpen) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  async function pickFiles(kind: 'file' | 'image') {
    if (!accountId) {
      setAttachmentError('请先登录后再添加附件。')
      return
    }
    const signal = lifecycleRef.current?.signal
    if (
      !signal ||
      signal.aborted ||
      attachmentActionRef.current ||
      isStreaming ||
      isReadOnly
    )
      return
    setMenuOpen(false)
    if (kind === 'image' && !supportsImages) {
      setAttachmentError('当前模型不支持图片，请先切换模型。')
      return
    }

    const remaining =
      kind === 'image'
        ? Math.min(remainingSlots, remainingImages)
        : remainingSlots
    if (remaining <= 0) {
      setAttachmentError(
        kind === 'image'
          ? `一条消息最多添加 ${attachmentLimits.maxImages} 张图片。`
          : `一条消息最多添加 ${attachmentLimits.maxFiles} 个文件。`,
      )
      return
    }

    attachmentActionRef.current = true
    setIsPicking(true)
    setAttachmentError(null)
    try {
      const result = await window.velin.chat.pickAttachments({
        accountId,
        kind,
        remaining,
        ...(conversationId ? { conversationId } : {}),
      })
      if (signal.aborted) return
      if (result.attachments.length > 0) {
        setAttachments((current) =>
          [...current, ...result.attachments].slice(
            0,
            attachmentLimits.maxFiles,
          ),
        )
      }
      if (result.error) setAttachmentError(result.error)
    } catch (error) {
      if (!signal.aborted) setAttachmentError(attachmentErrorMessage(error))
    } finally {
      if (!signal.aborted) {
        attachmentActionRef.current = false
        setIsPicking(false)
      }
    }
  }

  async function addFiles(files: File[]) {
    if (!accountId) {
      setAttachmentError('请先登录后再添加附件。')
      return
    }
    const signal = lifecycleRef.current?.signal
    if (
      !signal ||
      signal.aborted ||
      attachmentActionRef.current ||
      isStreaming ||
      isReadOnly ||
      files.length === 0
    )
      return

    let fileSlots =
      attachmentLimits.maxFiles - attachments.length - pendingUploads
    let imageSlots = attachmentLimits.maxImages - imageCount - pendingImages
    const selected: { file: File; isImage: boolean }[] = []
    let unsupportedImage = false

    for (const file of files) {
      const isImage = isImageAttachmentName(file.name)
      if (isImage) {
        if (!supportsImages) {
          unsupportedImage = true
          continue
        }
        if (imageSlots <= 0 || fileSlots <= 0) continue
        imageSlots -= 1
        fileSlots -= 1
        selected.push({ file, isImage: true })
      } else {
        if (fileSlots <= 0) continue
        fileSlots -= 1
        selected.push({ file, isImage: false })
      }
    }

    if (unsupportedImage) {
      setAttachmentError('当前模型不支持图片，请先切换模型。')
    } else if (selected.length < files.length) {
      setAttachmentError(
        `最多还能添加 ${selected.length} 个文件，请检查数量或类型限制。`,
      )
    } else {
      setAttachmentError(null)
    }
    if (selected.length === 0) return

    attachmentActionRef.current = true
    setPendingUploads((count) => count + selected.length)
    setPendingImages(
      (count) => count + selected.filter((item) => item.isImage).length,
    )
    try {
      await uploadFiles(selected, {
        accountId,
        signal,
        conversationId,
        upload: window.velin.chat.uploadAttachment,
        onUploaded: (attachment) => {
          setAttachments((current) =>
            current.length >= attachmentLimits.maxFiles
              ? current
              : [...current, attachment],
          )
        },
        onError: (error) => setAttachmentError(attachmentErrorMessage(error)),
        onSettled: (isImage) => {
          setPendingUploads((count) => Math.max(0, count - 1))
          if (isImage) setPendingImages((count) => Math.max(0, count - 1))
        },
      })
    } finally {
      if (!signal.aborted) attachmentActionRef.current = false
    }
  }

  async function removeAttachment(attachmentId: string) {
    const signal = lifecycleRef.current?.signal
    if (
      !signal ||
      signal.aborted ||
      isStreaming ||
      isReadOnly ||
      removingIdsRef.current.has(attachmentId)
    )
      return
    removingIdsRef.current.add(attachmentId)
    setRemovingIds(new Set(removingIdsRef.current))
    try {
      await window.velin.chat.deleteAttachment({ attachmentId })
      if (signal.aborted) return
      removedAttachmentIdsRef.current.add(attachmentId)
      setAttachments((current) =>
        current.filter((attachment) => attachment.id !== attachmentId),
      )
      setCancelingIds((current) => {
        const next = new Set(current)
        next.delete(attachmentId)
        return next
      })
      if (
        !attachments.some(
          (attachment) =>
            attachment.id !== attachmentId &&
            attachment.status === 'processing',
        )
      )
        setPollError(null)
      setAttachmentError(null)
    } catch (error) {
      if (!signal.aborted) setAttachmentError(attachmentErrorMessage(error))
    } finally {
      if (!signal.aborted) {
        removingIdsRef.current.delete(attachmentId)
        setRemovingIds(new Set(removingIdsRef.current))
      }
    }
  }

  async function cancelProcessing(attachmentId: string) {
    if (cancelingIds.has(attachmentId)) return
    setCancelingIds((current) => new Set(current).add(attachmentId))
    try {
      await window.velin.chat.cancelAttachmentProcessing({ attachmentId })
    } catch (error) {
      setAttachmentError(attachmentErrorMessage(error))
      setCancelingIds((current) => {
        const next = new Set(current)
        next.delete(attachmentId)
        return next
      })
    }
  }

  function submit() {
    if (
      isStreaming ||
      !canSend ||
      attachmentActionRef.current ||
      removingIdsRef.current.size > 0
    ) {
      return
    }

    setMenuOpen(false)
    if (!onSend(value, attachments)) return
    valueRef.current = ''
    setValue('')
    storeChatDraft(draftKey, '')
    removedAttachmentIdsRef.current.clear()
    setAttachments([])
    setCancelingIds(new Set())
    setAttachmentError(null)
    setPollError(null)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submit()
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const action = chatKeyAction(
      {
        key: event.key,
        isComposing: event.nativeEvent.isComposing || isComposingRef.current,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
      },
      sendOnEnter,
    )
    if (action !== 'submit') return

    event.preventDefault()
    submit()
  }

  function handleDragOver(event: ReactDragEvent<HTMLFormElement>) {
    if (isStreaming || isReadOnly) return
    event.preventDefault()
    setIsDragging(true)
  }

  function handleDrop(event: ReactDragEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsDragging(false)
    if (isStreaming || isReadOnly) return
    void addFiles([...event.dataTransfer.files])
  }

  function handlePaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files]
    if (files.length === 0) return
    event.preventDefault()
    void addFiles(files)
  }

  return (
    <div className="composer-shell">
      <form
        className={`composer${isDragging ? ' is-drop-target' : ''}`}
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        {attachments.length > 0 || visibleAttachmentError || pollError ? (
          <div className="composer-attachments">
            <AttachmentChips
              attachments={attachments}
              onRemove={(attachmentId) => void removeAttachment(attachmentId)}
              removingIds={removingIds}
              onConfigureOcr={setOcrDialogAttachment}
              onCancelOcr={(attachmentId) =>
                void cancelProcessing(attachmentId)
              }
              cancelingIds={cancelingIds}
              ocrDisabled={
                isStreaming ||
                isReadOnly ||
                isAddingAttachments ||
                isReprocessing
              }
            />
            {visibleAttachmentError ? (
              <p className="composer-attachment-error" role="alert">
                {visibleAttachmentError}
              </p>
            ) : null}
            {pollError ? (
              <p className="composer-attachment-error" role="alert">
                {pollError}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="composer-row" ref={rowRef}>
          <textarea
            ref={textareaRef}
            maxLength={chatLimits.messageCharacters}
            aria-label="输入消息"
            placeholder="输入消息..."
            rows={1}
            disabled={isStreaming || isReadOnly}
            value={value}
            onChange={(event) => {
              valueRef.current = event.currentTarget.value
              setValue(event.currentTarget.value)
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => {
              isComposingRef.current = true
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false
            }}
          />
          <div className="composer-attachment" ref={menuRef}>
            <button
              className="composer-attachment-button"
              type="button"
              aria-label={isAddingAttachments ? '正在添加附件' : '添加附件'}
              aria-busy={isAddingAttachments}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={isStreaming || isReadOnly || isAddingAttachments}
              onClick={() => {
                if (remainingSlots <= 0) {
                  setAttachmentError(
                    `一条消息最多添加 ${attachmentLimits.maxFiles} 个文件。`,
                  )
                  return
                }
                setMenuOpen((current) => !current)
              }}
            >
              {isAddingAttachments ? (
                <LoaderCircle
                  className="composer-attachment-spinner"
                  aria-hidden="true"
                />
              ) : (
                <Plus
                  className={`composer-attachment-icon${menuOpen ? ' is-open' : ''}`}
                  aria-hidden="true"
                />
              )}
            </button>
            {menuOpen ? (
              <div className="composer-attachment-menu" role="menu">
                <button
                  className="composer-attachment-menu-item"
                  type="button"
                  role="menuitem"
                  disabled={isAddingAttachments || remainingSlots <= 0}
                  onClick={() => void pickFiles('file')}
                >
                  <FileText
                    className="composer-attachment-menu-icon"
                    aria-hidden="true"
                  />
                  <span>添加文件</span>
                </button>
                {supportsImages ? (
                  <button
                    className="composer-attachment-menu-item"
                    type="button"
                    role="menuitem"
                    disabled={isAddingAttachments || remainingImages <= 0}
                    onClick={() => void pickFiles('image')}
                  >
                    <ImageIcon
                      className="composer-attachment-menu-icon"
                      aria-hidden="true"
                    />
                    <span>添加图片</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <ChatOptions
            chatModel={chatModel}
            reasoningEffort={reasoningEffort}
            onChatModelChange={(model) => {
              setAttachmentError(null)
              onChatModelChange(model)
            }}
            onReasoningEffortChange={onReasoningEffortChange}
          />
          {isStreaming ? (
            <button
              className="send-button stop-button"
              type="button"
              onClick={onStop}
              aria-label="停止生成"
            >
              <Square className="send-button-icon" aria-hidden="true" />
            </button>
          ) : (
            <button
              className="send-button"
              type="submit"
              disabled={!canSend}
              aria-label="发送消息"
            >
              <ArrowUp className="send-button-icon" aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
      {ocrDialogAttachment ? (
        <AttachmentOcrDialog
          attachment={ocrDialogAttachment}
          onClose={() => setOcrDialogAttachment(null)}
          onApply={async (pageRange) => {
            if (isReprocessing) return '正在提交识别请求，请稍候。'
            setIsReprocessing(true)
            try {
              const updated = await window.velin.chat.reprocessAttachment({
                attachmentId: ocrDialogAttachment.id,
                pageRange,
              })
              setAttachments((current) =>
                current.map((attachment) =>
                  attachment.id === ocrDialogAttachment.id
                    ? updated
                    : attachment,
                ),
              )
              setAttachmentError(null)
              return null
            } catch (error) {
              return attachmentErrorMessage(error)
            } finally {
              setIsReprocessing(false)
            }
          }}
        />
      ) : null}
    </div>
  )
}

export default Composer
