import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { config } from './config.js'
import { databasePool } from './database.js'
import { logger } from './logging.js'

const app = createApp()

const server = serve({
  fetch: app.fetch,
  hostname: config.host,
  port: config.port,
})

logger.info('server.started', { origin: new URL(config.authBaseUrl).origin })

async function shutDown(signal: string) {
  logger.info('server.shutdown_requested', { signal })

  server.close(async () => {
    await databasePool.end()
    process.exit(0)
  })
}

process.once('SIGINT', () => void shutDown('SIGINT'))
process.once('SIGTERM', () => void shutDown('SIGTERM'))
