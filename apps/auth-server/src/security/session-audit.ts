import { databasePool } from '../database.js'
import type { VerificationMethod } from '@velin/contracts/security'

export type AuthMethod = 'password' | VerificationMethod

// 登录证据仅用于审计，不能授权后续写入。
export async function recordLoginMethod(
  sessionId: string,
  method: AuthMethod,
): Promise<void> {
  await databasePool.query('update "session" set amr = $2 where id = $1', [
    sessionId,
    method,
  ])
}
