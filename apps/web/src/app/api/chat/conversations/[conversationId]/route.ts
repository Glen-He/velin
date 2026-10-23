import { chatTitleUpdateSchema } from '@velin/contracts/chat-validation'
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

    if (!conversationId.success) {
      return chatJson({ message: '对话请求格式无效。' }, 400)
    }

    const { deleteConversation } = await import('@/lib/chat/history')
    const deleted = await deleteConversation(
      session.user.id,
      conversationId.data,
    )

    if (!deleted) {
      return chatJson({ message: '对话不存在或已被删除。' }, 404)
    }

    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    })
  },
)

const patchHandler = withApiBoundary(
  async (request, context: { params: Promise<{ conversationId: string }> }) => {
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

    const conversationId = conversationIdSchema.safeParse(
      (await context.params).conversationId,
    )
    const body = chatTitleUpdateSchema.safeParse(
      await request.json().catch(() => null),
    )

    if (!conversationId.success || !body.success) {
      return chatJson({ message: '对话请求格式无效。' }, 400)
    }

    const { renameConversation } = await import('@/lib/chat/history')
    const title = await renameConversation(
      session.user.id,
      conversationId.data,
      body.data.title,
    )

    if (!title) {
      return chatJson({ message: '对话不存在或已被删除。' }, 404)
    }

    return chatJson({ title })
  },
)

export { handler as DELETE, patchHandler as PATCH }
