import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { authClient } from '../auth-client'
import { authenticatePasskey } from './passkey'
import { errorMessage } from '@velin/contracts/error-copy'
import { newPasswordError } from '@velin/contracts/policy'

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
  const transferStartedRef = useRef(false)

  // 已有会话时直接进入账号；桌面端授权流程（isElectronFlow）仍停在当前页完成交接。
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
      session ||
      !capabilities.passkey ||
      mode !== 'password' ||
      typeof PublicKeyCredential === 'undefined' ||
      typeof PublicKeyCredential.isConditionalMediationAvailable !== 'function'
    )
      return
    const controller = new AbortController()
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
    return () => controller.abort()
  }, [capabilities.passkey, electronQuery, mode, refetchSession, session])

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
    const { data, error: transferError } =
      await authClient.electron.transferUser({
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
      electronQuery.flow === 'manual-code' ? null : '登录成功，正在返回 Velin…',
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
      setError(
        caughtError instanceof Error ? caughtError.message : '登录失败。',
      )
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
      setError(
        caughtError instanceof Error ? caughtError.message : '注册失败。',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submitEmailVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    resetFeedback()
    setIsSubmitting(true)

    try {
      const { error: verificationError } =
        await authClient.emailOtp.verifyEmail({
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
      setError(
        caughtError instanceof Error ? caughtError.message : '验证失败。',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function signInWithPasskey() {
    resetFeedback()
    setIsSubmitting(true)

    try {
      await authenticatePasskey({ query: electronQuery })

      await finishElectronAuthentication()
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : '通行密钥登录失败。',
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

    try {
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL: `${window.location.origin}${window.location.pathname}${window.location.search}`,
        fetchOptions: { query: electronQuery },
      })
      if (result.error) throw new Error(errorMessage(result.error))
    } catch (cause) {
      setError(errorMessage(cause, '无法发起 Google 登录。'))
    } finally {
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
  }
}
