import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { authClient } from '../auth-client'
import { authenticatePasskey } from './passkey'
import { createAuthActionRunner } from './auth-action'
import type { AuthAction } from './auth-action'
import { z } from 'zod'
import { newPasswordError } from '@velin/contracts/policy'

type AuthMode =
  | 'password'
  | 'email-otp'
  | 'sign-up'
  | 'verify-email'
  | 'reset-request'
  | 'reset-confirm'
  | 'two-factor'

const capabilitiesSchema = z.object({
  google: z.boolean(),
  passkey: z.boolean(),
})
type Capabilities = z.infer<typeof capabilitiesSchema>

const fallbackCapabilities: Capabilities = {
  google: false,
  passkey: true,
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
  // 用户粘贴的授权码需同时包含 Electron 的 transfer 标识和 PKCE 状态，
  // 按协议编码为 base64url token。
  return btoa(JSON.stringify({ identifier, state }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function useSignInFlow() {
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
  const [authorizationCode, setAuthorizationCode] = useState<string | null>(
    null,
  )
  const conditionalRequest = useRef<AbortController | null>(null)
  const [actions] = useState(() =>
    createAuthActionRunner({
      onPending(pending) {
        if (pending) conditionalRequest.current?.abort()
        setIsSubmitting(pending)
      },
      onError: setError,
    }),
  )
  useEffect(() => {
    actions.activate()
    return actions.deactivate
  }, [actions])

  // 已有会话时直接进入账号；桌面端授权流程（isElectronFlow）仍停在当前页完成交接。
  useEffect(() => {
    if (session && !isElectronFlow) {
      window.location.replace('/account')
    }
  }, [session, isElectronFlow])

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/auth/capabilities', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('无法读取认证能力。')
        return capabilitiesSchema.parse(await response.json())
      })
      .then((value) => {
        if (!controller.signal.aborted) setCapabilities(value)
      })
      .catch(() => {
        if (!controller.signal.aborted) setCapabilities(fallbackCapabilities)
      })
    return () => controller.abort()
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
      session ||
      isSubmitting ||
      !capabilities.passkey ||
      mode !== 'password' ||
      typeof PublicKeyCredential === 'undefined' ||
      typeof PublicKeyCredential.isConditionalMediationAvailable !== 'function'
    )
      return
    const controller = new AbortController()
    conditionalRequest.current = controller
    void PublicKeyCredential.isConditionalMediationAvailable()
      .then(async (available) => {
        if (available && !controller.signal.aborted) {
          await authenticatePasskey({
            mediation: 'conditional',
            signal: controller.signal,
            query: electronQuery,
          })
          if (!controller.signal.aborted) await refetchSession()
        }
      })
      .catch(() => {
        /* 条件自动填充失败时，仍保留显式登录入口。 */
      })
    return () => {
      controller.abort()
      if (conditionalRequest.current === controller)
        conditionalRequest.current = null
    }
  }, [
    capabilities.passkey,
    electronQuery,
    isSubmitting,
    mode,
    refetchSession,
    session,
  ])

  function resetFeedback() {
    setError(null)
    setMessage(null)
  }

  function selectMode(nextMode: AuthMode) {
    if (!actions.isPending()) changeMode(nextMode)
  }

  function changeMode(nextMode: AuthMode) {
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

  async function finishElectronAuthentication(action: AuthAction) {
    if (!isElectronFlow) {
      setMessage('登录成功。')
      return
    }
    const data = await action.result(
      authClient.electron.transferUser({
        fetchOptions: { query: electronQuery, signal: action.signal },
      }),
    )
    if (
      !data ||
      !('electron_authorization_code' in data) ||
      typeof data.electron_authorization_code !== 'string'
    )
      throw new Error('未取得授权码，请重新尝试。')
    setAuthorizationCode(
      encodeElectronAuthorizationCode(
        data.electron_authorization_code,
        electronQuery.state,
      ),
    )
    setMessage(
      electronQuery.flow === 'manual-code' ? null : '登录成功，正在返回 Velin…',
    )
  }

  function runAction(
    operation: (action: AuthAction) => Promise<void>,
    fallback: string,
  ) {
    if (actions.isPending()) return Promise.resolve()
    resetFeedback()
    return actions.run(operation, fallback)
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    return runAction(async (action) => {
      const data = await action.result(
        authClient.signIn.email({
          email,
          password,
          rememberMe: true,
          fetchOptions: { query: electronQuery, signal: action.signal },
        }),
      )
      if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
        changeMode('two-factor')
        setMessage('请输入验证器中的动态验证码。')
        return
      }
      await finishElectronAuthentication(action)
    }, '登录失败，请稍后重试。')
  }

  function submitEmailOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    return runAction(async (action) => {
      if (!isEmailOtpSent) {
        await action.result(
          authClient.emailOtp.sendVerificationOtp({
            email,
            type: 'sign-in',
            fetchOptions: { signal: action.signal },
          }),
        )
        setIsEmailOtpSent(true)
        setMessage('验证码已发送，有效期 5 分钟。')
        return
      }
      await action.result(
        authClient.signIn.emailOtp({
          email,
          otp,
          fetchOptions: { query: electronQuery, signal: action.signal },
        }),
      )
      await finishElectronAuthentication(action)
    }, '验证码登录失败，请稍后重试。')
  }

  function validatePassword() {
    const nextError = newPasswordError(password)
    setPasswordError(nextError)
    return !nextError
  }

  function submitSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (actions.isPending() || !validatePassword()) return
    return runAction(async (action) => {
      await action.result(
        authClient.$fetch('/sign-up/email', {
          method: 'POST',
          body: { email, password },
          signal: action.signal,
        }),
      )
      changeMode('verify-email')
      setMessage('账号已创建，请输入邮件中的验证码完成邮箱验证。')
    }, '注册失败，请稍后重试。')
  }

  function submitEmailVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    return runAction(async (action) => {
      await action.result(
        authClient.emailOtp.verifyEmail({
          email,
          otp,
          fetchOptions: { signal: action.signal },
        }),
      )
      const data = await action.result(
        authClient.signIn.email({
          email,
          password,
          rememberMe: true,
          fetchOptions: { query: electronQuery, signal: action.signal },
        }),
      )
      if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
        changeMode('two-factor')
        return
      }
      await finishElectronAuthentication(action)
    }, '邮箱验证失败，请稍后重试。')
  }

  function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      actions.isPending() ||
      (mode === 'reset-confirm' && !validatePassword())
    )
      return
    return runAction(async (action) => {
      if (mode === 'reset-request') {
        await action.result(
          authClient.emailOtp.sendVerificationOtp({
            email,
            type: 'forget-password',
            fetchOptions: { signal: action.signal },
          }),
        )
        changeMode('reset-confirm')
        setMessage('如果账号存在，重置验证码已发送。')
        return
      }
      await action.result(
        authClient.emailOtp.resetPassword({
          email,
          otp,
          password,
          fetchOptions: { signal: action.signal },
        }),
      )
      changeMode('password')
      setPassword('')
      setMessage('密码已更新，请重新登录。')
    }, '密码重置失败，请稍后重试。')
  }

  function submitTwoFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    return runAction(async (action) => {
      const options = {
        code: otp,
        trustDevice,
        fetchOptions: { signal: action.signal },
      }
      await action.result(
        useBackupCode
          ? authClient.twoFactor.verifyBackupCode(options)
          : authClient.twoFactor.verifyTotp(options),
      )
      await finishElectronAuthentication(action)
    }, '验证失败，请稍后重试。')
  }

  function signInWithPasskey() {
    return runAction(async (action) => {
      await action.wait(
        authenticatePasskey({ query: electronQuery, signal: action.signal }),
      )
      await finishElectronAuthentication(action)
    }, '通行密钥登录失败，请稍后重试。')
  }

  function signInWithGoogle() {
    return runAction(async (action) => {
      if (!capabilities.google)
        throw new Error('本地环境尚未配置 Google OAuth 凭据。')
      await action.result(
        authClient.signIn.social({
          provider: 'google',
          callbackURL: window.location.href,
          fetchOptions: { query: electronQuery, signal: action.signal },
        }),
      )
    }, '无法发起 Google 登录，请稍后重试。')
  }

  function continueExistingSession() {
    return runAction(finishElectronAuthentication, '无法返回 Velin，请重试。')
  }

  function handleUseAnotherAccount() {
    return runAction(async (action) => {
      await action.result(
        authClient.signOut({ fetchOptions: { signal: action.signal } }),
      )
      await action.wait(refetchSession())
      changeMode('password')
    }, '无法切换账号，请稍后重试。')
  }

  function changeEmail(value: string) {
    if (actions.isPending()) return
    setEmail(value)
    setOtp('')
    setIsEmailOtpSent(false)
    resetFeedback()
    if (mode === 'reset-confirm') changeMode('reset-request')
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

  // 空值和长度不够不靠点下去才报错：推进按钮直接禁用，
  // 页面下方的反馈槽只承载"填了但错"（服务端拒绝、密码规则不符）。
  function stepReady() {
    const hasEmail = email.trim() !== ''
    const hasCode = otp.length === 6

    switch (mode) {
      case 'password':
      case 'sign-up':
        return hasEmail && password !== ''
      case 'email-otp':
        // 第一次点击只是发码，验证码要到码发出去之后才要求。
        return hasEmail && (!isEmailOtpSent || hasCode)
      case 'verify-email':
        return hasCode
      case 'reset-request':
        return hasEmail
      case 'reset-confirm':
        return hasEmail && hasCode && password !== ''
      case 'two-factor':
        // 恢复码不猜长度：它是丢了验证器时的唯一退路。
        return useBackupCode ? otp.trim() !== '' : hasCode
    }
  }

  return {
    electronQuery,
    isElectronFlow,
    mode,
    email,
    setEmail: changeEmail,
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
  }
}
