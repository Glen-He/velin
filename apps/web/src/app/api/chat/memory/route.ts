import { withApiBoundary } from '@/lib/http/api-handler'
import {
  chatJson,
  getChatSession,
  rejectBrowserChatRequest,
} from '@/lib/chat/api'
import { memoryActionSchema } from '@velin/contracts/memory'
import { UserFacingError } from '@velin/contracts/error-copy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const handler = withApiBoundary(async (request: Request) => {
  const rejected = rejectBrowserChatRequest(request)
  if (rejected) return rejected
  const session = await getChatSession(request)
  if (!session) return chatJson({ message: '请先登录。' }, 401)
  const { readMemory, updateMemory } = await import('@/lib/chat/memory')
  if (request.method === 'GET')
    return chatJson(await readMemory(session.user.id))
  if (
    request.headers.get('content-type')?.split(';', 1)[0].trim() !==
    'application/json'
  )
    return chatJson({ message: '请求格式无效。' }, 400)
  const body = memoryActionSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!body.success) return chatJson({ message: '记忆内容无效或过长。' }, 400)
  try {
    return chatJson(await updateMemory(session.user.id, body.data))
  } catch (error) {
    if (error instanceof UserFacingError)
      return chatJson({ message: error.message }, 409)
    throw error
  }
})
export { handler as GET, handler as POST }
