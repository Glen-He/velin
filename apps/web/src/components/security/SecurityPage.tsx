'use client'

import { ButtonLink, Button } from '@velin/ui/Button.tsx'
import { TruncatedText } from '@velin/ui/TruncatedText.tsx'
import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import { authClient } from '../../lib/auth/client'
import { LoadingState } from '../LoadingState'
import { useGatedActions } from './gated-actions'
import { usePasskeyList } from './usePasskeyList'
import type { DialogOperation } from './security-api'

// 总览页只按"用户心智"分两组：怎么登录、怎么保护账号。
type FeedbackScope = 'credentials' | 'protection'

type Feedback = {
  scope: FeedbackScope
  tone: 'ok' | 'error'
  text: string
}

function scopeOf(operation: DialogOperation): FeedbackScope {
  return operation === 'enableTwoFactor' || operation === 'disableTwoFactor'
    ? 'protection'
    : 'credentials'
}

function passkeyMeta(count: number | null) {
  if (count === null) {
    return '正在读取…'
  }

  return count === 0 ? '未添加' : `已添加 ${count} 个`
}

// 登录与安全：这一页只提供入口，验证和实际操作全部在卡片里完成；
// 具体凭据实例（每一个通行密钥）不在总览展开，进各自的二级管理页。
export function SecurityPage() {
  const { data: session, isPending, refetch } = authClient.useSession()
  const {
    passkeys,
    error: passkeyError,
    refresh: refreshPasskeys,
  } = usePasskeyList(session?.user.id ?? null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const { open, dialog, opening } = useGatedActions({
    userId: session?.user.id ?? null,
    email: session?.user.email ?? '',
    hasPasskey: (passkeys?.length ?? 0) > 0,
    hasTwoFactor: Boolean(session?.user.twoFactorEnabled),
    onOpened: () => setFeedback(null),
    onCompleted: (operation, message) => {
      void Promise.all([refetch(), refreshPasskeys()])
      setFeedback(
        message
          ? { scope: scopeOf(operation), tone: 'ok', text: message }
          : null,
      )
    },
  })

  if (isPending) {
    return <LoadingState label="正在读取账号安全状态…" />
  }

  if (!session) {
    return (
      <main className="auth-page">
        <section className="auth-content account-content">
          <h1>需要先登录</h1>
          <p>登录后才能管理通行密钥和双重认证。</p>
          <ButtonLink variant="primary" size="regular" stretch href="/sign-in">
            前往登录
          </ButtonLink>
        </section>
      </main>
    )
  }

  const hasTwoFactor = Boolean(session.user.twoFactorEnabled)

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
        <h1>登录与安全</h1>
      </header>

      <section className="panel-group">
        <h2 className="panel-group-title">登录凭据</h2>
        <div className="panel-card">
          <div className="panel-row">
            <div className="session-copy">
              <TruncatedText className="session-name">登录邮箱</TruncatedText>
              <TruncatedText className="session-meta">
                {session.user.email}
              </TruncatedText>
            </div>
            <Button
              variant="secondary"
              type="button"
              disabled={opening !== null}
              sizeLabel="修改"
              onClick={() => void open({ operation: 'changeEmail' })}
            >
              {opening?.operation === 'changeEmail' ? '读取中…' : '修改'}
            </Button>
          </div>

          <div className="panel-row">
            <div className="session-copy">
              <TruncatedText className="session-name">密码</TruncatedText>
              <TruncatedText className="session-meta">已设置</TruncatedText>
            </div>
            <Button
              variant="secondary"
              type="button"
              disabled={opening !== null}
              sizeLabel="修改"
              onClick={() => void open({ operation: 'changePassword' })}
            >
              {opening?.operation === 'changePassword' ? '读取中…' : '修改'}
            </Button>
          </div>

          <div className="panel-row">
            <div className="session-copy">
              <TruncatedText className="session-name">通行密钥</TruncatedText>
              <TruncatedText className="session-meta">
                {passkeyError
                  ? '读取失败'
                  : passkeyMeta(passkeys?.length ?? null)}
              </TruncatedText>
            </div>
            {passkeys && passkeys.length > 0 ? (
              <ButtonLink variant="secondary" href="/security/passkeys">
                管理
              </ButtonLink>
            ) : (
              <Button
                variant="secondary"
                type="button"
                disabled={opening !== null || passkeys === null}
                sizeLabel="添加"
                onClick={() => void open({ operation: 'addPasskey' })}
              >
                {opening?.operation === 'addPasskey' ? '读取中…' : '添加'}
              </Button>
            )}
          </div>
        </div>
        <SectionFeedback feedback={feedback} scope="credentials" />
      </section>

      <section className="panel-group">
        <h2 className="panel-group-title">账号保护</h2>
        <div className="panel-card">
          <div className="panel-row">
            <div className="session-copy">
              <div className="session-name">
                <TruncatedText>验证器动态码</TruncatedText>
                <span
                  className={`security-state${hasTwoFactor ? ' is-enabled' : ''}`}
                >
                  {hasTwoFactor ? '已开启' : '未开启'}
                </span>
              </div>
              <TruncatedText className="session-meta">
                {hasTwoFactor
                  ? '密码登录时需要再输入 6 位动态码。'
                  : '为密码登录增加第二层验证。'}
              </TruncatedText>
            </div>
            <Button
              variant="secondary"
              type="button"
              disabled={opening !== null}
              sizeLabel={hasTwoFactor ? '关闭' : '开启'}
              onClick={() =>
                void open({
                  operation: hasTwoFactor
                    ? 'disableTwoFactor'
                    : 'enableTwoFactor',
                })
              }
            >
              {opening?.operation ===
              (hasTwoFactor ? 'disableTwoFactor' : 'enableTwoFactor')
                ? '读取中…'
                : hasTwoFactor
                  ? '关闭'
                  : '开启'}
            </Button>
          </div>
        </div>
        <SectionFeedback feedback={feedback} scope="protection" />
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

function SectionFeedback({
  feedback,
  scope,
}: {
  feedback: Feedback | null
  scope: FeedbackScope
}) {
  if (!feedback || feedback.scope !== scope) {
    return null
  }

  return (
    <p
      className={
        feedback.tone === 'error'
          ? 'group-feedback error-message'
          : 'group-feedback status-message'
      }
      role={feedback.tone === 'error' ? 'alert' : undefined}
    >
      {feedback.text}
    </p>
  )
}
