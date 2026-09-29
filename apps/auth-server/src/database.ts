import { Pool } from 'pg'
import { config } from './config.js'

export const databasePool = new Pool({
  connectionString: config.databaseUrl,
  application_name: 'velin-auth',
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

databasePool.on('error', (error) => {
  console.error('PostgreSQL 连接池出现意外错误。', error)
})
