import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Fingerprint,
  Hash,
  KeyRound,
  LockKeyhole,
  Mail,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { FormEvent, InputHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { authClient } from './auth-client'
import { AccountPage } from './account/AccountPage'
import { SessionsPage } from './account/SessionsPage'
import { SecurityPage } from './security/SecurityPage'
import {
  errorMessage,
  isApplePlatform,
  newPasswordError,
} from './shared'
import { LoadingState, Spinner } from './shared-ui'

type AuthMode =
  | 'password'
  | 'email-otp'
  | 'sign-up'
  | 'verify-email'
  | 'reset-request'
  | 'reset-confirm'
  | 'two-factor'

type Capabilities = {
  google: boolean
  passkey: boolean
  emailOtp: boolean
  password: boolean
  twoFactor: boolean
  developmentEmailPreview: boolean
}

const fallbackCapabilities: Capabilities = {
  google: false,
  passkey: true,
  emailOtp: true,
  password: true,
  twoFactor: true,
  developmentEmailPreview: false,
}

function getElectronQuery() {
  return Object.fromEntries(
    new URLSearchParams(window.location.search).entries(),
  )
}

function isElectronAuthorization(query: Record<string, string>) {
  return Boolean(query.client_id && query.state && query.code_challenge)
}

function encodeElectronAuthorizationCode(identifier: string, state: string) {
  // The Electron client expects the transfer identifier and its PKCE state
  // together in a base64url encoded token when the user pastes a code.
  return btoa(JSON.stringify({ identifier, state }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function App() {
  const pathname = window.location.pathname

  if (pathname === '/security') {
    return <SecurityPage />
  }

  if (pathname === '/account/sessions') {
    return <SessionsPage />
  }

  if (pathname === '/account') {
    return <AccountPage />
  }

  return <SignInPage />
}

function SignInPage() {
  const electronQuery = useMemo(() => getElectronQuery(), [])
  const isElectronFlow = isElectronAuthorization(electronQuery)
  const {
    data: session,
    isPending: isSessionPending,
    refetch: refetchSession,
  } = authClient.useSession()
  const [mode, setMode] = useState<AuthMode>(
    electronQuery.mode === 'sign-up' ? 'sign-up' : 'password',
  )
  const [capabilities, setCapabilities] = useState(fallbackCapabilities)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [otp, setOtp] = useState('')
  const [isEmailOtpSent, setIsEmailOtpSent] = useState(false)
  const [trustDevice, setTrustDevice] = useState(true)
  const [useBackupCode, setUseBackupCode] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [authorizationCode, setAuthorizationCode] = useState<string | null>(null)
  const transferStartedRef = useRef(false)
  const conditionalPasskeyStartedRef = useRef(false)

  // 已有会话时直接进入账号中心；桌面端授权流程（isElectronFlow）仍停在当前页完成交接。
  useEffect(() => {
    if (session && !isElectronFlow) {
      window.location.replace('/account')
    }
  }, [session, isElectronFlow])

  useEffect(() => {
    void fetch('/api/auth/capabilities')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('无法读取认证能力。')
        }

        return (await response.json()) as Capabilities
      })
      .then(setCapabilities)
      .catch(() => {
        setCapabilities(fallbackCapabilities)
      })
  }, [])

  useEffect(() => {
    if (!isElectronFlow || electronQuery.flow === 'manual-code') {
      return
    }

    const timer = authClient.ensureElectronRedirect({ timeout: 5 * 60 * 1_000 })
    return () => clearTimeout(timer)
  }, [electronQuery.flow, isElectronFlow])

  useEffect(() => {
    if (
      conditionalPasskeyStartedRef.current ||
      session ||
      !capabilities.passkey ||
      !isApplePlatform() ||
      typeof PublicKeyCredential === 'undefined' ||
      typeof PublicKeyCredential.isConditionalMediationAvailable !== 'function'
    ) {
      return
    }

    conditionalPasskeyStartedRef.current = true

    void PublicKeyCredential.isConditionalMediationAvailable()
      .then((isAvailable) => {
        if (!isAvailable) {
          return
        }

        return authClient.signIn.passkey({
          autoFill: true,
          fetchOptions: { query: electronQuery },
        })
      })
      .catch(() => {
        // Conditional UI is opportunistic; the password form stays available.
      })
  }, [capabilities.passkey, electronQuery, session])

  function resetFeedback() {
    setError(null)
    setMessage(null)
  }

  function selectMode(nextMode: AuthMode) {
    const updateMode = () => {
      resetFeedback()
      setOtp('')
      setIsEmailOtpSent(false)
      setUseBackupCode(false)
      setPasswordError('')
      setMode(nextMode)
    }
    const transitionDocument = document as Document & {
      startViewTransition?: (update: () => void) => void
    }
    const shouldReduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    const isSharedFormSwitch =
      (mode === 'password' || mode === 'sign-up') &&
      (nextMode === 'password' || nextMode === 'sign-up')

    if (
      isSharedFormSwitch ||
      !transitionDocument.startViewTransition ||
      shouldReduceMotion
    ) {
      updateMode()
      return
    }

    const isReturning =
      nextMode === 'password' ||
      (nextMode === 'email-otp' && mode !== 'password')
    document.documentElement.dataset.authDirection = isReturning
      ? 'backward'
      : 'forward'
    transitionDocument.startViewTransition(() => {
      flushSync(updateMode)
    })
  }

  async function finishElectronAuthentication() {
    if (!isElectronFlow) {
      setMessage('登录成功。')
      return
    }

    if (transferStartedRef.current) {
      return
    }

    transferStartedRef.current = true
    const { data, error: transferError } = await authClient.electron.transferUser({
      fetchOptions: { query: electronQuery },
    })

    if (transferError) {
      transferStartedRef.current = false
      throw new Error(errorMessage(transferError))
    }

    if (
      !data ||
      !('electron_authorization_code' in data) ||
      typeof data.electron_authorization_code !== 'string'
    ) {
      transferStartedRef.current = false
      throw new Error('未取得授权码，请重新尝试。')
    }

    setAuthorizationCode(
      encodeElectronAuthorizationCode(
        data.electron_authorization_code,
        electronQuery.state,
      ),
    )
    setMessage(
      electronQuery.flow === 'manual-code'
        ? null
        : '登录成功，正在返回 Velin…',
    )
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    resetFeedback()
    setIsSubmitting(true)

    try {
      const result = await authClient.signIn.email({
        email,
        password,
        rememberMe: true,
        fetchOptions: { query: electronQuery },
      })

      if (result.error) {
        throw new Error(errorMessage(result.error))
      }

      if (
        result.data &&
        'twoFactorRedirect' in result.data &&
        result.data.twoFactorRedirect
      ) {
        selectMode('two-factor')
        setMessage('请输入验证器中的动态验证码。')
        return
      }

      await finishElectronAuthentication()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '登录失败。')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submitEmailOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    resetFeedback()
    setIsSubmitting(true)

    try {
      if (!isEmailOtpSent) {
        const { error: sendError } =
          await authClient.emailOtp.sendVerificationOtp({
            email,
            type: 'sign-in',
          })

        if (sendError) {
          throw new Error(errorMessage(sendError))
        }

        setIsEmailOtpSent(true)
        setMessage('验证码已发送，有效期 5 分钟。')
        return
      }

      const result = await authClient.signIn.emailOtp({
        email,
        otp,
        fetchOptions: { query: electronQuery },
      })

      if (result.error) {
        throw new Error(errorMessage(result.error))
      }

      await finishElectronAuthentication()
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : '验证码登录失败。',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submitSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    resetFeedback()

    const nextPasswordError = newPasswordError(password)
    setPasswordError(nextPasswordError)
    if (nextPasswordError) return

    setIsSubmitting(true)

    try {
      const { error: signUpError } = await authClient.$fetch('/sign-up/email', {
        method: 'POST',
        body: { email, password },
      })

      if (signUpError) {
        throw new Error(errorMessage(signUpError))
      }

      selectMode('verify-email')
      setMessage('账号已创建，请输入邮件中的验证码完成邮箱验证。')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '注册失败。')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submitEmailVerification(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()
    resetFeedback()
    setIsSubmitting(true)

    try {
      const { error: verificationError } = await authClient.emailOtp.verifyEmail({
        email,
        otp,
      })

      if (verificationError) {
        throw new Error(errorMessage(verificationError))
      }

      const signInResult = await authClient.signIn.email({
        email,
        password,
        rememberMe: true,
        fetchOptions: { query: electronQuery },
      })

      if (signInResult.error) {
        throw new Error(errorMessage(signInResult.error))
      }

      await finishElectronAuthentication()
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : '邮箱验证失败。',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    resetFeedback()

    if (mode === 'reset-confirm') {
      const nextPasswordError = newPasswordError(password)
      setPasswordError(nextPasswordError)
      if (nextPasswordError) return
    }

    setIsSubmitting(true)

    try {
      if (mode === 'reset-request') {
        const { error: sendError } =
          await authClient.emailOtp.sendVerificationOtp({
            email,
            type: 'forget-password',
          })

        if (sendError) {
          throw new Error(errorMessage(sendError))
        }

        selectMode('reset-confirm')
        setMessage('如果账号存在，重置验证码已发送。')
        return
      }

      const { error: resetError } = await authClient.emailOtp.resetPassword({
        email,
        otp,
        password,
      })

      if (resetError) {
        throw new Error(errorMessage(resetError))
      }

      selectMode('password')
      setOtp('')
      setPassword('')
      setMessage('密码已更新，请重新登录。')
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : '密码重置失败。',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submitTwoFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    resetFeedback()
    setIsSubmitting(true)

    try {
      const result = useBackupCode
        ? await authClient.twoFactor.verifyBackupCode({
            code: otp,
            trustDevice,
          })
        : await authClient.twoFactor.verifyTotp({
            code: otp,
            trustDevice,
          })

      if (result.error) {
        throw new Error(errorMessage(result.error))
      }

      await finishElectronAuthentication()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '验证失败。')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function signInWithPasskey() {
    resetFeedback()
    setIsSubmitting(true)

    try {
      const result = await authClient.signIn.passkey({
        fetchOptions: { query: electronQuery },
      })

      if (result?.error) {
        throw new Error(errorMessage(result.error))
      }

      await finishElectronAuthentication()
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : '通行密钥登录失败。',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function signInWithGoogle() {
    resetFeedback()

    if (!capabilities.google) {
      setError('本地环境尚未配置 Google OAuth 凭据。')
      return
    }

    setIsSubmitting(true)

    const { error: googleError } = await authClient.signIn.social({
      provider: 'google',
      callbackURL: `${window.location.origin}${window.location.pathname}${window.location.search}`,
      fetchOptions: { query: electronQuery },
    })

    if (googleError) {
      setError(errorMessage(googleError))
      setIsSubmitting(false)
    }
  }

  async function continueExistingSession() {
    resetFeedback()
    setIsSubmitting(true)

    try {
      await finishElectronAuthentication()
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : '无法返回 Velin。',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleUseAnotherAccount() {
    resetFeedback()
    setIsSubmitting(true)

    try {
      const result = await authClient.signOut()

      if (result.error) {
        throw new Error(errorMessage(result.error))
      }

      transferStartedRef.current = false
      await refetchSession()
      selectMode('password')
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : '无法切换账号。',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isSessionPending) {
    return <LoadingState label="正在连接 Velin…" />
  }

  if (authorizationCode) {
    return (
      <AuthorizationCodePage
        code={authorizationCode}
        isManualFlow={electronQuery.flow === 'manual-code'}
      />
    )
  }

  if (session && isElectronFlow) {
    return (
      <main className="auth-page">
        <section className="auth-content account-content">
          <div className="success-mark">
            <Check aria-hidden="true" />
          </div>
          <h1>继续登录 Velin</h1>
          <p>{session.user.email}</p>
          <button
            className="primary-button account-action-button"
            type="button"
            disabled={isSubmitting}
            onClick={() => void continueExistingSession()}
          >
            {isSubmitting ? <Spinner /> : '继续使用此账号'}
          </button>
          <button
            className="text-button account-switch-button"
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleUseAnotherAccount()}
          >
            使用其他账号
          </button>
          {error && <p className="error-message" role="alert">{error}</p>}
        </section>
      </main>
    )
  }

  if (session && !isElectronFlow) {
    return <LoadingState label="正在前往账号中心…" />
  }

  const title =
    mode === 'sign-up'
      ? '创建账号'
      : mode === 'verify-email'
        ? '验证邮箱'
        : mode === 'reset-request' || mode === 'reset-confirm'
          ? '重置密码'
          : mode === 'two-factor'
            ? '双重认证'
            : '欢迎回来'
  const canUsePasskey =
    capabilities.passkey && typeof PublicKeyCredential !== 'undefined'

  return (
    <main className="auth-page">
      <section className="auth-shell">
        <div className="auth-wordmark">Velin</div>
        <section className="auth-content">
        <header className="auth-header">
          <h1>{title}</h1>
          {mode === 'two-factor' ? <p>输入你的动态验证码</p> : null}
        </header>

        <div className="auth-methods-slot">
          {(mode === 'password' || mode === 'email-otp' || mode === 'sign-up') && (
            <div className="auth-methods" aria-label="账号操作">
              <span
                className={`auth-method-indicator${
                  mode === 'sign-up' ? ' is-sign-up' : ''
                }`}
                aria-hidden="true"
              />
              <button
                className={mode !== 'sign-up' ? 'is-active' : undefined}
                type="button"
                onClick={() => selectMode('password')}
              >
                登录
              </button>
              <button
                className={mode === 'sign-up' ? 'is-active' : undefined}
                type="button"
                onClick={() => selectMode('sign-up')}
              >
                注册
              </button>
            </div>
          )}
        </div>

        <div className="auth-form-stage">
          {(mode === 'password' || mode === 'sign-up') && (
            <form
              className="auth-form auth-stable-form"
              onSubmit={mode === 'sign-up' ? submitSignUp : submitPassword}
            >
              <EmailField
                email={email}
                setEmail={setEmail}
                withPasskey={mode === 'password'}
              />
              <FloatingAuthField
                id="auth-password"
                label={mode === 'sign-up' ? '设置密码' : '密码'}
                icon={LockKeyhole}
                error={mode === 'sign-up' ? passwordError : ''}
                focusHint={mode === 'sign-up' ? '8–32 位英文、数字或符号' : '输入密码'}
                autoComplete={
                  mode === 'sign-up'
                    ? 'new-password'
                    : 'current-password webauthn'
                }
                minLength={mode === 'sign-up' ? 8 : undefined}
                maxLength={mode === 'sign-up' ? 32 : undefined}
                required
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setPasswordError('')
                }}
                trailingAction={
                  <button
                    className="auth-field-action"
                    type="button"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    title={showPassword ? '隐藏密码' : '显示密码'}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? (
                      <EyeOff aria-hidden="true" />
                    ) : (
                      <Eye aria-hidden="true" />
                    )}
                  </button>
                }
              />
              <div className="auth-mode-slot">
                {mode === 'sign-up' ? (
                  <div className="auth-form-support" aria-hidden="true" />
                ) : (
                  <div className="auth-form-support">
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => selectMode('email-otp')}
                    >
                      使用邮箱验证码
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => selectMode('reset-request')}
                    >
                      忘记密码？
                    </button>
                  </div>
                )}
              </div>
              <button className="primary-button" disabled={isSubmitting}>
                {isSubmitting ? <Spinner /> : mode === 'sign-up' ? '注册' : '登录'}
              </button>
            </form>
          )}

          {mode === 'email-otp' && (
          <form className="auth-form auth-stable-form" onSubmit={submitEmailOtp}>
            <EmailField email={email} setEmail={setEmail} withPasskey />
            <div className="auth-field-slot">
              {isEmailOtpSent && (
                <FloatingAuthField
                  id="auth-email-otp"
                  label="验证码"
                  icon={Hash}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={otp}
                  onChange={(event) =>
                    setOtp(event.target.value.replace(/\D/g, ''))
                  }
                />
              )}
            </div>
            <div className="auth-mode-slot">
              <button
                className="text-button"
                type="button"
                onClick={() => selectMode('password')}
              >
                使用密码登录
              </button>
            </div>
            <button className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? (
                <Spinner />
              ) : isEmailOtpSent ? (
                '验证并登录'
              ) : (
                '发送验证码'
              )}
            </button>
          </form>
          )}

          {mode === 'verify-email' && (
          <form className="auth-form" onSubmit={submitEmailVerification}>
            <FloatingAuthField
              id="auth-verification-code"
              label="验证码"
              icon={Hash}
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              required
              value={otp}
              onChange={(event) =>
                setOtp(event.target.value.replace(/\D/g, ''))
              }
            />
            <p className="auth-field-hint">发送至 {email}</p>
            <button className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? <Spinner /> : '验证邮箱'}
            </button>
          </form>
          )}

          {(mode === 'reset-request' || mode === 'reset-confirm') && (
          <form className="auth-form" onSubmit={submitReset}>
            <EmailField email={email} setEmail={setEmail} />
            {mode === 'reset-confirm' && (
              <>
                <FloatingAuthField
                  id="auth-reset-code"
                  label="验证码"
                  icon={Hash}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={otp}
                  onChange={(event) =>
                    setOtp(event.target.value.replace(/\D/g, ''))
                  }
                />
                <FloatingAuthField
                  id="auth-reset-password"
                  label="新密码"
                  icon={LockKeyhole}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={32}
                  error={passwordError}
                  focusHint="8–32 位英文、数字或符号"
                  required
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setPasswordError('')
                  }}
                />
              </>
            )}
            <button className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? (
                <Spinner />
              ) : mode === 'reset-request' ? (
                '发送重置验证码'
              ) : (
                '更新密码'
              )}
            </button>
          </form>
          )}

          {mode === 'two-factor' && (
          <form className="auth-form" onSubmit={submitTwoFactor}>
            <FloatingAuthField
              id="auth-two-factor-code"
              label={useBackupCode ? '恢复码' : '动态验证码'}
              icon={useBackupCode ? KeyRound : Hash}
              autoComplete="one-time-code"
              inputMode={useBackupCode ? 'text' : 'numeric'}
              required
              value={otp}
              onChange={(event) => setOtp(event.target.value.trim())}
            />
            <label className="check-row">
              <input
                checked={trustDevice}
                type="checkbox"
                onChange={(event) => setTrustDevice(event.target.checked)}
              />
              <span>信任这台设备 30 天</span>
            </label>
            <button className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? <Spinner /> : '继续'}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setOtp('')
                setUseBackupCode((currentValue) => !currentValue)
              }}
            >
              {useBackupCode ? '使用验证器代码' : '使用恢复码'}
            </button>
          </form>
          )}

          {mode === 'password' && (
            <div className="auth-provider-actions" aria-label="其他登录方式">
              <button
                className="auth-provider-button"
                type="button"
                aria-label="使用 Google 登录"
                title="使用 Google 登录"
                disabled={isSubmitting}
                onClick={() => void signInWithGoogle()}
              >
                <GoogleMark />
              </button>
              <button
                className="auth-provider-button"
                type="button"
                aria-label="使用通行密钥登录"
                title="使用通行密钥登录"
                disabled={isSubmitting || !canUsePasskey}
                onClick={() => void signInWithPasskey()}
              >
                <Fingerprint aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        <div className="auth-feedback-slot" aria-live="polite">
          {error ? (
            <p className="error-message" role="alert">{error}</p>
          ) : message ? (
            <p className="status-message">{message}</p>
          ) : null}
        </div>
        <footer className="auth-footer">
          {mode !== 'password' &&
          mode !== 'email-otp' &&
          mode !== 'sign-up' &&
          mode !== 'two-factor' ? (
            <button type="button" onClick={() => selectMode('password')}>
              <ArrowLeft aria-hidden="true" /> 返回登录
            </button>
          ) : null}
        </footer>
        </section>
      </section>
    </main>
  )
}

