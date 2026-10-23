import { chatSequenceCursorSchema } from '@velin/contracts/chat-validation'
import { z } from 'zod'
import { withApiBoundary } from '@/lib/http/api-handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const conversationIdSchema = z.uuid()

const handler = withApiBoundary(
  async (request, context: { params: Promise<{ conversationId: string }> }) => {
    const { chatJson, getChatSession, rejectBrowserChatRequest } = await import(
      '@/lib/chat/api'
    )
    const rejected = rejectBrowserChatRequest(request)
    if (rejected) return rejected

    const session = await getChatSession(request)
    if (!session) return chatJson({ message: '请先登录。' }, 401)

    const conversationId = conversationIdSchema.safeParse(
      (await context.params).conversationId,
    )
    const before = chatSequenceCursorSchema
      .optional()
      .safeParse(new URL(request.url).searchParams.get('before') ?? undefined)

    if (!conversationId.success || !before.success) {
      return chatJson({ message: '对话请求格式无效。' }, 400)
    }

    const { loadConversation } = await import('@/lib/chat/history')
    const page = await loadConversation(
      session.user.id,
      conversationId.data,
      before.data,
    )

    if (!page) {
      return chatJson({ message: '对话不存在或已被删除。' }, 404)
    }

    return chatJson(page)
  },
)

export { handler as GET }
