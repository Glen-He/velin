import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { test } from 'node:test'

test('production SMTP fails closed before AUTH when STARTTLS is unavailable', async () => {
  let authenticated = false
  const server = createServer((socket) => {
    socket.write('220 fixture ESMTP\r\n')
    socket.on('data', (chunk) => {
      const command = chunk.toString()
      if (command.startsWith('EHLO'))
        socket.write('250-fixture\r\n250 AUTH PLAIN LOGIN\r\n')
      else if (command.startsWith('STARTTLS'))
        socket.write('502 TLS unavailable\r\n')
      else if (command.startsWith('AUTH')) {
        authenticated = true
        socket.end('535 forbidden\r\n')
      } else socket.end('221 bye\r\n')
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  Object.assign(process.env, {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost/velin_smtp_test',
    BETTER_AUTH_SECRET: 'smtp-fixture-secret-at-least-32-characters',
    APP_URL: 'https://velin.example.test',
    PASSKEY_RP_ID: 'velin.example.test',
    GOOGLE_CLIENT_ID: 'fixture',
    GOOGLE_CLIENT_SECRET: 'fixture',
    DEEPSEEK_API_KEY: 'fixture',
    EMAIL_TRANSPORT: 'smtp',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(address.port),
    SMTP_USER: 'fixture',
    SMTP_PASSWORD: 'fixture',
    SMTP_SECURE: 'false',
  })
  try {
    const { sendAuthenticationEmail } = await import('../src/lib/email')
    await assert.rejects(
      sendAuthenticationEmail({
        to: 'fixture@example.test',
        purpose: 'sign-in',
        subject: 'Fixture',
        text: 'Fixture',
      }),
    )
    assert.equal(authenticated, false)
  } finally {
    server.close()
  }
})
