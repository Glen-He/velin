import { attachmentLimits } from '@velin/contracts/attachments'
import {
  chatAttachmentUploadRequestSchema,
  chatPendingAttachmentsRequestSchema,
} from '@velin/contracts/chat-validation'
import { withApiBoundary } from '@/lib/http/api-handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const postHandler = withApiBoundary(async (request) => {
  const { chatJson, getChatSession, rejectBrowserChatRequest } = await import(
    '@/lib/chat/api'
  )
  const rejected = rejectBrowserChatRequest(request)
  if (rejected) return rejected

  if (
    request.headers.get('content-type')?.split(';', 1)[0].trim() !==
    'multipart/form-data'
  ) {
    return chatJson({ message: '附件请求格式无效。' }, 400)
  }

  const session = await getChatSession(request)
  if (!session) return chatJson({ message: '请先登录。' }, 401)

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return chatJson({ message: '请选择要添加的文件。' }, 400)
  }
  if (file.size > attachmentLimits.fileBytes) {
    return chatJson({ message: '文件过大，单个文件不能超过 20 MB。' }, 413)
  }
  const pageRangeValue = form?.get('pageRange')
  if (
    pageRangeValue !== null &&
    (typeof pageRangeValue !== 'string' || pageRangeValue.length > 120)
  ) {
    return chatJson({ message: 'OCR 页码格式无效。' }, 400)
  }
  const pageRange =
    typeof pageRangeValue === 'string' ? pageRangeValue : undefined
  const conversationIdValue = form?.get('conversationId')
  if (conversationIdValue !== null && typeof conversationIdValue !== 'string') {
    return chatJson({ message: '对话请求格式无效。' }, 400)
  }
  const parsedRequest = chatAttachmentUploadRequestSchema.safeParse({
    accountId: form?.get('accountId'),
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    ...(pageRange !== undefined ? { pageRange } : {}),
    ...(typeof conversationIdValue === 'string'
      ? { conversationId: conversationIdValue }
      : {}),
  })
  if (!parsedRequest.success) {
    return chatJson({ message: '附件请求格式无效。' }, 400)
  }
  // 新会话没有可校验的所属资源，显式绑定发起选择时的账号，拒绝换号后的迟到上传。
  if (parsedRequest.data.accountId !== session.user.id)
    return chatJson({ message: '登录状态已变化，请重新添加附件。' }, 409)

  const {
    ChatAttachmentAccessError,
    ChatAttachmentQuotaError,
    ChatAttachmentValidationError,
    storeAttachment,
  } = await import('@/lib/chat/attachments')

  try {
    const attachment = await storeAttachment(session.user.id, {
      name: parsedRequest.data.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      pageRange: parsedRequest.data.pageRange,
      conversationId: parsedRequest.data.conversationId,
      signal: request.signal,
    })
    return chatJson({ attachment })
  } catch (error) {
    if (error instanceof ChatAttachmentValidationError) {
      return chatJson({ message: error.message }, 400)
    }
    if (error instanceof ChatAttachmentQuotaError) {
      return chatJson({ message: error.message }, 429)
    }
    if (error instanceof ChatAttachmentAccessError) {
      return chatJson({ message: error.message }, 404)
    }
    throw error
  }
})

const getHandler = withApiBoundary(async (request) => {
  const { chatJson, getChatSession, rejectBrowserChatRequest } = await import(
    '@/lib/chat/api'
  )
  const rejected = rejectBrowserChatRequest(request)
  if (rejected) return rejected

  const session = await getChatSession(request)
  if (!session) return chatJson({ message: '请先登录。' }, 401)

  const url = new URL(request.url)
  const conversationIds = url.searchParams.getAll('conversationId')
  if (conversationIds.length > 1) {
    return chatJson({ message: '对话请求格式无效。' }, 400)
  }
  const parsed = chatPendingAttachmentsRequestSchema.safeParse(
    conversationIds.length === 0 ? {} : { conversationId: conversationIds[0] },
  )
  if (!parsed.success) {
    return chatJson({ message: '对话请求格式无效。' }, 400)
  }

  const { listPendingAttachments } = await import('@/lib/chat/attachments')
  const attachments = await listPendingAttachments(
    session.user.id,
    parsed.data.conversationId,
  )
  return chatJson({ attachments })
})

export { getHandler as GET, postHandler as POST }
