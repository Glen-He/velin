import { Pool } from 'pg'
import { config } from './config.js'
import { logger } from './logging.js'

export const databasePool = new Pool({
  connectionString: config.databaseUrl,
  application_name: 'velin-auth',
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

databasePool.on('error', (error) => {
  logger.error('database.pool_error', { error })
})
