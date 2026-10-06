import { ActionGroup, Button } from '@velin/ui/Button.tsx'
import { TruncatedText } from '@velin/ui/TruncatedText.tsx'
import { Laptop, LogOut, Smartphone, Tablet, Terminal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { DesktopSession } from '@velin/contracts/auth-protocol'
import {
  formatSessionActivity,
  formatSessionClient,
  normalizeSessionClient,
} from '@velin/contracts/session-client'
import type { SessionClientIcon } from '@velin/contracts/session-client'
import { CardDialog } from '../../components/CardDialog'

import { ConfirmationDialog } from '@velin/ui/ConfirmationDialog.tsx'

import { createDesktopSessionList } from './session-list-store'

const sessionClientIcons: Record<SessionClientIcon, LucideIcon> = {
  desktop: Laptop,
  phone: Smartphone,
  tablet: Tablet,
  terminal: Terminal,
}

function describeSession(session: DesktopSession) {
  return formatSessionClient(
    normalizeSessionClient({
      userAgent: session.userAgent,
      clientMetadata: session.clientMetadata,
    }),
  )
}

// 设备会话列表由 Main 通过 better-auth 内置能力读取；当前设备行
// 只作标识，退出动作仅对其他设备开放，且需先经确认卡片。
export function SessionsDialog({ onClose }: { onClose: () => void }) {
  const [store] = useState(() => createDesktopSessionList(window.velin.auth))
  const { sessions, error, loading, pending } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
  )
  const [pendingRevoke, setPendingRevoke] = useState<
    DesktopSession | 'others' | null
  >(null)
  const busy = loading || pending !== null
  const isRevokingOthers = pending === 'others'
  useEffect(() => {
    void store.activate()
    return store.deactivate
  }, [store])

  const hasOtherSessions =
    sessions !== null && sessions.some((session) => !session.isCurrent)

  // 当前设备固定置顶，其余按最近活跃排序。
  const sortedSessions = sessions
    ? [...sessions].sort((a, b) => {
        if (a.isCurrent !== b.isCurrent) {
          return a.isCurrent ? -1 : 1
        }

        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      })
    : null

  return (
    <CardDialog
      title="登录设备"
      onClose={pendingRevoke ? () => {} : onClose}
      width="list"
    >
      <div className="sessions-list" aria-busy={loading}>
        {sortedSessions === null ? (
          <TruncatedText className="sessions-loading">
            {loading || !error ? '正在读取登录设备…' : '未能读取登录设备。'}
          </TruncatedText>
        ) : sortedSessions.length === 0 ? (
          <TruncatedText className="sessions-loading">
            当前没有登录记录。
          </TruncatedText>
        ) : (
          <div>
            {sortedSessions.map((session) => {
              const client = describeSession(session)
              const DeviceIcon = sessionClientIcons[client.icon]
              const activity = formatSessionActivity(session.updatedAt)

              return (
                <div className="session-row" key={session.id}>
                  <span className="session-icon" aria-hidden="true">
                    <DeviceIcon />
                  </span>
                  <div className="session-copy">
                    <div className="session-name">
                      <TruncatedText>{client.label}</TruncatedText>
                      {session.isCurrent ? (
                        <span className="session-current-badge">当前设备</span>
                      ) : null}
                    </div>
                    {activity ? (
                      <TruncatedText className="session-meta">
                        {activity}
                      </TruncatedText>
                    ) : null}
                  </div>
                  {session.isCurrent ? null : (
                    <button
                      className="panel-icon-action"
                      data-tone="danger"
                      type="button"
                      aria-label="退出该设备"
                      disabled={busy}
                      onClick={() => setPendingRevoke(session)}
                    >
                      <LogOut aria-hidden="true" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <p className="card-dialog-feedback" role={error ? 'alert' : undefined}>
        {error ?? ''}
      </p>

      <ActionGroup className="card-dialog-actions">
        {error ? (
          <Button
            variant="secondary"
            type="button"
            disabled={busy}
            onClick={() => void store.reload()}
          >
            重新读取
          </Button>
        ) : null}
        <Button variant="outline" type="button" onClick={onClose}>
          关闭
        </Button>
        <Button
          variant="danger"
          sizeLabel="退出其他设备"
          type="button"
          disabled={busy || !hasOtherSessions}
          onClick={() => setPendingRevoke('others')}
        >
          {isRevokingOthers ? '退出中…' : '退出其他设备'}
        </Button>
      </ActionGroup>

      {pendingRevoke ? (
        <ConfirmationDialog
          title={pendingRevoke === 'others' ? '退出其他设备' : '退出设备'}
          confirmLabel={
            pendingRevoke === 'others' ? '退出其他设备' : '退出设备'
          }
          pendingLabel="退出中…"
          onClose={() => setPendingRevoke(null)}
          onConfirm={async () => {
            const target = pendingRevoke === 'others' ? null : pendingRevoke.id
            if (!(await store.revoke(target)))
              throw new Error(
                store.getSnapshot().error ??
                  '设备状态已变化，请重新读取后重试。',
              )
          }}
        >
          {pendingRevoke === 'others'
            ? '确认要退出其他所有设备吗？当前设备会保持登录，其他设备需要重新登录。'
            : `确认要退出「${describeSession(pendingRevoke).label}」吗？该设备需要重新登录。`}
        </ConfirmationDialog>
      ) : null}
    </CardDialog>
  )
}
