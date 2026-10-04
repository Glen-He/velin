import type { Pool } from 'pg'
import {
  operationGrantValidityMs,
  type OperationGrant,
  type VerificationIntent,
  type VerificationMethod,
} from '@velin/contracts/security'

export type GrantIdentity = { userId: string; sessionId: string }
export type GrantClaim = GrantIdentity & VerificationIntent & { id: string }

// 原子消费保证并发请求不能复用同一次确认。
// 消费后操作失败，需要重新确认。
export function createOperationGrants(database: Pick<Pool, 'query'>) {
  return {
    async issue(
      identity: GrantIdentity,
      intent: VerificationIntent,
      method: VerificationMethod,
    ): Promise<OperationGrant> {
      const id = crypto.randomUUID()
      const expiresAt = Date.now() + operationGrantValidityMs
      await database.query(
        'delete from security_operation_grant where expires_at <= CURRENT_TIMESTAMP',
      )
      await database.query(
        `insert into security_operation_grant (id, user_id, session_id, operation, target, method, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          identity.userId,
          identity.sessionId,
          intent.operation,
          intent.target,
          method,
          new Date(expiresAt),
        ],
      )
      return { id, expiresAt, operation: intent.operation }
    },
    async consume(claim: GrantClaim): Promise<boolean> {
      const result = await database.query(
        `delete from security_operation_grant
         where id = $1 and user_id = $2 and session_id = $3 and operation = $4
           and target = $5 and expires_at > CURRENT_TIMESTAMP
         returning id`,
        [
          claim.id,
          claim.userId,
          claim.sessionId,
          claim.operation,
          claim.target,
        ],
      )
      return result.rowCount === 1
    },
    async revokeUser(userId: string): Promise<void> {
      await database.query(
        'delete from security_operation_grant where user_id = $1',
        [userId],
      )
    },
  }
}
