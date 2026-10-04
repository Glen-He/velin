import { z } from 'zod'
import {
  operationGrantHeader,
  operationGrantSchema,
  securityStateSchema,
  type OperationGrant,
  type SecurityOperation,
  type VerificationMethod,
  type VerificationIntent,
  type SecurityState,
} from '@velin/contracts/security'
import { requestJson } from '../../lib/http/client'
import { authenticatePasskey } from '../auth/passkey'

export type StepUpChannel = VerificationMethod
export type GatedOperation = Exclude<
  SecurityOperation,
  'changePasswordVerified'
>
export type DialogOperation = GatedOperation | 'changePassword'
export type OperationRequirement =
  SecurityState['requirements'][SecurityOperation]
export type { SecurityState }
export type StepUpResult = { ok: true; grant: OperationGrant }
export type StepUpCodeResult = { ok: true; devCode?: string }

const channelLabels: Record<StepUpChannel, string> = {
  emailOtp: '邮箱验证码',
  totp: '验证器动态码',
  backupCode: '恢复码',
  passkey: '通行密钥',
}

// 卡片标题要写清这次在授权什么，不能只说“验证方式”。
const operationLabels: Record<DialogOperation, string> = {
  changePassword: '修改密码',
  changeEmail: '修改登录邮箱',
  addPasskey: '添加通行密钥',
  removePasskey: '删除通行密钥',
  enableTwoFactor: '开启双重认证',
  disableTwoFactor: '关闭双重认证',
}

export function stepUpOperationLabel(operation: DialogOperation) {
  return operationLabels[operation]
}

export function stepUpChannelLabel(channel: StepUpChannel) {
  return channelLabels[channel]
}

const codeFieldLabels: Record<StepUpChannel, string> = {
  emailOtp: '邮箱验证码',
  totp: '动态验证码',
  backupCode: '恢复码',
  passkey: '通行密钥',
}

export function stepUpFieldLabel(channel: StepUpChannel) {
  return codeFieldLabels[channel]
}

export function verificationHeaders(
  grant: OperationGrant | null,
): Record<string, string> {
  return { [operationGrantHeader]: grant?.id ?? '' }
}

export function fetchSecurityState(
  signal?: AbortSignal,
): Promise<SecurityState> {
  return requestJson(
    '/api/security/requirements',
    (value) => securityStateSchema.parse(value),
    { signal },
  )
}

export async function sendStepUpEmailCode(
  signal?: AbortSignal,
): Promise<StepUpCodeResult> {
  const payload = await requestJson(
    '/api/security/step-up/email-code',
    (value) =>
      z
        .object({ sent: z.literal(true), devOtp: z.string().optional() })
        .parse(value),
    { method: 'POST', body: '{}', signal },
  )
  return {
    ok: true,
    ...(process.env.NODE_ENV === 'development'
      ? { devCode: payload.devOtp }
      : {}),
  }
}

export async function setPasswordWithVerification(
  password: string,
  grant: OperationGrant | null,
  signal?: AbortSignal,
) {
  await requestJson(
    '/api/auth/password/set',
    (value) => z.object({ status: z.literal(true) }).parse(value),
    {
      method: 'POST',
      headers: verificationHeaders(grant),
      signal,
      body: JSON.stringify({ password }),
    },
  )
  return { ok: true as const }
}

export async function submitStepUp(
  channel: Exclude<StepUpChannel, 'passkey'>,
  code: string,
  intent: VerificationIntent,
  signal?: AbortSignal,
): Promise<StepUpResult> {
  const grant = await requestJson(
    '/api/security/step-up',
    (value) => operationGrantSchema.parse(value),
    {
      method: 'POST',
      body: JSON.stringify({ ...intent, method: channel, code }),
      signal,
    },
  )
  return { ok: true, grant }
}

export async function runPasskeyStepUp(
  intent: VerificationIntent,
  signal?: AbortSignal,
): Promise<StepUpResult> {
  const response = await authenticatePasskey({
    optionsPath: '/api/security/step-up/passkey-options',
    verifyPath: '/api/security/step-up/passkey-verify',
    body: intent,
    signal,
  })
  return { ok: true, grant: operationGrantSchema.parse(response) }
}
