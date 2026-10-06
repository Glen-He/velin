'use client'

import { Button } from '@velin/ui/Button.tsx'
import { TruncatedText } from '@velin/ui/TruncatedText.tsx'
import {
  ChevronLeft,
  Laptop,
  LogOut,
  Smartphone,
  Tablet,
  Terminal,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { authClient } from '../../lib/auth/client'
import {
  formatSessionActivity,
  formatSessionClient,
  normalizeSessionClient,
} from '@velin/contracts/session-client'
import type { SessionClientIcon } from '@velin/contracts/session-client'
import { useSessions } from './useSessions'
import { ConfirmationDialog } from '@velin/ui/ConfirmationDialog.tsx'
import type { WebSessionInfo } from './session-data'
import { LoadingState } from '../LoadingState'

const sessionClientIcons: Record<SessionClientIcon, LucideIcon> = {
  desktop: Laptop,
  phone: Smartphone,
  tablet: Tablet,
  terminal: Terminal,
}

// 登录设备独立页面：设备可能很多，列表随页面滚动而不挤占账号。
export function SessionsPage() {
  const { data: session, isPending } = authClient.useSession()
  const [confirmation, setConfirmation] = useState<{
    userId: string
    target: WebSessionInfo | 'others'
  } | null>(null)

  const currentToken =
    session &&
    typeof session === 'object' &&
    'session' in session &&
    typeof session.session?.token === 'string'
      ? session.session.token
      : null

  const { sessions, error, busy, pending, reload, revoke } = useSessions(
    session?.user.id ?? null,
    currentToken,
  )

  useEffect(() => {
    if (!isPending && !session) {
      window.location.replace('/sign-in')
    }
  }, [isPending, session])

  if (isPending || !session) return <LoadingState label="正在读取账号…" />

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
          <a
            className="text-action security-back-button"
            data-tone="neutral"
            href="/account"
          >
            <ChevronLeft aria-hidden="true" />
            账号
          </a>
        </div>
        <div className="security-header-row">
          <h1>登录设备</h1>
          <Button
            variant="danger"
            sizeLabel="退出其他设备"
            type="button"
            disabled={busy || !hasOtherSessions}
            onClick={() =>
              setConfirmation({ userId: session.user.id, target: 'others' })
            }
          >
            {pending === 'others' ? '退出中…' : '退出其他设备'}
          </Button>
        </div>
      </header>

      <section className="panel-group">
        {sortedSessions === null ? (
          <div className="panel-card">
            <div className="panel-row">
              <TruncatedText className="sessions-loading">
                {error ? '登录设备读取失败。' : '正在读取登录设备…'}
              </TruncatedText>
            </div>
          </div>
        ) : sortedSessions.length === 0 ? (
          <div className="panel-card">
            <div className="panel-row">
              <TruncatedText className="sessions-loading">
                当前没有登录记录。
              </TruncatedText>
            </div>
          </div>
        ) : (
          <div className="panel-card">
            {sortedSessions.map((item) => {
              const client = formatSessionClient(
                normalizeSessionClient({ userAgent: item.userAgent }),
              )
              const DeviceIcon = sessionClientIcons[client.icon]
              const activity = formatSessionActivity(item.updatedAt)

              return (
                <div className="panel-row" key={item.token}>
                  <span className="session-icon" aria-hidden="true">
                    <DeviceIcon />
                  </span>
                  <div className="session-copy">
                    <div className="session-name">
                      <TruncatedText>{client.label}</TruncatedText>
                      {item.isCurrent ? (
                        <span className="session-current-badge">当前设备</span>
                      ) : null}
                    </div>
                    {activity ? (
                      <TruncatedText className="session-meta">
                        {activity}
                      </TruncatedText>
                    ) : null}
                  </div>
                  {item.isCurrent ? null : (
                    <button
                      className="panel-icon-action"
                      data-tone="danger"
                      type="button"
                      aria-label="退出该设备"
                      disabled={busy}
                      onClick={() =>
                        setConfirmation({
                          userId: session.user.id,
                          target: item,
                        })
                      }
                    >
                      <LogOut aria-hidden="true" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {error ? (
          <div>
            <p className="error-message" role="alert">
              {error}
            </p>
            <Button
              variant="secondary"
              type="button"
              disabled={busy}
              onClick={() => void reload()}
            >
              重新读取
            </Button>
          </div>
        ) : null}
      </section>
      {confirmation?.userId === session.user.id ? (
        <ConfirmationDialog
          key={session.user.id}
          title={confirmation.target === 'others' ? '退出其他设备' : '退出设备'}
          confirmLabel={
            confirmation.target === 'others' ? '退出其他设备' : '退出设备'
          }
          pendingLabel="退出中…"
          onClose={() => setConfirmation(null)}
          onConfirm={() =>
            revoke(
              confirmation.target === 'others'
                ? null
                : confirmation.target.token,
            )
          }
        >
          {confirmation.target === 'others'
            ? '确认要退出其他所有设备吗？当前设备会保持登录，其他设备需要重新登录。'
            : `确认要退出「${formatSessionClient(normalizeSessionClient({ userAgent: confirmation.target.userAgent })).label}」吗？该设备需要重新登录。`}
        </ConfirmationDialog>
      ) : null}
    </main>
  )
}
