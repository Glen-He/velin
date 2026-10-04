import 'server-only'

import { Pool, types } from 'pg'
import { config } from '../config'
import { logger } from '../logging'

const runtime = globalThis as typeof globalThis & { velinDatabasePool?: Pool }
export const databasePool =
  runtime.velinDatabasePool ??
  new Pool({
    connectionString: config.databaseUrl,
    application_name: 'velin-auth',
    // pg 默认将 int8 读为字符串；认证库支持 bigint，避免时间戳参与字符串拼接。
    types: {
      getTypeParser(oid, format) {
        if (oid === 20 && (!format || format === 'text')) return BigInt
        return types.getTypeParser(oid, format)
      },
    },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })

if (!runtime.velinDatabasePool) {
  databasePool.on('error', (error) => {
    logger.error('database.pool_error', { error })
  })
  runtime.velinDatabasePool = databasePool
}
