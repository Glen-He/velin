import { z } from 'zod'
import { withApiBoundary } from '@/lib/http/api-handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const attachmentIdSchema = z.uuid()

const handler = withApiBoundary(
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

    const { cancelAttachmentProcessing } = await import(
      '@/lib/chat/attachments'
    )
    const canceled = await cancelAttachmentProcessing(
      session.user.id,
      attachmentId.data,
    )
    if (!canceled) {
      return chatJson({ message: '附件不在识别中。' }, 409)
    }
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    })
  },
)

export { handler as POST }
