import { Laptop, LogOut, Smartphone, Tablet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DesktopSession } from '../../shared/auth-protocol'
import { CardDialog } from '../settings/CardDialog'

const maxSessionCount = 64

type DeviceDescription = {
  platform: string
  detail: string | null
  icon: LucideIcon
}

function detectPlatformKind(userAgent: string) {
  if (/iphone/i.test(userAgent)) return 'ios'
  if (/ipad/i.test(userAgent)) return 'ipados'
  if (/android/i.test(userAgent)) return 'android'
  if (/windows/i.test(userAgent)) return 'windows'
  if (/macintosh|mac os x/i.test(userAgent)) return 'mac'
  if (/linux/i.test(userAgent)) return 'linux'
  return null
}

function detectOsName(kind: ReturnType<typeof detectPlatformKind>) {
  switch (kind) {
    case 'mac':
      return 'macOS'
    case 'windows':
      return 'Windows'
    case 'linux':
      return 'Linux'
    case 'ios':
      return 'iOS'
    case 'ipados':
      return 'iPadOS'
    case 'android':
      return 'Android'
    default:
      return null
  }
}

function detectBrowser(userAgent: string) {
  if (/edg\//i.test(userAgent)) return 'Edge'
  if (/opr\//i.test(userAgent)) return 'Opera'
  if (/firefox\//i.test(userAgent)) return 'Firefox'
  if (/chrome\//i.test(userAgent)) return 'Chrome'
  if (/safari\//i.test(userAgent)) return 'Safari'
  return null
}

// 参考 macOS 设备列表的两段式命名：平台 • 详情。
function describeDevice(userAgent: string | null): DeviceDescription {
  if (!userAgent) {
    return { platform: '未知设备', detail: null, icon: Laptop }
  }

  const kind = detectPlatformKind(userAgent)
  const osName = detectOsName(kind)
  const browser = detectBrowser(userAgent)

  if (/electron/i.test(userAgent)) {
    return { platform: 'Desktop', detail: osName, icon: Laptop }
  }

  if (kind === 'ios') {
    return { platform: 'iPhone', detail: browser ?? 'iOS', icon: Smartphone }
  }

  if (kind === 'ipados') {
    return { platform: 'iPad', detail: browser ?? 'iPadOS', icon: Tablet }
  }

  if (kind === 'android') {
    return { platform: 'Android', detail: browser ?? 'Android', icon: Smartphone }
  }

  return { platform: 'Web', detail: browser ?? osName, icon: Laptop }
}

function formatDeviceLabel(description: DeviceDescription) {
  return description.detail
    ? `${description.platform} • ${description.detail}`
    : description.platform
}

function formatActivity(iso: string) {
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return `${date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })} ${date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`
}

// 设备会话列表由 Main 通过 better-auth 内置能力读取；当前设备行
// 只作标识，退出动作仅对其他设备开放，且需先经确认卡片。
export function SessionsDialog({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<DesktopSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingRevoke, setPendingRevoke] = useState<DesktopSession | null>(null)
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

  async function revokeOne(token: string) {
    if (isRevokingOthers) {
      return
    }

    setError(null)
    try {
      await window.velin.auth.revokeSession(token)
      setSessions((current) =>
        current ? current.filter((item) => item.token !== token) : current,
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
            const description = describeDevice(session.userAgent)
            const DeviceIcon = description.icon
            const activity = formatActivity(session.updatedAt)

            return (
              <div className="session-row" key={session.token}>
                <span className="session-icon" aria-hidden="true">
                  <DeviceIcon />
                </span>
                <div className="session-copy">
                  <div className="session-name">
                    {formatDeviceLabel(description)}
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
          className="settings-action-button is-secondary is-wide"
          type="button"
          onClick={onClose}
        >
          关闭
        </button>
        <button
          className="settings-action-button is-danger is-wide"
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
            确认要退出「{formatDeviceLabel(describeDevice(pendingRevoke.userAgent))}
            」吗？该设备上的登录会话将被移除。
          </p>
          <div className="card-dialog-actions">
            <button
              className="settings-action-button is-secondary"
              type="button"
              onClick={() => setPendingRevoke(null)}
            >
              取消
            </button>
            <button
              className="settings-action-button is-danger"
              type="button"
              onClick={() => {
                const target = pendingRevoke
                setPendingRevoke(null)
                void revokeOne(target.token)
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
