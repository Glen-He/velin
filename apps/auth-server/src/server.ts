import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { resolve } from 'node:path'
import { auth } from './auth.js'
import { registerAvatarRoutes } from './avatars.js'
import { registerChatRoutes } from './chat/routes.js'
import { config } from './config.js'
import { databasePool } from './database.js'

const app = new Hono()

app.use('*', secureHeaders())

app.get('/api/health', async (context) => {
  await databasePool.query('select 1')

  return context.json({ status: 'ok' })
})

app.get('/api/auth/capabilities', (context) =>
  context.json({
    google: config.google !== null,
    passkey: true,
    emailOtp: true,
    password: true,
    twoFactor: true,
    developmentEmailPreview:
      !config.isProduction && config.email.transport === 'console',
  }),
)

app.on(['POST', 'GET'], '/api/auth/*', (context) =>
  auth.handler(context.req.raw),
)

registerChatRoutes(app)
registerAvatarRoutes(app)

if (config.serveAuthWeb) {
  const authWebDirectory = resolve(import.meta.dirname, '../../auth-web/dist')
  const serveAuthWebIndex = serveStatic({
    root: authWebDirectory,
    path: 'index.html',
  })

  app.use('/assets/*', serveStatic({ root: authWebDirectory }))
  app.get('/', serveAuthWebIndex)
  app.get('/sign-in', serveAuthWebIndex)
  app.get('/account', serveAuthWebIndex)
  app.get('/account/sessions', serveAuthWebIndex)
  app.get('/security', serveAuthWebIndex)
}

app.notFound((context) =>
  context.json(
    {
      error: 'not_found',
      message: '认证服务中不存在该资源。',
    },
    404,
  ),
)

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
