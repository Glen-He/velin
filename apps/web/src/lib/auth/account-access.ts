import 'server-only'
import { APIError } from 'better-auth/api'
import { databasePool } from '../database/connection'

export async function assertAccountEnabled(userId: string) {
  const result = await databasePool.query<{ disabled_at: Date | null }>(
    'select disabled_at from "user" where id = $1',
    [userId],
  )
  if (!result.rows[0] || result.rows[0].disabled_at) {
    throw APIError.fromStatus('FORBIDDEN', {
      message: '该账号已停用，请联系支持人员。',
      code: 'ACCOUNT_DISABLED',
    })
  }
}

// 只由拥有数据库运维权限的本地命令调用，不提供公开管理路由。
export async function setAccountEnabled(userId: string, enabled: boolean) {
  const client = await databasePool.connect()
  try {
    await client.query('begin')
    const result = await client.query(
      'update "user" set disabled_at = case when $2 then null else now() end where id = $1 returning id',
      [userId, enabled],
    )
    if (result.rowCount !== 1) throw new Error('Account does not exist.')
    if (!enabled) {
      await client.query('delete from "session" where "userId" = $1', [userId])
      await client.query(
        'delete from security_operation_grant where user_id = $1',
        [userId],
      )
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
