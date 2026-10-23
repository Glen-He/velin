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
  const conversations = await import('../src/app/api/chat/conversations/route')
  const conversation = await import(
    '../src/app/api/chat/conversations/[conversationId]/route'
  )
  const messages = await import(
    '../src/app/api/chat/conversations/[conversationId]/messages/route'
  )
  const order = await import('../src/app/api/chat/conversations/order/route')
  const attachments = await import('../src/app/api/chat/attachments/route')
  const attachment = await import(
    '../src/app/api/chat/attachments/[attachmentId]/route'
  )
  const attachmentReprocess = await import(
    '../src/app/api/chat/attachments/[attachmentId]/reprocess/route'
  )
  const attachmentCancel = await import(
    '../src/app/api/chat/attachments/[attachmentId]/cancel/route'
  )
  const memory = await import('../src/app/api/chat/memory/route')
  const stream = await import('../src/app/api/chat/stream/route')
  const versions = await import(
    '../src/app/api/chat/conversations/[conversationId]/versions/route'
  )
  const endpoints: Record<string, (request: Request) => Promise<Response>> = {
    '/api/chat/stream': (request) => stream.POST(request, undefined),
    '/api/chat/memory': (request) =>
      request.method === 'GET'
        ? memory.GET(request, undefined)
        : memory.POST(request, undefined),
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
      if (path === '/api/chat/conversations')
        return conversations.GET(request, undefined)
      if (path === '/api/chat/conversations/order')
        return order.PUT(request, undefined)
      if (path === '/api/chat/attachments')
        return request.method === 'GET'
          ? attachments.GET(request, undefined)
          : attachments.POST(request, undefined)
      if (path.startsWith('/api/chat/attachments/')) {
        const segments = path.split('/')
        const attachmentId = segments[4]!
        const context = { params: Promise.resolve({ attachmentId }) }
        if (segments[5] === 'reprocess') {
          return attachmentReprocess.POST(request, context)
        }
        if (segments[5] === 'cancel') {
          return attachmentCancel.POST(request, context)
        }
        if (request.method === 'GET') {
          return attachment.GET(request, context)
        }
        return attachment.DELETE(request, context)
      }
      if (path.startsWith('/api/chat/conversations/')) {
        const segments = path.split('/')
        const conversationId = segments[4]
        const context = {
          params: Promise.resolve({ conversationId }),
        }
        if (segments[5] === 'versions')
          return request.method === 'GET'
            ? versions.GET(request, context)
            : versions.POST(request, context)
        if (segments[5] === 'messages') {
          return messages.GET(request, context)
        }
        if (request.method === 'PATCH') {
          return conversation.PATCH(request, context)
        }
        return conversation.DELETE(request, context)
      }
      const endpoint = endpoints[path]
      if (endpoint) return endpoint(request)
      if (path.startsWith('/api/auth/')) return auth.POST(request, undefined)
      return Response.json({ message: '资源不存在。' }, { status: 404 })
    },
  }
}
