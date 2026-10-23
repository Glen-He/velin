import { useEffect, useRef, useState } from 'react'
import { Brain, Pencil, Search, Trash2 } from 'lucide-react'
import { ActionGroup, Button } from '@velin/ui/Button.tsx'
import { ConfirmationDialog } from '@velin/ui/ConfirmationDialog.tsx'
import { TruncatedText } from '@velin/ui/TruncatedText.tsx'
import { errorMessage } from '@velin/contracts/error-copy'
import type {
  MemoryAction,
  MemoryEntry,
  MemoryState,
} from '@velin/contracts/memory'
import { CardDialog } from '../../components/CardDialog'

function MemoryEditor({
  entry,
  onSave,
  onClose,
}: {
  entry: MemoryEntry | null
  onSave: (topic: string, content: string) => Promise<void>
  onClose: () => void
}) {
  const [topic, setTopic] = useState(entry?.topic ?? '')
  const [content, setContent] = useState(entry?.content ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const active = useRef(true)
  const occupied = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (occupied.current || !topic.trim() || !content.trim()) return
        occupied.current = true
        setBusy(true)
        setError(null)
        void onSave(topic.trim(), content.trim())
          .then(() => {
            if (active.current) onClose()
          })
          .catch((cause) => {
            if (active.current)
              setError(errorMessage(cause, '保存失败，请重试。'))
          })
          .finally(() => {
            if (active.current) {
              occupied.current = false
              setBusy(false)
            }
          })
      }}
    >
      <label className="memory-field">
        主题
        <input
          className="field-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={100}
          value={topic}
          disabled={busy}
          onChange={(event) => setTopic(event.target.value)}
          required
        />
      </label>
      <label className="memory-field">
        内容
        <textarea
          className="field-input field-textarea"
          maxLength={1000}
          rows={4}
          value={content}
          disabled={busy}
          onChange={(event) => setContent(event.target.value)}
          required
        />
      </label>
      {entry?.sourceQuote ? (
        <div className="memory-source">
          <span>来自你的对话</span>
          <blockquote>{entry.sourceQuote}</blockquote>
        </div>
      ) : null}
      {error ? (
        <p className="card-dialog-feedback" role="alert">
          {error}
        </p>
      ) : null}
      <ActionGroup className="card-dialog-actions">
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button
          type="submit"
          sizeLabel="保存"
          disabled={busy || !topic.trim() || !content.trim()}
        >
          {busy ? '保存中…' : '保存'}
        </Button>
      </ActionGroup>
    </form>
  )
}

export function MemoryManagerDialog({
  data,
  error,
  busy,
  onReload,
  onUpdate,
  onClose,
}: {
  data: MemoryState | null
  error: string | null
  busy: boolean
  onReload: () => Promise<void>
  onUpdate: (action: MemoryAction) => Promise<void>
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<{ entry: MemoryEntry | null } | null>(
    null,
  )
  const [deleting, setDeleting] = useState<MemoryEntry | 'all' | null>(null)
  const normalized = query.trim().toLocaleLowerCase()
  const entries =
    data?.entries.filter((entry) =>
      `${entry.topic}\n${entry.content}`
        .toLocaleLowerCase()
        .includes(normalized),
    ) ?? []
  return (
    <CardDialog
      title={editor ? (editor.entry ? '编辑记忆' : '添加记忆') : '已保存的记忆'}
      width="list"
      focusKey={
        editor ? `memory-edit:${editor.entry?.id ?? 'new'}` : 'memory-list'
      }
      onClose={editor ? () => setEditor(null) : deleting ? () => {} : onClose}
    >
      {editor ? (
        <MemoryEditor
          entry={editor.entry}
          onClose={() => setEditor(null)}
          onSave={(topic, content) =>
            onUpdate({
              action: 'save',
              entry: {
                ...(editor.entry
                  ? { id: editor.entry.id, version: editor.entry.version }
                  : {}),
                topic,
                content,
              },
            })
          }
        />
      ) : (
        <>
          {data?.entries.length ? (
            <label className="memory-search field-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                aria-label="搜索记忆"
                placeholder="搜索记忆"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <span>{data.entries.length} 条</span>
            </label>
          ) : null}
          <div className="memory-manager-list" aria-busy={!data && !error}>
            {!data ? (
              <div className="memory-empty">
                <p>{error ? '暂时无法读取记忆' : '正在读取…'}</p>
              </div>
            ) : entries.length === 0 ? (
              <div className="memory-empty">
                <Brain aria-hidden="true" />
                <p>{normalized ? '没有匹配的记忆' : '还没有保存的记忆'}</p>
                <span>
                  {normalized
                    ? '试试其他关键词。'
                    : '告诉 Velin 你的偏好，或手动添加一条。'}
                </span>
              </div>
            ) : (
              entries.map((entry) => (
                <article className="memory-manager-row" key={entry.id}>
                  <div className="memory-manager-copy">
                    <TruncatedText className="memory-topic">
                      {entry.topic}
                    </TruncatedText>
                    <TruncatedText className="memory-preview">
                      {entry.content}
                    </TruncatedText>
                  </div>
                  <div className="memory-row-actions">
                    <button
                      className="panel-icon-action"
                      type="button"
                      aria-label={`编辑记忆：${entry.topic}`}
                      disabled={busy}
                      onClick={() => setEditor({ entry })}
                    >
                      <Pencil aria-hidden="true" />
                    </button>
                    <button
                      className="panel-icon-action"
                      data-tone="danger"
                      type="button"
                      aria-label={`删除记忆：${entry.topic}`}
                      disabled={busy}
                      onClick={() => setDeleting(entry)}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
          {error ? (
            <div className="memory-inline-error" role="alert">
              <span>{error}</span>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void onReload()}
              >
                重试
              </Button>
            </div>
          ) : null}
          <div className="memory-manager-footer">
            {data?.entries.length ? (
              <button
                className="text-action"
                data-tone="danger"
                type="button"
                disabled={busy}
                onClick={() => setDeleting('all')}
              >
                清空记忆
              </button>
            ) : (
              <span />
            )}
            <ActionGroup>
              <Button variant="outline" onClick={onClose}>
                关闭
              </Button>
              <Button
                variant="primary"
                disabled={busy || !data}
                onClick={() => setEditor({ entry: null })}
              >
                添加记忆
              </Button>
            </ActionGroup>
          </div>
        </>
      )}
      {deleting ? (
        <ConfirmationDialog
          title={deleting === 'all' ? '清空个人记忆' : '删除这条记忆'}
          confirmLabel="删除"
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            onUpdate(
              deleting === 'all'
                ? { action: 'clear' }
                : {
                    action: 'delete',
                    id: deleting.id,
                    version: deleting.version,
                  },
            )
          }
        >
          {deleting === 'all'
            ? '清空后，不再使用已有记忆或参考此前的聊天。原聊天记录仍然保留。'
            : deleting.origin === 'automatic'
              ? '这条记忆及它记录的来源消息，将不再用于之后的对话。原聊天记录仍然保留。'
              : '删除后将不再使用这条记忆，原聊天记录仍然保留。'}
        </ConfirmationDialog>
      ) : null}
    </CardDialog>
  )
}
