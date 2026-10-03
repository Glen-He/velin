import { databasePool } from '../database.js'
import { operationGrants } from './grants.js'
import type { VerificationMethod } from '@velin/contracts/security'

export type AuthMethod = 'password' | VerificationMethod

// Login evidence is audit metadata, never permission for a later mutation.
export async function recordLoginMethod(
  sessionId: string,
  method: AuthMethod,
): Promise<void> {
  await databasePool.query('update "session" set amr = $2 where id = $1', [
    sessionId,
    method,
  ])
}

export async function resetUserGrants(userId: string): Promise<void> {
  await operationGrants.revokeUser(userId)
  await databasePool.query(
    'update "session" set "stepUpLevel" = 1, "verifiedAt" = null where "userId" = $1',
    [userId],
  )
}
