import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import { authClient } from '../auth-client'
import { LoadingState } from '../shared-ui'
import { useGatedActions } from './gated-actions'
import { usePasskeyList } from './passkey-list'

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
  } = usePasskeyList()
  const [feedback, setFeedback] = useState<string | null>(null)

  const { open, dialog } = useGatedActions({
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
          <a className="primary-button link-button" href="/sign-in">
            前往登录
          </a>
        </section>
      </main>
    )
  }

  return (
    <main className="security-page">
      <header className="security-header">
        <div className="security-header-slot">
          <a className="security-back-button" href="/security">
            <ChevronLeft aria-hidden="true" />
            登录与安全
          </a>
        </div>
        <div className="security-header-row">
          <h1>通行密钥</h1>
          <button
            className="security-action is-wide"
            type="button"
            disabled={passkeys === null}
            onClick={() => void open({ operation: 'addPasskey' })}
          >
            添加通行密钥
          </button>
        </div>
      </header>

      <section className="account-section">
        {passkeys === null && !passkeyError ? (
          <div className="session-group">
            <div className="session-card">
              <p className="sessions-loading">正在读取通行密钥…</p>
            </div>
          </div>
        ) : passkeys === null ? null : passkeys.length === 0 ? (
          <div className="session-group">
            <div className="session-card">
              <p className="sessions-loading">
                还没有添加通行密钥。使用设备解锁或安全密钥即可登录，无需输入密码。
              </p>
            </div>
          </div>
        ) : (
          <div className="session-group">
            {passkeys.map((passkey) => (
              <div className="session-card" key={passkey.id}>
                <div className="session-copy">
                  <div className="session-name">
                    {passkey.name || '通行密钥'}
                  </div>
                  {formatAddedAt(passkey.createdAt) ? (
                    <div className="session-meta">
                      添加于 {formatAddedAt(passkey.createdAt)}
                    </div>
                  ) : null}
                </div>
                <button
                  className="passkey-remove"
                  type="button"
                  onClick={() =>
                    void open({
                      operation: 'removePasskey',
                      passkeyId: passkey.id,
                    })
                  }
                >
                  删除
                </button>
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
            className="text-button"
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