function AuthorizationCodePage({
  code,
  isManualFlow,
}: {
  code: string
  isManualFlow: boolean
}) {
  const [isCopied, setIsCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  useEffect(() => {
    if (!isCopied) {
      return
    }

    // 与消息复制反馈一致：保留 1600ms（--motion-duration-copied）后恢复。
    const timer = window.setTimeout(() => setIsCopied(false), 1600)

    return () => window.clearTimeout(timer)
  }, [isCopied])

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code)
      setIsCopied(true)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-shell auth-code-result">
        <div className="auth-wordmark">Velin</div>
        <h1>一次性授权码</h1>
        <p>
          {isManualFlow
            ? '复制授权码，返回 Velin 粘贴。授权码在 5 分钟内有效。'
            : '若 Velin 没有自动打开，请复制授权码并在应用中粘贴。'}
        </p>
        <code className="auth-code-value">{code}</code>
        <button className="primary-button" type="button" onClick={() => void copyCode()}>
          {isCopied ? '已复制' : '复制授权码'}
        </button>
        <p className="auth-code-copy-feedback" role={copyError ? 'alert' : undefined}>
          {copyError ? '复制失败，请手动选中授权码。' : ''}
        </p>
      </section>
    </main>
  )
}

function EmailField({
  email,
  setEmail,
  withPasskey = false,
}: {
  email: string
  setEmail: (email: string) => void
  withPasskey?: boolean
}) {
  return (
    <FloatingAuthField
      id="auth-email"
      label="邮箱"
      icon={Mail}
      focusHint="name@example.com"
      autoCapitalize="none"
      autoComplete={withPasskey ? 'username webauthn' : 'email'}
      inputMode="email"
      required
      type="email"
      value={email}
      onChange={(event) => setEmail(event.target.value)}
    />
  )
}

type FloatingAuthFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'placeholder'
> & {
  code?: boolean
  error?: string
  focusHint?: string
  icon: LucideIcon
  label: string
  trailingAction?: ReactNode
}

function FloatingAuthField({
  code = false,
  error = '',
  focusHint = '',
  icon: Icon,
  id,
  label,
  trailingAction,
  ...inputProps
}: FloatingAuthFieldProps) {
  return (
    <div className="auth-field-row">
      <div className="auth-field">
        <span className="auth-field-icon" aria-hidden="true">
          <Icon />
        </span>
        <input
          {...inputProps}
          id={id}
          aria-invalid={error ? true : inputProps['aria-invalid']}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`auth-field-input${error ? ' is-error' : ''}${
            trailingAction ? ' has-trailing-action' : ''
          }${code ? ' is-code' : ''}`}
          placeholder={focusHint || ' '}
        />
        <label className="auth-floating-label" htmlFor={id}>
          {label}
        </label>
        {trailingAction}
      </div>
      <p
        id={`${id}-error`}
        className="auth-field-error"
        role={error ? 'alert' : undefined}
      >
        {error}
      </p>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg
      className="google-mark"
      viewBox="0 0 18 18"
      aria-hidden="true"
    >
      <path
        fill="#4285f4"
        d="M17.64 9.205c0-.64-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.909c1.703-1.568 2.683-3.878 2.683-6.615Z"
      />
      <path
        fill="#34a853"
        d="M9 18c2.43 0 4.468-.806 5.957-2.18l-2.91-2.259c-.805.54-1.835.86-3.047.86-2.344 0-4.328-1.584-5.037-3.71H.955v2.332A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#fbbc05"
        d="M3.963 10.71A5.42 5.42 0 0 1 3.68 9c0-.593.102-1.17.283-1.71V4.957H.955A9 9 0 0 0 0 9c0 1.452.348 2.827.955 4.043l3.008-2.332Z"
      />
      <path
        fill="#ea4335"
        d="M9 3.58c1.322 0 2.508.454 3.442 1.346l2.58-2.58C13.464.891 11.426 0 9 0A9 9 0 0 0 .955 4.957L3.963 7.29C4.672 5.164 6.656 3.58 9 3.58Z"
      />
    </svg>
  )
}

export default App
