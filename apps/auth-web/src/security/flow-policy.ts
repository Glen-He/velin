import type { VerificationMethod } from '@velin/contracts/security'
import type { DialogOperation } from './security-api'

export type SecurityStage =
  | 'verify'
  | 'methods'
  | 'password'
  | 'newPassword'
  | 'newEmail'
  | 'twoFactorPassword'
  | 'totpVerify'
  | 'backupCodes'
  | 'running'
export type SecurityHistory = {
  stages: readonly [SecurityStage, ...SecurityStage[]]
  direction: 'forward' | 'backward'
}
type HistoryAction =
  | { type: 'advance'; stage: SecurityStage }
  | { type: 'back' }
  | { type: 'password-route' }
export function initialSecurityHistory(
  operation: DialogOperation,
): SecurityHistory {
  return {
    stages: [operation === 'changePassword' ? 'password' : 'verify'],
    direction: 'forward',
  }
}
// 方向与真实历史在同一次转换中更新，不能让动画与返回路径脱节。
export function securityHistoryReducer(
  history: SecurityHistory,
  action: HistoryAction,
): SecurityHistory {
  const { stages } = history
  if (action.type === 'advance')
    return stages.at(-1) === action.stage
      ? history
      : { stages: [...stages, action.stage], direction: 'forward' }
  if (action.type === 'password-route')
    return stages[0] === 'password' && stages.length > 1
      ? { stages: ['password'], direction: 'backward' }
      : history
  if (
    stages.length === 1 ||
    stages.at(-1) === 'running' ||
    stages.at(-1) === 'backupCodes'
  )
    return history
  return { stages: [stages[0], ...stages.slice(1, -1)], direction: 'backward' }
}

export function usableChannels(
  allowed: readonly VerificationMethod[],
  hasPasskey: boolean,
  hasTwoFactor: boolean,
): VerificationMethod[] {
  return (['emailOtp', 'passkey', 'totp', 'backupCode'] as const).filter(
    (method) =>
      allowed.includes(method) &&
      (method === 'passkey'
        ? hasPasskey
        : method === 'totp' || method === 'backupCode'
          ? hasTwoFactor
          : true),
  )
}
export function stageAfterVerify(operation: DialogOperation): SecurityStage {
  switch (operation) {
    case 'changeEmail':
      return 'newEmail'
    case 'changePassword':
      return 'newPassword'
    case 'enableTwoFactor':
    case 'disableTwoFactor':
      return 'twoFactorPassword'
    default:
      return 'running'
  }
}
