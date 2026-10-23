import { chatOrderRequestSchema } from '@velin/contracts/chat-validation'
import { withApiBoundary } from '@/lib/http/api-handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const handler = withApiBoundary(async (request) => {
  const { chatJson, getChatSession, rejectBrowserChatRequest } = await import(
    '@/lib/chat/api'
  )
  const rejected = rejectBrowserChatRequest(request)
  if (rejected) return rejected
  if (
    request.headers.get('content-type')?.split(';', 1)[0].trim() !==
    'application/json'
  ) {
    return chatJson({ message: '请求格式无效。' }, 400)
  }

  const session = await getChatSession(request)
  if (!session) return chatJson({ message: '请先登录。' }, 401)

  const body = chatOrderRequestSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!body.success) {
    return chatJson({ message: '对话排序参数无效。' }, 400)
  }

  const { reorderConversations } = await import('@/lib/chat/history')
  const reordered = await reorderConversations(session.user.id, body.data)

  if (!reordered) {
    return chatJson({ message: '对话列表已变化，请重新读取后再排序。' }, 409)
  }

  return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  })
})

export { handler as PUT }
