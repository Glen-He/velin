import { ArrowRight, ChevronLeft, KeyRound, LoaderCircle } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@velin/ui/Button.tsx'
import type { FormEvent } from 'react'
import type { AuthFlow } from '@velin/contracts/auth-protocol'

type AuthViewProps = {
  errorMessage: string | null
  isOpeningBrowser: boolean
  noticeMessage?: string | null
  onAuthenticateCode: (code: string) => Promise<void>
  onClose: () => void
  onOpenAuthorizationPage: () => void
  onRegister: () => Promise<AuthFlow | null>
  onSignIn: () => Promise<AuthFlow | null>
}

function AuthView({
  errorMessage,
  isOpeningBrowser,
  noticeMessage,
  onAuthenticateCode,
  onClose,
  onOpenAuthorizationPage,
  onRegister,
  onSignIn,
}: AuthViewProps) {
  const submitting = useRef(false)
  const [mode, setMode] = useState<'choice' | 'authorization-code'>('choice')
  const [authorizationCode, setAuthorizationCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [isAuthenticatingCode, setIsAuthenticatingCode] = useState(false)

  async function handleManualCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = authorizationCode.trim()

    if (!code || submitting.current || isOpeningBrowser) {
      return
    }

    submitting.current = true
    setCodeError(null)
    setIsAuthenticatingCode(true)

    try {
      await onAuthenticateCode(code)
    } catch {
      setCodeError('授权码无效或已经过期，请重新获取。')
    } finally {
      submitting.current = false
      setIsAuthenticatingCode(false)
    }
  }

  const isBusy = isOpeningBrowser || isAuthenticatingCode
  const choiceFeedback = errorMessage ?? noticeMessage ?? ''
  const codeFeedback = codeError ?? errorMessage ?? ''

  async function openAuthenticationPage(
    authenticate: () => Promise<AuthFlow | null>,
  ) {
    const flow = await authenticate()
    if (flow === 'manual-code') {
      setMode('authorization-code')
    }
  }

  return (
    <main className="desktop-auth-view">
      <div className="window-titlebar">
        <div className="window-titlebar-drag-surface" aria-hidden="true" />
      </div>
      <section className="desktop-auth-shell">
        <div className="desktop-auth-wordmark">Velin</div>
        <div className="desktop-auth-flow-window">
          <div
            className={`desktop-auth-flow-track desktop-auth-heading-stage${
              mode === 'authorization-code' ? ' is-code' : ''
            }`}
          >
            <section
              className="desktop-auth-step"
              aria-hidden={mode !== 'choice'}
              inert={mode !== 'choice'}
            >
              <h1>开始使用</h1>
              <p
                className={`desktop-auth-feedback${
                  errorMessage ? ' is-error' : ''
                }`}
                aria-live="polite"
              >
                {choiceFeedback}
              </p>
            </section>

            <section
              className="desktop-auth-step"
              aria-hidden={mode !== 'authorization-code'}
              inert={mode !== 'authorization-code'}
            >
              <h1>输入授权码</h1>
              <div className="desktop-auth-feedback" aria-hidden="true" />
            </section>
          </div>
          <Button
            size="regular"
            stretch
            className={`desktop-auth-button desktop-auth-main-button no-drag${
              mode === 'authorization-code' ? ' is-code' : ''
            }`}
            type="button"
            aria-label={mode === 'choice' ? '登录' : '在浏览器中获取授权码'}
            disabled={isBusy}
            onClick={() => {
              if (mode === 'choice') {
                void openAuthenticationPage(onSignIn)
              } else {
                onOpenAuthorizationPage()
              }
            }}
          >
            {isOpeningBrowser ? (
              <LoaderCircle
                className="desktop-auth-spinner"
                aria-hidden="true"
              />
            ) : (
              <>
                <span
                  className="desktop-auth-main-label is-choice"
                  aria-hidden="true"
                >
                  登录
                </span>
                <span
                  className="desktop-auth-main-label is-code"
                  aria-hidden="true"
                >
                  在浏览器中获取授权码
                </span>
              </>
            )}
          </Button>
          <div
            className={`desktop-auth-flow-track desktop-auth-detail-stage${
              mode === 'authorization-code' ? ' is-code' : ''
            }`}
          >
            <section
              className="desktop-auth-step"
              aria-hidden={mode !== 'choice'}
              inert={mode !== 'choice'}
            >
              <Button
                variant="outline"
                size="regular"
                stretch
                className="desktop-auth-secondary-button no-drag"
                type="button"
                disabled={isBusy || mode !== 'choice'}
                onClick={() => void openAuthenticationPage(onRegister)}
              >
                注册
              </Button>
              <button
                className="text-action desktop-auth-code-link no-drag"
                data-tone="neutral"
                type="button"
                disabled={isBusy || mode !== 'choice'}
                onClick={() => setMode('authorization-code')}
              >
                使用一次性授权码
              </button>
            </section>
            <section
              className="desktop-auth-step"
              aria-hidden={mode !== 'authorization-code'}
              inert={mode !== 'authorization-code'}
            >
              <form
                className="desktop-auth-code-form no-drag"
                onSubmit={handleManualCodeSubmit}
              >
                <div className="desktop-auth-code-field">
                  <span className="desktop-auth-code-icon" aria-hidden="true">
                    <KeyRound />
                  </span>
                  <input
                    id="desktop-auth-code"
                    autoCapitalize="none"
                    autoComplete="one-time-code"
                    placeholder="一次性授权码"
                    aria-label="一次性授权码"
                    disabled={isBusy}
                    spellCheck={false}
                    value={authorizationCode}
                    onChange={(event) =>
                      setAuthorizationCode(event.target.value)
                    }
                  />
                  <button
                    type="submit"
                    aria-label="提交授权码"
                    disabled={
                      mode !== 'authorization-code' ||
                      !authorizationCode.trim() ||
                      isBusy
                    }
                  >
                    {isAuthenticatingCode ? (
                      <LoaderCircle
                        className="desktop-auth-spinner"
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowRight aria-hidden="true" />
                    )}
                  </button>
                </div>
                <p
                  className={`desktop-auth-code-feedback${
                    codeFeedback ? ' is-visible' : ''
                  }`}
                  aria-live="polite"
                >
                  {codeFeedback}
                </p>
              </form>
            </section>
          </div>
        </div>
        <button
          className="text-action desktop-auth-back-button no-drag"
          data-tone="neutral"
          type="button"
          disabled={isBusy}
          onClick={() => {
            if (mode === 'choice') {
              onClose()
            } else {
              setCodeError(null)
              setMode('choice')
            }
          }}
        >
          <ChevronLeft aria-hidden="true" />
          <span>返回</span>
        </button>
      </section>
    </main>
  )
}

export default AuthView
