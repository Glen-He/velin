import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { config } from './config.js'
import { databasePool } from './database.js'

const app = createApp()

const server = serve({
  fetch: app.fetch,
  hostname: config.host,
  port: config.port,
})

console.info(`Velin 认证服务已启动：${config.authBaseUrl}`)

async function shutDown(signal: string) {
  console.info(`收到 ${signal}，正在关闭认证服务。`)

  server.close(async () => {
    await databasePool.end()
    process.exit(0)
  })
}

process.once('SIGINT', () => void shutDown('SIGINT'))
process.once('SIGTERM', () => void shutDown('SIGTERM'))
