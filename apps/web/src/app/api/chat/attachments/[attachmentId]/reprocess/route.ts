import { z } from 'zod'
import { withApiBoundary } from '@/lib/http/api-handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z
  .object({
    pageRange: z.string().max(120),
  })
  .strict()
const attachmentIdSchema = z.uuid()

const handler = withApiBoundary(
  async (request, context: { params: Promise<{ attachmentId: string }> }) => {
    const { chatJson, getChatSession, rejectBrowserChatRequest } = await import(
      '@/lib/chat/api'
    )
    const rejected = rejectBrowserChatRequest(request)
    if (rejected) return rejected

    if (
      request.headers.get('content-type')?.split(';', 1)[0].trim() !==
      'application/json'
    ) {
      return chatJson({ message: '附件请求格式无效。' }, 400)
    }

    const session = await getChatSession(request)
    if (!session) return chatJson({ message: '请先登录。' }, 401)

    const attachmentId = attachmentIdSchema.safeParse(
      (await context.params).attachmentId,
    )
    if (!attachmentId.success) {
      return chatJson({ message: '附件请求格式无效。' }, 400)
    }
    const body = bodySchema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return chatJson({ message: 'OCR 页码格式无效。' }, 400)
    }

    const {
      ChatAttachmentAccessError,
      ChatAttachmentValidationError,
      reprocessAttachment,
    } = await import('@/lib/chat/attachments')

    try {
      const attachment = await reprocessAttachment(
        session.user.id,
        attachmentId.data,
        body.data.pageRange,
      )
      return chatJson({ attachment })
    } catch (error) {
      if (error instanceof ChatAttachmentValidationError) {
        return chatJson({ message: error.message }, 400)
      }
      if (error instanceof ChatAttachmentAccessError) {
        return chatJson({ message: error.message }, 409)
      }
      throw error
    }
  },
)

export { handler as POST }
