'use client'

import { ButtonLink, Button } from '@velin/ui/Button.tsx'
import { TruncatedText } from '@velin/ui/TruncatedText.tsx'
import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import { authClient } from '../../lib/auth/client'
import { LoadingState } from '../LoadingState'
import { useGatedActions } from './gated-actions'
import { usePasskeyList } from './usePasskeyList'

function formatAddedAt(value: string) {
  if (!value) {
    return ''
  }

  return new Date(value).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// 通行密钥管理：总览页只给状态和入口，具体每一个凭据实例在这一层增删。
export function PasskeysPage() {
  const { data: session, isPending, refetch } = authClient.useSession()
  const {
    passkeys,
    error: passkeyError,
    refresh: refreshPasskeys,
  } = usePasskeyList(session?.user.id ?? null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const { open, dialog, opening } = useGatedActions({
    userId: session?.user.id ?? null,
    email: session?.user.email ?? '',
    hasPasskey: (passkeys?.length ?? 0) > 0,
    hasTwoFactor: Boolean(session?.user.twoFactorEnabled),
    onOpened: () => setFeedback(null),
    onCompleted: (_operation, message) => {
      void Promise.all([refetch(), refreshPasskeys()])
      setFeedback(message ?? null)
    },
  })

  if (isPending) {
    return <LoadingState label="正在读取通行密钥…" />
  }

  if (!session) {
    return (
      <main className="auth-page">
        <section className="auth-content account-content">
          <h1>需要先登录</h1>
          <p>登录后才能管理通行密钥。</p>
          <ButtonLink variant="primary" size="regular" stretch href="/sign-in">
            前往登录
          </ButtonLink>
        </section>
      </main>
    )
  }

  return (
    <main className="security-page">
      <header className="security-header">
        <div className="security-header-slot">
          <a
            className="text-action security-back-button"
            data-tone="neutral"
            href="/security"
          >
            <ChevronLeft aria-hidden="true" />
            登录与安全
          </a>
        </div>
        <div className="security-header-row">
          <h1>通行密钥</h1>
          <Button
            variant="secondary"
            type="button"
            disabled={passkeys === null || opening !== null}
            sizeLabel="添加通行密钥"
            onClick={() => void open({ operation: 'addPasskey' })}
          >
            {opening?.operation === 'addPasskey' ? '读取中…' : '添加通行密钥'}
          </Button>
        </div>
      </header>

      <section className="panel-group">
        {passkeys === null && !passkeyError ? (
          <div className="panel-card">
            <div className="panel-row">
              <TruncatedText className="sessions-loading">
                正在读取通行密钥…
              </TruncatedText>
            </div>
          </div>
        ) : passkeys === null ? null : passkeys.length === 0 ? (
          <div className="panel-card">
            <div className="panel-row">
              <TruncatedText className="sessions-loading">
                还没有添加通行密钥。使用设备解锁或安全密钥即可登录，无需输入密码。
              </TruncatedText>
            </div>
          </div>
        ) : (
          <div className="panel-card">
            {passkeys.map((passkey) => (
              <div className="panel-row" key={passkey.id}>
                <div className="session-copy">
                  <TruncatedText className="session-name">
                    {passkey.name || '通行密钥'}
                  </TruncatedText>
                  {formatAddedAt(passkey.createdAt) ? (
                    <TruncatedText className="session-meta">
                      {`添加于 ${formatAddedAt(passkey.createdAt)}`}
                    </TruncatedText>
                  ) : null}
                </div>
                <Button
                  variant="danger"
                  disabled={opening !== null}
                  sizeLabel="删除"
                  type="button"
                  onClick={() =>
                    void open({
                      operation: 'removePasskey',
                      passkeyId: passkey.id,
                    })
                  }
                >
                  删除
                </Button>
              </div>
            ))}
          </div>
        )}
        {feedback ? (
          <p className="group-feedback status-message">{feedback}</p>
        ) : null}
      </section>

      {passkeyError ? (
        <p className="error-message" role="alert">
          {passkeyError}{' '}
          <button
            className="text-action"
            type="button"
            onClick={() => void refreshPasskeys()}
          >
            重试
          </button>
        </p>
      ) : null}
      {dialog}
    </main>
  )
}
