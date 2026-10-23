import { withApiBoundary } from '@/lib/http/api-handler'
import {
  chatJson,
  getChatSession,
  rejectBrowserChatRequest,
} from '@/lib/chat/api'
import { conversationVersionRequestSchema } from '@velin/contracts/memory'
import { UserFacingError } from '@velin/contracts/error-copy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const handler = withApiBoundary(
  async (request, context: { params: Promise<{ conversationId: string }> }) => {
    const rejected = rejectBrowserChatRequest(request)
    if (rejected) return rejected
    const session = await getChatSession(request)
    if (!session) return chatJson({ message: '请先登录。' }, 401)
    const { listConversationVersions, restoreConversationVersion } =
      await import('@/lib/chat/versions')
    const { conversationId } = await context.params
    if (
      request.method !== 'GET' &&
      request.headers.get('content-type')?.split(';', 1)[0].trim() !==
        'application/json'
    )
      return chatJson({ message: '请求格式无效。' }, 400)
    const payload: unknown =
      request.method === 'GET' ? {} : await request.json().catch(() => null)
    const parsed = conversationVersionRequestSchema.safeParse(
      payload && typeof payload === 'object'
        ? { ...payload, conversationId }
        : null,
    )
    if (!parsed.success) return chatJson({ message: '版本请求无效。' }, 400)
    if (request.method === 'GET') {
      const versions = await listConversationVersions(
        session.user.id,
        conversationId,
      )
      return versions
        ? chatJson(versions)
        : chatJson({ message: '对话不存在或无权访问。' }, 404)
    }
    if (!parsed.data.versionId)
      return chatJson({ message: '请选择历史版本。' }, 400)
    try {
      await restoreConversationVersion(
        session.user.id,
        conversationId,
        parsed.data.versionId,
      )
      return new Response(null, { status: 204 })
    } catch (error) {
      if (error instanceof UserFacingError)
        return chatJson({ message: error.message }, 409)
      throw error
    }
  },
)
export { handler as GET, handler as POST }
