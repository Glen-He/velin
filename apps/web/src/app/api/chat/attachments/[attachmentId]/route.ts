import { z } from 'zod'
import { withApiBoundary } from '@/lib/http/api-handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const attachmentIdSchema = z.uuid()

const getHandler = withApiBoundary(
  async (request, context: { params: Promise<{ attachmentId: string }> }) => {
    const { chatJson, getChatSession, rejectBrowserChatRequest } = await import(
      '@/lib/chat/api'
    )
    const rejected = rejectBrowserChatRequest(request)
    if (rejected) return rejected

    const session = await getChatSession(request)
    if (!session) return chatJson({ message: '请先登录。' }, 401)

    const attachmentId = attachmentIdSchema.safeParse(
      (await context.params).attachmentId,
    )
    if (!attachmentId.success) {
      return chatJson({ message: '附件请求格式无效。' }, 400)
    }

    const { loadAttachmentStatus } = await import('@/lib/chat/attachments')
    const attachment = await loadAttachmentStatus(
      session.user.id,
      attachmentId.data,
    )
    if (!attachment) {
      return chatJson({ message: '附件不存在。' }, 404)
    }
    return chatJson({ attachment })
  },
)

const deleteHandler = withApiBoundary(
  async (request, context: { params: Promise<{ attachmentId: string }> }) => {
    const { chatJson, getChatSession, rejectBrowserChatRequest } = await import(
      '@/lib/chat/api'
    )
    const rejected = rejectBrowserChatRequest(request)
    if (rejected) return rejected

    const session = await getChatSession(request)
    if (!session) return chatJson({ message: '请先登录。' }, 401)

    const attachmentId = attachmentIdSchema.safeParse(
      (await context.params).attachmentId,
    )
    if (!attachmentId.success) {
      return chatJson({ message: '附件请求格式无效。' }, 400)
    }

    const { deletePendingAttachment } = await import('@/lib/chat/attachments')
    const deleted = await deletePendingAttachment(
      session.user.id,
      attachmentId.data,
    )
    if (!deleted) {
      return chatJson({ message: '附件不存在或已经发送。' }, 404)
    }

    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    })
  },
)

export { getHandler as GET, deleteHandler as DELETE }
