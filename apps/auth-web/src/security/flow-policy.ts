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
export type SecurityHistory = readonly [SecurityStage, ...SecurityStage[]]
type HistoryAction =
  | { type: 'advance'; stage: SecurityStage }
  | { type: 'back' }
  | { type: 'password-route' }

export function initialSecurityHistory(
  operation: DialogOperation,
): SecurityHistory {
  return [operation === 'changePassword' ? 'password' : 'verify']
}
export function securityHistoryReducer(
  history: SecurityHistory,
  action: HistoryAction,
): SecurityHistory {
  if (action.type === 'advance')
    return history.at(-1) === action.stage
      ? history
      : [...history, action.stage]
  if (action.type === 'password-route')
    return history[0] === 'password' ? ['password'] : history
  if (
    history.length === 1 ||
    history.at(-1) === 'running' ||
    history.at(-1) === 'backupCodes'
  )
    return history
  return [history[0], ...history.slice(1, -1)]
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
