import { useEffect, useRef, useState } from 'react'
import { Button } from '@velin/ui/Button.tsx'
import { errorMessage } from '@velin/contracts/error-copy'
import type { ConversationVersion } from '@velin/contracts/memory'
import { CardDialog } from '../../components/CardDialog'

export function ConversationVersionsDialog({
  conversationId,
  onRestore,
  onClose,
}: {
  conversationId: string
  onRestore: (versionId: string) => Promise<void>
  onClose: () => void
}) {
  const [versions, setVersions] = useState<ConversationVersion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const active = useRef(false)
  const occupied = useRef(false)
  useEffect(() => {
    let current = true
    active.current = true
    void window.velin.memory
      .versions({ conversationId })
      .then((result) => {
        if (current) {
          setVersions(result)
          setError(null)
        }
      })
      .catch((cause) => {
        if (current) setError(errorMessage(cause, '读取历史版本失败。'))
      })
    return () => {
      current = false
      active.current = false
    }
  }, [conversationId, retry])
  return (
    <CardDialog title="历史版本" width="list" onClose={onClose}>
      <p className="memory-description">
        编辑和重新生成前的记录保留在这里。恢复时，当前版本也会保存。
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {!versions && !error ? <p aria-live="polite">正在读取…</p> : null}
      {versions?.length === 0 ? <p>还没有其他版本。</p> : null}
      <div className="version-list">
        {versions?.map((version) => (
          <article className="version-entry" key={version.id}>
            <p>{version.preview}</p>
            <p className="memory-description">
              {new Date(version.createdAt).toLocaleString()} ·{' '}
              {version.messageCount} 条消息
            </p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (occupied.current) return
                occupied.current = true
                setBusy(true)
                void onRestore(version.id)
                  .then(() => {
                    if (active.current) onClose()
                  })
                  .catch((cause) => {
                    if (active.current)
                      setError(errorMessage(cause, '恢复版本失败。'))
                  })
                  .finally(() => {
                    if (active.current) {
                      occupied.current = false
                      setBusy(false)
                    }
                  })
              }}
            >
              恢复此版本
            </Button>
          </article>
        ))}
      </div>
      {error ? (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => setRetry((value) => value + 1)}
        >
          重新读取
        </Button>
      ) : null}
      <Button variant="outline" onClick={onClose}>
        关闭
      </Button>
    </CardDialog>
  )
}
