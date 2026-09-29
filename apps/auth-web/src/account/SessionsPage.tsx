import { ArrowLeft, Laptop, Smartphone, Tablet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { authClient } from '../auth-client'
import {
  describeDevice,
  errorMessage,
  formatDeviceLabel,
  formatSessionActivity,
  normalizeSessions,
  useArmConfirm,
} from '../shared'
import { LoadingState } from '../shared-ui'

type WebSession = ReturnType<typeof normalizeSessions>[number]

// 登录设备独立页面：设备可能很多，列表随页面滚动而不挤占账号中心。
export function SessionsPage() {
  const { data: session, isPending } = authClient.useSession()
  const [sessions, setSessions] = useState<WebSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { armed, arm } = useArmConfirm()

  const currentToken =
    session &&
    typeof session === 'object' &&
    'session' in session &&
    typeof session.session?.token === 'string'
      ? session.session.token
      : null

  useEffect(() => {
    if (!isPending && !session) {
      window.location.replace('/sign-in')
    }
  }, [isPending, session])

  useEffect(() => {
    let active = true

    authClient
      .listSessions()
      .then((result) => {
        if (active) {
          setSessions(normalizeSessions(result.data, currentToken))
        }
      })
      .catch(() => {
        if (active) {
          setError('读取登录设备失败，请稍后重试。')
        }
      })

    return () => {
      active = false
    }
    // currentToken 在会话加载完成前为 null，会话就绪后重新拉取一次。
  }, [currentToken])

  if (isPending || !session) {
    return <LoadingState label="正在读取账号…" />
  }

  async function reloadSessions() {
    try {
      const result = await authClient.listSessions()

      setSessions(normalizeSessions(result.data, currentToken))
    } catch {
      setError('读取登录设备失败，请稍后重试。')
    }
  }

  async function revokeSession(target: WebSession) {
    setError(null)
    try {
      const result = await authClient.revokeSession({ token: target.token })

      if (result.error) {
        throw new Error(errorMessage(result.error))
      }

      await reloadSessions()
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : '退出该设备失败，请稍后重试。',
      )
    }
  }

  async function revokeOtherSessions() {
    setError(null)
    try {
      const result = await authClient.revokeSessions()

      if (result.error) {
        throw new Error(errorMessage(result.error))
      }

      await reloadSessions()
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : '退出其他设备失败，请稍后重试。',
      )
    }
  }

  const sortedSessions = sessions
    ? [...sessions].sort((a, b) => {
        if (a.isCurrent !== b.isCurrent) {
          return a.isCurrent ? -1 : 1
        }

        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      })
    : null

  const hasOtherSessions =
    sortedSessions !== null && sortedSessions.some((item) => !item.isCurrent)

  return (
    <main className="security-page">
      <header className="security-header">
        <div className="security-header-slot">
          <a className="security-back-button" href="/account">
            <ArrowLeft aria-hidden="true" />
            账号中心
          </a>
        </div>
        <div className="security-header-row">
          <h1>登录设备</h1>
          <button
            className={`security-action danger-button is-wide${armed === 'others' ? ' is-armed' : ''}`}
            type="button"
            disabled={!hasOtherSessions}
            onClick={() => {
              if (armed === 'others') {
                void revokeOtherSessions()
              } else {
                arm('others')
              }
            }}
          >
            {armed === 'others' ? '确认' : '退出其他设备'}
          </button>
        </div>
      </header>

      <section className="account-section">
        {sortedSessions === null ? (
          <div className="session-group">
            <div className="session-card">
              <p className="sessions-loading">正在读取登录设备…</p>
            </div>
          </div>
        ) : sortedSessions.length === 0 ? (
          <div className="session-group">
            <div className="session-card">
              <p className="sessions-loading">当前没有登录记录。</p>
            </div>
          </div>
        ) : (
          <div className="session-group">
            {sortedSessions.map((item) => {
              const description = describeDevice(item.userAgent)
              const DeviceIcon = deviceIcon(description.platform)
              const activity = formatSessionActivity(item.updatedAt)
              const armKey = `revoke:${item.token}`

              return (
                <div className="session-card" key={item.token}>
                  <span className="session-icon" aria-hidden="true">
                    <DeviceIcon />
                  </span>
                  <div className="session-copy">
                    <div className="session-name">
                      {formatDeviceLabel(description)}
                      {item.isCurrent ? (
                        <span className="session-current-badge">当前设备</span>
                      ) : null}
                    </div>
                    {activity ? (
                      <div className="session-meta">{activity}</div>
                    ) : null}
                  </div>
                  {item.isCurrent ? null : (
                    <button
                      className={`session-remove${armed === armKey ? ' is-armed' : ''}`}
                      type="button"
                      onClick={() => {
                        if (armed === armKey) {
                          void revokeSession(item)
                        } else {
                          arm(armKey)
                        }
                      }}
                    >
                      {armed === armKey ? '确认' : '退出'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {error ? (
          <p className="error-message" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  )
}

function deviceIcon(platform: string): LucideIcon {
  if (platform === 'iPhone' || platform === 'Android') {
    return Smartphone
  }

  if (platform === 'iPad') {
    return Tablet
  }

  return Laptop
}
