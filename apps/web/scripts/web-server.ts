import { createServer } from 'node:http'
import next from 'next'
import type { Pool } from 'pg'
import { config } from '../src/lib/config'
import { logger } from '../src/lib/logging'
import {
  clientAddressHeader,
  trustedClientAddress,
} from '../src/lib/http/client-address'

const mode = process.argv[2]
if (mode !== 'development' && mode !== 'production')
  throw new Error('Server mode must be development or production.')
if (process.env.NODE_ENV !== mode)
  throw new Error('NODE_ENV must match the server mode.')
const server = createServer((request, response) => {
  delete request.headers[clientAddressHeader]
  const address = trustedClientAddress(
    request.socket.remoteAddress,
    request.headers['x-forwarded-for'],
    config.trustedProxyAddresses,
  )
  if (address) request.headers[clientAddressHeader] = address
  void handler(request, response).catch((error: unknown) => {
    logger.error('http.request_failed', { error })
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ message: '服务暂时不可用，请稍后重试。' }))
    } else response.destroy()
  })
})
const application = next({
  dev: mode === 'development',
  hostname: config.host,
  port: config.port,
  httpServer: server,
})
const handler = application.getRequestHandler()
await application.prepare()
server.listen(config.port, config.host, () =>
  logger.info('server.started', { origin: new URL(config.appUrl).origin }),
)
let stopping = false
async function shutDown(signal: string) {
  if (stopping) return
  stopping = true
  logger.info('server.shutdown_requested', { signal })
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  const deadline = setTimeout(() => server.closeAllConnections(), 10_000)
  deadline.unref()
  await Promise.all([closed, application.close()])
  const pool = (globalThis as typeof globalThis & { velinDatabasePool?: Pool })
    .velinDatabasePool
  await pool?.end()
  clearTimeout(deadline)
  // Next.js 开发工具可能保留辅助句柄；完成连接和数据库清理后退出进程。
  process.exit(0)
}
function requestShutdown(signal: string) {
  void shutDown(signal).catch((error: unknown) => {
    logger.error('server.shutdown_failed', { error })
    process.exit(1)
  })
}
process.once('SIGINT', () => requestShutdown('SIGINT'))
process.once('SIGTERM', () => requestShutdown('SIGTERM'))
