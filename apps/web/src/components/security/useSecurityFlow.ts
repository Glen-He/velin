import {
  initialSecurityHistory,
  securityHistoryReducer,
  usableChannels,
  stageAfterVerify,
} from './flow-policy'
import type { SecurityStage } from './flow-policy'
import type {
  OperationGrant,
  VerificationIntent,
} from '@velin/contracts/security'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { actionErrorMessage, isStepUpRequired } from '../../lib/http/client'
import { registerPasskey } from '../auth/passkey'
import { authClient } from '../../lib/auth/client'
import { errorMessage } from '@velin/contracts/error-copy'
import { newPasswordError } from '@velin/contracts/policy'
import { useSendSlot } from './useSendSlot'
import {
  runPasskeyStepUp,
  sendStepUpEmailCode,
  setPasswordWithVerification,
  verificationHeaders,
  submitStepUp,
} from './security-api'
import type {
  DialogOperation,
  OperationRequirement,
  StepUpChannel,
} from './security-api'

export type SecurityDialogProps = {
  operation: DialogOperation
  requirement: OperationRequirement | null
  email: string
  hasPasskey: boolean
  hasTwoFactor: boolean
  passkeyId?: string
  onClose: () => void
  onCompleted: (message?: string) => void
}

type Enrollment = {
  totpURI: string
  backupCodes: string[]
}

