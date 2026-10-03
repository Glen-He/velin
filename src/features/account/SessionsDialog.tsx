import { Laptop, LogOut, Smartphone, Tablet, Terminal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DesktopSession } from '@velin/contracts/auth-protocol'
import {
  formatSessionActivity,
  formatSessionClient,
  normalizeSessionClient,
} from '@velin/contracts/session-client'
import type { SessionClientIcon } from '@velin/contracts/session-client'
import { CardDialog } from '../../components/CardDialog'

const maxSessionCount = 64

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
  const [sessions, setSessions] = useState<DesktopSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingRevoke, setPendingRevoke] = useState<DesktopSession | null>(
    null,
  )
  const [isRevokingOthers, setIsRevokingOthers] = useState(false)

  useEffect(() => {
    let active = true

    window.velin.auth
      .listSessions()
      .then((list) => {
        if (active) {
          setSessions(list.slice(0, maxSessionCount))
        }
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error && cause.message
              ? cause.message
              : '读取登录设备失败，请稍后重试。',
          )
        }
      })

    return () => {
      active = false
    }
  }, [])

  async function revokeOne(sessionId: string) {
    if (isRevokingOthers) {
      return
    }

    setError(null)
    try {
      await window.velin.auth.revokeSession(sessionId)
      setSessions((current) =>
        current ? current.filter((item) => item.id !== sessionId) : current,
      )
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : '退出该设备失败，请稍后重试。',
      )
    }
  }

  async function revokeOthers() {
    if (isRevokingOthers) {
      return
    }

    setIsRevokingOthers(true)
    setError(null)
    try {
      await window.velin.auth.revokeOtherSessions()
      setSessions(await window.velin.auth.listSessions())
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : '退出其他设备失败，请稍后重试。',
      )
    } finally {
      setIsRevokingOthers(false)
    }
  }

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
      width="large"
    >
      {sortedSessions === null ? (
        <p className="sessions-loading">正在读取登录设备…</p>
      ) : sortedSessions.length === 0 ? (
        <p className="sessions-loading">当前没有登录记录。</p>
      ) : (
        <div className="sessions-list">
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
                    {client.label}
                    {session.isCurrent ? (
                      <span className="session-current-badge">当前设备</span>
                    ) : null}
                  </div>
                  {activity ? (
                    <div className="session-meta">{activity}</div>
                  ) : null}
                </div>
                {session.isCurrent ? null : (
                  <button
                    className="session-revoke-button"
                    type="button"
                    aria-label="退出该设备"
                    title="退出该设备"
                    disabled={isRevokingOthers}
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

      <p className="card-dialog-feedback" role={error ? 'alert' : undefined}>
        {error ?? ''}
      </p>

      <div className="card-dialog-actions">
        <button
          className="settings-action-button is-outline is-wide"
          type="button"
          onClick={onClose}
        >
          关闭
        </button>
        <button
          className="settings-action-button is-danger-primary is-wide"
          type="button"
          disabled={isRevokingOthers || !hasOtherSessions}
          onClick={() => void revokeOthers()}
        >
          {isRevokingOthers ? '退出中…' : '退出其他设备'}
        </button>
      </div>

      {pendingRevoke ? (
        <CardDialog title="退出设备" onClose={() => setPendingRevoke(null)}>
          <p className="card-dialog-text">
            确认要退出「{describeSession(pendingRevoke).label}
            」吗？该设备上的登录会话将被移除。
          </p>
          <div className="card-dialog-actions">
            <button
              className="settings-action-button is-outline"
              type="button"
              onClick={() => setPendingRevoke(null)}
            >
              取消
            </button>
            <button
              className="settings-action-button is-danger-primary"
              type="button"
              onClick={() => {
                const target = pendingRevoke
                setPendingRevoke(null)
                void revokeOne(target.id)
              }}
            >
              退出设备
            </button>
          </div>
        </CardDialog>
      ) : null}
    </CardDialog>
  )
}
