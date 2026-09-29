import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import QRCode from 'react-qr-code'
import { authClient } from '../auth-client'
import {
  errorMessage,
  isApplePlatform,
  newPasswordError,
  normalizeSessionDate,
  useArmConfirm,
} from '../shared'
import { LoadingState, Spinner } from '../shared-ui'

type TwoFactorEnrollment = {
  totpURI: string
  backupCodes: string[]
}

type PasskeyInfo = {
  id: string
  name: string | null
  createdAt: string
}

// 登录与安全：通行密钥、双重认证与密码。视觉跟随桌面端设置页，
// 仅使用普通圆角（浏览器端不用连续曲率）。
export function SecurityPage() {
  const { data: session, isPending, refetch } = authClient.useSession()
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [enrollment, setEnrollment] = useState<TwoFactorEnrollment | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [passkeys, setPasskeys] = useState<PasskeyInfo[] | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const { armed, arm } = useArmConfirm()

  useEffect(() => {
    let active = true

    authClient
      .passkey.listUserPasskeys()
      .then((result) => {
        if (!active) {
          return
        }

        const rows: PasskeyInfo[] = []

        for (const item of result.data ?? []) {
          if (typeof item?.id !== 'string') {
            continue
          }

          rows.push({
            id: item.id,
            name: typeof item.name === 'string' ? item.name : null,
            createdAt: normalizeSessionDate(item.createdAt),
          })
        }

        setPasskeys(rows)
      })
      .catch(() => {
        if (active) {
          setPasskeys([])
        }
      })

    return () => {
      active = false
    }
  }, [message])

  async function enableTwoFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setIsSubmitting(true)

    try {
      const result = await authClient.twoFactor.enable({
        password,
        method: 'totp',
        issuer: 'Velin',
      })

      if (result.error) {
        throw new Error(errorMessage(result.error))
      }

      if (!result.data || result.data.method !== 'totp') {
        throw new Error('未能创建 TOTP 验证器。')
      }

      setEnrollment({
        totpURI: result.data.totpURI,
        backupCodes: result.data.backupCodes,
      })
      setMessage('请扫描二维码并输入验证器显示的代码。')
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : '无法启用双重认证。',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function verifyEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: verificationCode,
        trustDevice: true,
      })

      if (result.error) {
        throw new Error(errorMessage(result.error))
      }

      await refetch()
      setMessage('双重认证已启用。请将恢复码保存在密码管理器中。')
      setVerificationCode('')
      setPassword('')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '验证码无效。')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function disableTwoFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setIsSubmitting(true)

    try {
      const result = await authClient.twoFactor.disable({ password })

      if (result.error) {
        throw new Error(errorMessage(result.error))
      }

      await refetch()
      setEnrollment(null)
      setPassword('')
      setMessage('双重认证已关闭。')
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : '无法关闭双重认证。',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function addPasskey() {
    setError(null)
    setMessage(null)
    setIsSubmitting(true)

    try {
      const result = await authClient.passkey.addPasskey({
        name: isApplePlatform() ? 'Apple 设备' : '通行密钥',
      })

      if (result?.error) {
        throw new Error(errorMessage(result.error))
      }

      const listResult = await authClient.passkey.listUserPasskeys()
      const rows: PasskeyInfo[] = []

      for (const item of listResult.data ?? []) {
        if (typeof item?.id !== 'string') {
          continue
        }

        rows.push({
          id: item.id,
          name: typeof item.name === 'string' ? item.name : null,
          createdAt: normalizeSessionDate(item.createdAt),
        })
      }

      setPasskeys(rows)
      setMessage('通行密钥已添加，下次可直接使用设备解锁登录。')
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : '无法添加通行密钥。',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function removePasskey(target: PasskeyInfo) {
    setError(null)
    setMessage(null)
    setIsSubmitting(true)

    try {
      const result = await authClient.passkey.deletePasskey({ id: target.id })

      if (result?.error) {
        throw new Error(errorMessage(result.error))
      }

      setPasskeys((current) =>
        current ? current.filter((item) => item.id !== target.id) : current,
      )
      setMessage('通行密钥已删除。')
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : '无法删除通行密钥。',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致。')
      return
    }

    const policyError = newPasswordError(newPassword)

    if (policyError) {
      setError(policyError)
      return
    }

    setIsSubmitting(true)

    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: false,
      })

      if (result.error) {
        throw new Error(errorMessage(result.error))
      }

      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMessage('密码已更新。')
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : '密码修改失败，请稍后重试。',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isPending) {
    return <LoadingState label="正在读取账号安全状态…" />
  }

  if (!session) {
    return (
      <main className="auth-page">
        <section className="auth-content account-content">
          <h1>需要先登录</h1>
          <p>登录后才能管理通行密钥和双重认证。</p>
          <a className="primary-button link-button" href="/sign-in">
            前往登录
          </a>
        </section>
      </main>
    )
  }

  const hasTwoFactor = Boolean(session.user.twoFactorEnabled)

  return (
    <main className="security-page">
      <header className="security-header">
        <div className="security-header-slot">
          <a className="security-back-button" href="/account">
            <ArrowLeft aria-hidden="true" />
            账号中心
          </a>
        </div>
        <h1>登录与安全</h1>
        <p>{session.user.email}</p>
      </header>

      <section className="account-section">
        <h2 className="account-section-title">登录方式</h2>
        <div className="session-card">
          <div className="session-copy">
            <div className="session-name">通行密钥</div>
            <div className="session-meta">使用设备解锁或安全密钥登录，无需输入密码。</div>
          </div>
          <button
            className="security-action is-narrow"
            disabled={isSubmitting}
            onClick={() => void addPasskey()}
          >
            {isSubmitting ? <Spinner /> : '添加'}
          </button>
        </div>

        {passkeys !== null && passkeys.length > 0 ? (
          <div className="session-group">
            {passkeys.map((passkey) => (
              <div className="session-card" key={passkey.id}>
                <div className="session-copy">
                  <div className="session-name">
                    {passkey.name || '通行密钥'}
                  </div>
                  {passkey.createdAt ? (
                    <div className="session-meta">
                      添加于{' '}
                      {new Date(passkey.createdAt).toLocaleDateString('zh-CN', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </div>
                  ) : null}
                </div>
                <button
                  className={`passkey-remove${armed === passkey.id ? ' is-armed' : ''}`}
                  type="button"
                  onClick={() => {
                    if (armed === passkey.id) {
                      void removePasskey(passkey)
                    } else {
                      arm(passkey.id)
                    }
                  }}
                >
                  {armed === passkey.id ? '确认' : '删除'}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="account-section">
        <h2 className="account-section-title">两步验证</h2>
        <section className="security-card security-card-stacked">
          <div className="security-card-copy">
            <div>
              <div className="security-card-heading">
                <h2>双重认证</h2>
                <span
                  className={`security-state${hasTwoFactor ? ' is-enabled' : ''}`}
                >
                  {hasTwoFactor ? '已开启' : '未开启'}
                </span>
              </div>
              <p>
                {hasTwoFactor
                  ? '密码登录时需要验证器动态码。'
                  : '为密码登录增加验证器动态码保护。'}
              </p>
            </div>
          </div>

          {!hasTwoFactor && !enrollment ? (
            <form className="inline-security-form" onSubmit={enableTwoFactor}>
              <label>
                <span>确认当前密码</span>
                <input
                  autoComplete="current-password"
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button className="security-action is-narrow" disabled={isSubmitting}>
                {isSubmitting ? <Spinner /> : '设置'}
              </button>
            </form>
          ) : null}

          {enrollment ? (
            <div className="enrollment">
              {!hasTwoFactor ? (
                <>
                  <div className="qr-code">
                    <QRCode size={168} value={enrollment.totpURI} />
                  </div>
                  <form
                    className="inline-security-form"
                    onSubmit={verifyEnrollment}
                  >
                    <label>
                      <span>6 位动态验证码</span>
                      <input
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={6}
                        required
                        value={verificationCode}
                        onChange={(event) =>
                          setVerificationCode(event.target.value.replace(/\D/g, ''))
                        }
                      />
                    </label>
                    <button className="security-action is-narrow" disabled={isSubmitting}>
                      {isSubmitting ? <Spinner /> : '启用'}
                    </button>
                  </form>
                </>
              ) : null}
              <div className="backup-codes">
                <strong>恢复码</strong>
                <p>每个恢复码只能使用一次，请立即保存。</p>
                <code>{enrollment.backupCodes.join('\n')}</code>
              </div>
            </div>
          ) : null}

          {hasTwoFactor ? (
            <form className="inline-security-form" onSubmit={disableTwoFactor}>
              <label>
                <span>确认当前密码</span>
                <input
                  autoComplete="current-password"
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button
                className="security-action danger-button is-narrow"
                disabled={isSubmitting}
              >
                {isSubmitting ? <Spinner /> : '关闭'}
              </button>
            </form>
          ) : null}
        </section>
      </section>

      <section className="account-section">
        <h2 className="account-section-title">密码</h2>
        <section className="security-card security-card-stacked">
          <div className="security-card-copy">
            <div>
              <h2>修改密码</h2>
              <p>新密码需为 8–32 位英文字母、数字或符号。</p>
            </div>
          </div>
          <form className="password-form" onSubmit={changePassword}>
            <label>
              <span>当前密码</span>
              <input
                autoComplete="current-password"
                required
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              <span>新密码</span>
              <input
                autoComplete="new-password"
                required
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              <span>确认新密码</span>
              <input
                autoComplete="new-password"
                required
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            <div className="password-form-footer">
              <p className="auth-field-hint">{''}</p>
              <button className="security-action" disabled={isSubmitting}>
                {isSubmitting ? <Spinner /> : '修改密码'}
              </button>
            </div>
          </form>
        </section>
      </section>

      {message ? <p className="status-message">{message}</p> : null}
      {error ? <p className="error-message" role="alert">{error}</p> : null}
    </main>
  )
}
