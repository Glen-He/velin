import { Button } from '@velin/ui/Button.tsx'
import { passwordPolicy, passwordPolicyMessage } from '@velin/contracts/policy'
import {
  Check,
  ChevronLeft,
  Eye,
  EyeOff,
  Fingerprint,
  Hash,
  KeyRound,
  LockKeyhole,
} from 'lucide-react'
import { LoadingState, Spinner } from '../LoadingState'

import { EmailField, AuthField } from './AuthFields'
import { AuthorizationCodePage } from './AuthorizationCodePage'
import { GoogleMark } from './GoogleMark'

import { useSignInFlow } from './useSignInFlow'

export function SignInPage() {
  const {
    electronQuery,
    isElectronFlow,
    mode,
    email,
    setEmail,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    passwordError,
    setPasswordError,
    otp,
    setOtp,
    isEmailOtpSent,
    trustDevice,
    setTrustDevice,
    useBackupCode,
    setUseBackupCode,
    isSubmitting,
    message,
    error,
    authorizationCode,
    selectMode,
    submitPassword,
    submitEmailOtp,
    submitSignUp,
    submitEmailVerification,
    submitReset,
    submitTwoFactor,
    signInWithPasskey,
    signInWithGoogle,
    continueExistingSession,
    handleUseAnotherAccount,
    title,
    canUsePasskey,
    stepReady,
    session,
    isSessionPending,
  } = useSignInFlow()
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
          <Button
            variant="primary"
            size="regular"
            stretch
            type="button"
            disabled={isSubmitting}
            onClick={() => void continueExistingSession()}
          >
            {isSubmitting ? <Spinner /> : '继续使用此账号'}
          </Button>
          <button
            className="text-action account-switch-button"
            data-tone="neutral"
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleUseAnotherAccount()}
          >
            使用其他账号
          </button>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
    )
  }

  if (session && !isElectronFlow) {
    return <LoadingState label="正在前往账号…" />
  }

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
            {(mode === 'password' ||
              mode === 'email-otp' ||
              mode === 'sign-up') && (
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
                  disabled={isSubmitting}
                  onClick={() => selectMode('password')}
                >
                  登录
                </button>
                <button
                  className={mode === 'sign-up' ? 'is-active' : undefined}
                  type="button"
                  disabled={isSubmitting}
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
                noValidate
                onSubmit={mode === 'sign-up' ? submitSignUp : submitPassword}
              >
                <EmailField
                  disabled={isSubmitting}
                  email={email}
                  setEmail={setEmail}
                  withPasskey={mode === 'password'}
                />
                <AuthField
                  disabled={isSubmitting}
                  id="auth-password"
                  label={mode === 'sign-up' ? '设置密码' : '密码'}
                  icon={LockKeyhole}
                  error={mode === 'sign-up' ? passwordError : ''}
                  focusHint={
                    mode === 'sign-up' ? passwordPolicyMessage : '输入密码'
                  }
                  autoComplete={
                    mode === 'sign-up'
                      ? 'new-password'
                      : 'current-password webauthn'
                  }
                  minLength={
                    mode === 'sign-up' ? passwordPolicy.minimum : undefined
                  }
                  maxLength={
                    mode === 'sign-up' ? passwordPolicy.maximum * 2 : undefined
                  }
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
                        className="text-action"
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => selectMode('email-otp')}
                      >
                        使用邮箱验证码
                      </button>
                      <button
                        className="text-action"
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => selectMode('reset-request')}
                      >
                        忘记密码？
                      </button>
                    </div>
                  )}
                </div>
                <Button
                  variant="primary"
                  size="regular"
                  stretch
                  type="submit"
                  disabled={isSubmitting || !stepReady()}
                >
                  {isSubmitting ? (
                    <Spinner />
                  ) : mode === 'sign-up' ? (
                    '注册'
                  ) : (
                    '登录'
                  )}
                </Button>
              </form>
            )}

            {mode === 'email-otp' && (
              <form
                className="auth-form auth-stable-form"
                noValidate
                onSubmit={submitEmailOtp}
              >
                <EmailField
                  disabled={isSubmitting}
                  email={email}
                  setEmail={setEmail}
                  withPasskey
                />
                <div className="auth-field-slot">
                  {isEmailOtpSent && (
                    <AuthField
                      disabled={isSubmitting}
                      code
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
                    className="text-action"
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => selectMode('password')}
                  >
                    使用密码登录
                  </button>
                </div>
                <Button
                  variant="primary"
                  size="regular"
                  stretch
                  type="submit"
                  disabled={isSubmitting || !stepReady()}
                >
                  {isSubmitting ? (
                    <Spinner />
                  ) : isEmailOtpSent ? (
                    '验证并登录'
                  ) : (
                    '发送验证码'
                  )}
                </Button>
              </form>
            )}

            {mode === 'verify-email' && (
              <form
                className="auth-form"
                noValidate
                onSubmit={submitEmailVerification}
              >
                <AuthField
                  disabled={isSubmitting}
                  code
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
                <Button
                  variant="primary"
                  size="regular"
                  stretch
                  type="submit"
                  disabled={isSubmitting || !stepReady()}
                >
                  {isSubmitting ? <Spinner /> : '验证邮箱'}
                </Button>
              </form>
            )}

            {(mode === 'reset-request' || mode === 'reset-confirm') && (
              <form className="auth-form" noValidate onSubmit={submitReset}>
                <EmailField
                  disabled={isSubmitting}
                  email={email}
                  setEmail={setEmail}
                />
                {mode === 'reset-confirm' && (
                  <>
                    <AuthField
                      disabled={isSubmitting}
                      code
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
                    <AuthField
                      disabled={isSubmitting}
                      floating={false}
                      id="auth-reset-password"
                      label="新密码"
                      icon={LockKeyhole}
                      autoComplete="new-password"
                      minLength={passwordPolicy.minimum}
                      maxLength={passwordPolicy.maximum * 2}
                      error={passwordError}
                      focusHint={passwordPolicyMessage}
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
                <Button
                  variant="primary"
                  size="regular"
                  stretch
                  type="submit"
                  disabled={isSubmitting || !stepReady()}
                >
                  {isSubmitting ? (
                    <Spinner />
                  ) : mode === 'reset-request' ? (
                    '发送重置验证码'
                  ) : (
                    '更新密码'
                  )}
                </Button>
              </form>
            )}

            {mode === 'two-factor' && (
              <form className="auth-form" noValidate onSubmit={submitTwoFactor}>
                <AuthField
                  disabled={isSubmitting}
                  code
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
                <Button
                  variant="primary"
                  size="regular"
                  stretch
                  type="submit"
                  disabled={isSubmitting || !stepReady()}
                >
                  {isSubmitting ? <Spinner /> : '继续'}
                </Button>
                <button
                  className="text-action"
                  type="button"
                  disabled={isSubmitting}
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
              <p className="error-message" role="alert">
                {error}
              </p>
            ) : message ? (
              <p className="status-message">{message}</p>
            ) : null}
          </div>
          <footer className="auth-footer">
            {mode !== 'password' &&
            mode !== 'email-otp' &&
            mode !== 'sign-up' &&
            mode !== 'two-factor' ? (
              <button
                className="text-action"
                data-tone="neutral"
                type="button"
                onClick={() => selectMode('password')}
              >
                <ChevronLeft aria-hidden="true" /> 返回登录
              </button>
            ) : null}
          </footer>
        </section>
      </section>
    </main>
  )
}
