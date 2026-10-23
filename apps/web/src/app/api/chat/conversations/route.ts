import { withApiBoundary } from '@/lib/http/api-handler'
import { chatListRequestSchema } from '@velin/contracts/chat-validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const handler = withApiBoundary(async (request) => {
  const { chatJson, getChatSession, rejectBrowserChatRequest } = await import(
    '@/lib/chat/api'
  )
  const rejected = rejectBrowserChatRequest(request)
  if (rejected) return rejected

  const session = await getChatSession(request)
  if (!session) return chatJson({ message: '请先登录。' }, 401)

  const { listConversations } = await import('@/lib/chat/history')
  const parameters = new URL(request.url).searchParams
  if (
    [...parameters.keys()].some(
      (key) =>
        !['before', 'search'].includes(key) ||
        parameters.getAll(key).length > 1,
    )
  )
    return chatJson({ message: '对话列表参数无效。' }, 400)
  const parsed = chatListRequestSchema.safeParse(Object.fromEntries(parameters))
  if (!parsed.success) return chatJson({ message: '对话列表参数无效。' }, 400)
  return chatJson(await listConversations(session.user.id, parsed.data))
})

export { handler as GET }
