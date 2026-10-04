import {
  trustedClientAddress,
  clientAddressHeader,
} from '../src/lib/http/client-address'
import { config } from '../src/lib/config'

// 集成测试调用实际 Next Route Handlers，不保留第二套路由实现。
export async function createApiFixture() {
  const auth = await import('../src/app/api/auth/[...all]/route')
  const capabilities = await import('../src/app/api/auth/capabilities/route')
  const avatars = await import('../src/app/api/avatars/route')
  const avatar = await import('../src/app/api/avatars/[userId]/route')
  const requirements = await import(
    '../src/app/api/security/requirements/route'
  )
  const code = await import('../src/app/api/security/step-up/email-code/route')
  const verify = await import('../src/app/api/security/step-up/route')
  const options = await import(
    '../src/app/api/security/step-up/passkey-options/route'
  )
  const passkey = await import(
    '../src/app/api/security/step-up/passkey-verify/route'
  )
  const endpoints: Record<string, (request: Request) => Promise<Response>> = {
    '/api/auth/capabilities': (request) => capabilities.GET(request, undefined),
    '/api/avatars': (request) => avatars.POST(request, undefined),
    '/api/security/requirements': (request) =>
      requirements.GET(request, undefined),
    '/api/security/step-up/email-code': (request) =>
      code.POST(request, undefined),
    '/api/security/step-up': (request) => verify.POST(request, undefined),
    '/api/security/step-up/passkey-options': (request) =>
      options.POST(request, undefined),
    '/api/security/step-up/passkey-verify': (request) =>
      passkey.POST(request, undefined),
  }
  return {
    async request(
      input: string | Request,
      init?: RequestInit,
      peer?: { incoming: { socket: { remoteAddress: string } } },
    ) {
      let request =
        typeof input === 'string'
          ? new Request(new URL(input, config.appUrl), init)
          : input
      const headers = new Headers(request.headers)
      headers.delete(clientAddressHeader)
      const address = trustedClientAddress(
        peer?.incoming.socket.remoteAddress,
        headers.get('x-forwarded-for') ?? undefined,
        config.trustedProxyAddresses,
      )
      if (address) headers.set(clientAddressHeader, address)
      request = new Request(request, { headers })
      const path = new URL(request.url).pathname
      if (path.startsWith('/api/avatars/'))
        return avatar.GET(request, {
          params: Promise.resolve({ userId: path.split('/').at(-1)! }),
        })
      const endpoint = endpoints[path]
      if (endpoint) return endpoint(request)
      if (path.startsWith('/api/auth/')) return auth.POST(request, undefined)
      return Response.json({ message: '资源不存在。' }, { status: 404 })
    },
  }
}