export function useSecurityFlow({
  operation,
  requirement,
  email,
  hasPasskey,
  hasTwoFactor,
  passkeyId,
  onCompleted,
}: SecurityDialogProps) {
  const channels = useMemo(
    () =>
      usableChannels(
        requirement?.allowed ?? ['emailOtp', 'totp', 'backupCode', 'passkey'],
        hasPasskey,
        hasTwoFactor,
      ),
    [requirement?.allowed, hasPasskey, hasTwoFactor],
  )
  // 卡片内走过的步骤栈。第一屏没有返回，返回只在卡片内的界面之间退，
  // 不会退回网页，也不会顺手把卡片关掉。
  const [history, dispatchHistory] = useReducer(
    securityHistoryReducer,
    operation,
    initialSecurityHistory,
  )
  const trail = history.stages
  const stage = trail[trail.length - 1]
  const previousStage = trail[trail.length - 2]
  const [channel, setChannel] = useState<StepUpChannel>(channels[0])
  const [code, setCode] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newEmailCode, setNewEmailCode] = useState('')
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [working, setWorking] = useState(false)
  // 两个收件地址各自一套发码状态：升级验证码发给当前邮箱，新邮箱验证码发给新地址。
  const stepUpSend = useSendSlot(email)
  const newEmailSend = useSendSlot(newEmail)
  const codeRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const autoRan = useRef<Set<SecurityStage>>(new Set())

  const alternatives = channels.filter((method) => method !== channel)
  // 「用其他方式修改」进来的列表就是入口本身，此时还没有当前通道，邮箱验证码也要列进去。
  const listedChannels = previousStage === 'password' ? channels : alternatives
  // 卡片高度要容纳它可能出现的最高一步：修改密码的入口列表比切换列表多一条（当前通道本身）。
  const listRows =
    operation === 'changePassword' ? channels.length : alternatives.length
  // 处理中（系统弹窗、提交动作）和终局的恢复码步不允许退回——那一步的副作用已经发生。
  const canGoBack =
    trail.length > 1 && stage !== 'running' && stage !== 'backupCodes'
  const requestController = useRef<AbortController | null>(null)
  const grantRef = useRef<OperationGrant | null>(null)
  const retryRef = useRef<(() => Promise<void>) | null>(null)
  const retryStageRef = useRef<SecurityStage>('verify')
  const intent: VerificationIntent = {
    operation:
      operation === 'changePassword' ? 'changePasswordVerified' : operation,
    target: operation === 'removePasskey' ? (passkeyId ?? '') : '',
  }
  useEffect(() => {
    const controller = new AbortController()
    requestController.current = controller
    return () => controller.abort()
  }, [])

  function restartVerification() {
    grantRef.current = null
    retryRef.current = null
    enterStage('verify')
  }

  function handleActionFailure(cause: unknown, retry?: () => Promise<void>) {
    if (requestController.current?.signal.aborted) return
    if (isStepUpRequired(cause) && retry) {
      grantRef.current = null
      retryRef.current = retry
      retryStageRef.current = stage
      enterStage('verify')
      setMessage('请重新验证后继续。')
    } else setMessage(actionErrorMessage(cause))
  }

  const filled = (value: string) => value.trim().length > 0
  const otpReady = (value: string) => value.length === 6

  // 必填为空或长度不够不再写成提示语：推进按钮直接禁用。提示行只留给"填了但可能错"
  // 的反馈——验证码不正确、两次密码不一致、服务端拒绝、发送冷却。
  // 恢复码不猜长度：丢了验证器时它是唯一退路，只要求非空。
  function stepReady() {
    switch (stage) {
      case 'verify': {
        if (channel === 'passkey') {
          return true
        }

        return channel === 'backupCode' ? filled(code) : otpReady(code)
      }
      case 'password':
        return (
          filled(currentPassword) &&
          filled(newPassword) &&
          filled(confirmPassword)
        )
      case 'newPassword':
        return filled(newPassword) && filled(confirmPassword)
      case 'newEmail':
        return filled(newEmail) && otpReady(newEmailCode)
      case 'twoFactorPassword':
        return filled(currentPassword)
      case 'totpVerify':
        return otpReady(code)
      default:
        return true
    }
  }

  const advanceReady = stepReady()

  function requireSamePasswords() {
    if (newPassword !== confirmPassword) {
      setMessage('两次输入的新密码不一致。')
      return false
    }

    return true
  }

  async function requestEmailCode() {
    if (stepUpSend.busy) {
      return
    }

    const ticket = stepUpSend.begin()
    if (!ticket) return
    setMessage(null)

    try {
      const result = await sendStepUpEmailCode(
        requestController.current?.signal,
      )

      if (requestController.current?.signal.aborted) return
      stepUpSend.delivered(ticket)
      if (!stepUpSend.isCurrent(ticket)) return

      // 本地开发没有真实邮件投递，服务端会带回明文码，直接填进输入框；
      // 这属于开发能力，不占卡片的提示行。
      if (process.env.NODE_ENV === 'development' && result.devCode) {
        setCode(result.devCode)
      }

      codeRef.current?.focus({ preventScroll: true })
    } catch (cause) {
      if (stepUpSend.isCurrent(ticket)) handleActionFailure(cause)
    } finally {
      stepUpSend.settle(ticket)
    }
  }

  async function requestNewEmailCode() {
    if (newEmailSend.busy) {
      return
    }

    const ticket = newEmailSend.begin()
    if (!ticket) return
    setMessage(null)

    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email: newEmail,
        type: 'email-verification',
        fetchOptions: { signal: requestController.current?.signal },
      })

      if (error) {
        if (newEmailSend.isCurrent(ticket)) setMessage(errorMessage(error))
        return
      }

      if (requestController.current?.signal.aborted) return
      newEmailSend.delivered(ticket)
      if (!newEmailSend.isCurrent(ticket)) return
      codeRef.current?.focus({ preventScroll: true })
    } catch (cause) {
      if (newEmailSend.isCurrent(ticket)) handleActionFailure(cause)
    } finally {
      newEmailSend.settle(ticket)
    }
  }

  // 前进到下一步。栈必须如实记录走过的界面，否则返回会跳过中间那一步，
  // 列表也会因为"上一个界面是谁"判断错而少列或多列一种验证方式。
  function pushStage(next: SecurityStage) {
    setMessage(null)
    dispatchHistory({ type: 'advance', stage: next })
  }

  // 换步骤不清冷却：冷却属于收件地址而不是当前这一步，来回切界面不该让人绕开限流。
  function enterStage(next: SecurityStage) {
    setCode('')
    pushStage(next)
  }

  // 顶部返回按钮：只退一张卡片界面，卡片本身不动，也不碰浏览器的历史。
  function goBack() {
    if (working || verifying) return
    dispatchHistory({ type: 'back' })
    setCode('')
    setMessage(null)
  }

  // 回到第一条路（旧密码三字段），中间那几步整段作废。
  function backToPasswordStage() {
    if (working || verifying) return
    dispatchHistory({ type: 'password-route' })
    setCode('')
    setMessage(null)
  }

  function choose(method: StepUpChannel) {
    setChannel(method)
    setCode('')
    setMessage(null)
    dispatchHistory({ type: 'advance', stage: 'verify' })
  }

  async function acceptVerification(grant: OperationGrant) {
    if (requestController.current?.signal.aborted) return
    grantRef.current = grant
    const retry = retryRef.current
    if (retry) {
      retryRef.current = null
      pushStage(retryStageRef.current)
      await retry()
    } else advanceAfterVerify()
  }

  function advanceAfterVerify() {
    autoRan.current.delete('running')
    autoRan.current.add('verify')
    enterStage(stageAfterVerify(operation))
  }

  async function confirmStepUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (verifying || !stepReady()) {
      return
    }

    if (channel === 'passkey') {
      setVerifying(true)
      setMessage(null)

      try {
        const result = await runPasskeyStepUp(
          intent,
          requestController.current?.signal,
        )

        await acceptVerification(result.grant)
      } catch (cause) {
        handleActionFailure(cause)
      } finally {
        setVerifying(false)
      }

      return
    }

    setVerifying(true)
    setMessage(null)

    try {
      const result = await submitStepUp(
        channel,
        code.trim(),
        intent,
        requestController.current?.signal,
      )

      await acceptVerification(result.grant)
    } catch (cause) {
      handleActionFailure(cause)
    } finally {
      setVerifying(false)
    }
  }

  async function runOperation() {
    setWorking(true)
    setMessage(null)

    try {
      if (operation === 'addPasskey') {
        await registerPasskey(
          verificationHeaders(grantRef.current),
          requestController.current?.signal,
        )

        // 通行密钥的成败由行状态本身说明（未添加 ↔ 已添加 N 个、实例行出现/消失），
        // 不再另发一句文字反馈。
        if (!requestController.current?.signal.aborted) onCompleted()
        return
      }

      if (operation === 'removePasskey' && passkeyId) {
        const result = await authClient.passkey.deletePasskey({
          id: passkeyId,
          fetchOptions: {
            headers: verificationHeaders(grantRef.current),
            signal: requestController.current?.signal,
          },
        })

        if (result?.error) {
          throw result.error
        }

        if (!requestController.current?.signal.aborted) onCompleted()
      }
    } catch (caughtError) {
      handleActionFailure(caughtError, () => runOperation())
      setWorking(false)
    }
  }

  // running 阶段一进入就执行；'verify' 通过后也会落到这里。
  useEffect(() => {
    if (stage !== 'running' || autoRan.current.has('running')) {
      return
    }

    autoRan.current.add('running')
    void runOperation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  async function savePassword(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()

    if (working) {
      return
    }

    if (!requireSamePasswords()) {
      return
    }

    setMessage(null)

    const policyError = newPasswordError(newPassword)

    if (policyError) {
      setMessage(policyError)
      return
    }

    setWorking(true)

    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
        fetchOptions: { signal: requestController.current?.signal },
      })

      if (result.error) {
        throw result.error
      }

      if (!requestController.current?.signal.aborted)
        onCompleted('密码已更新。')
    } catch (caughtError) {
      setMessage(errorMessage(caughtError, '密码修改失败，请稍后重试。'))
      setWorking(false)
    }
  }

  async function submitNewPassword(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()

    if (working) {
      return
    }

    if (!requireSamePasswords()) {
      return
    }

    setWorking(true)
    setMessage(null)

    try {
      await setPasswordWithVerification(
        newPassword,
        grantRef.current,
        requestController.current?.signal,
      )

      if (!requestController.current?.signal.aborted)
        onCompleted('密码已更新，其他设备需要重新登录。')
    } catch (cause) {
      handleActionFailure(cause, () => submitNewPassword())
    } finally {
      setWorking(false)
    }
  }

  async function changeToNewEmail(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()

    if (working) {
      return
    }

    setWorking(true)
    setMessage(null)

    try {
      const result = await authClient.emailOtp.changeEmail({
        newEmail,
        otp: newEmailCode,
        fetchOptions: {
          headers: verificationHeaders(grantRef.current),
          signal: requestController.current?.signal,
        },
      })

      if (result.error) {
        throw result.error
      }

      if (!requestController.current?.signal.aborted)
        onCompleted('邮箱已更新。')
    } catch (caughtError) {
      handleActionFailure(caughtError, () => changeToNewEmail())
      setWorking(false)
    }
  }

  // better-auth 强制开关 2FA 必须带当前密码，卡片的顺序是：
  // 先过一次 2 级强验证，再收当前密码，最后才落到二维码/关闭。
  async function submitTwoFactorPassword(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()

    if (working) {
      return
    }

    setWorking(true)
    setMessage(null)

    try {
      if (operation === 'disableTwoFactor') {
        const disable = await authClient.twoFactor.disable({
          password: currentPassword,
          fetchOptions: {
            headers: verificationHeaders(grantRef.current),
            signal: requestController.current?.signal,
          },
        })

        if (disable.error) {
          throw disable.error
        }

        if (!requestController.current?.signal.aborted)
          onCompleted('双重认证已关闭。')
        return
      }

      const result = await authClient.twoFactor.enable({
        password: currentPassword,
        method: 'totp',
        issuer: 'Velin',
        fetchOptions: {
          headers: verificationHeaders(grantRef.current),
          signal: requestController.current?.signal,
        },
      })

      if (result.error) {
        throw result.error
      }

      if (!result.data || result.data.method !== 'totp') {
        throw new Error('未能创建 TOTP 验证器。')
      }

      setEnrollment({
        totpURI: result.data.totpURI,
        backupCodes: result.data.backupCodes,
      })
      setWorking(false)
      autoRan.current.add('totpVerify')
      enterStage('totpVerify')
      codeRef.current?.focus({ preventScroll: true })
    } catch (caughtError) {
      handleActionFailure(caughtError, () => submitTwoFactorPassword())
      setWorking(false)
    }
  }

  async function finishTwoFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (working) {
      return
    }

    setWorking(true)
    setMessage(null)

    try {
      const result = await authClient.twoFactor.verifyTotp({
        code,
        trustDevice: false,
        fetchOptions: { signal: requestController.current?.signal },
      })

      if (result.error) {
        throw result.error
      }

      enterStage('backupCodes')
    } catch (caughtError) {
      setMessage(errorMessage(caughtError, '动态验证码不正确。'))
    } finally {
      setWorking(false)
    }
  }

  // 倒计时和开发提示都跟着当前这一步的收件地址走，不能沿用上一个界面的状态。
  const activeSend = stage === 'newEmail' ? newEmailSend : stepUpSend

  // 提示行只承载当前这一步自己的状态：错误反馈或发送冷却。
  const notice =
    message ??
    (activeSend.remaining > 0 ? `${activeSend.remaining} 秒后可重新发送` : '')

  return {
    stage,
    direction: history.direction,
    previousStage,
    channel,
    code,
    setCode,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    newEmail,
    setNewEmail,
    newEmailCode,
    setNewEmailCode,
    enrollment,
    message,
    setMessage,
    verifying,
    working,
    stepUpSend,
    newEmailSend,
    codeRef,
    passwordRef,
    alternatives,
    listedChannels,
    listRows,
    canGoBack,
    restartVerification,
    filled,
    advanceReady,
    requestEmailCode,
    requestNewEmailCode,
    pushStage,
    goBack,
    backToPasswordStage,
    choose,
    confirmStepUp,
    savePassword,
    submitNewPassword,
    changeToNewEmail,
    submitTwoFactorPassword,
    finishTwoFactor,
    notice,
  }
}
