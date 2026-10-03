import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { resolve } from 'node:path'
import { auth } from './auth.js'
import { registerAvatarRoutes } from './avatars.js'
import { registerChatRoutes } from './chat/routes.js'
import { config } from './config.js'
import { databasePool } from './database.js'
import { registerSecurityRoutes } from './security/step-up.js'
import { authRequestWithAddress } from './security/auth-request.js'

export function createApp() {
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
    auth.handler(
      authRequestWithAddress(
        context.req.raw,
        context.env,
        config.trustedProxyAddresses,
      ),
    ),
  )

  registerChatRoutes(app)
  registerAvatarRoutes(app)
  registerSecurityRoutes(app)

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
    app.get('/security/passkeys', serveAuthWebIndex)
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

  return app
}
