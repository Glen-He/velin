import type { z } from 'zod'
import type {
  chatAttachmentCancelRequestSchema,
  chatAttachmentDeleteRequestSchema,
  chatAttachmentPickRequestSchema,
  chatAttachmentReprocessRequestSchema,
  chatAttachmentStatusRequestSchema,
  chatAttachmentUploadRequestSchema,
  chatEventSchema,
  chatPendingAttachmentsRequestSchema,
  chatHistoryDeleteRequestSchema,
  chatHistoryLoadRequestSchema,
  chatOrderRequestSchema,
  chatListRequestSchema,
  chatRenameRequestSchema,
  chatRequestSchema,
  chatStopRequestSchema,
} from './chat-validation.js'
import type { MessageAttachment } from './chat.js'

export const chatIpcChannels = {
  send: 'velin:chat:send',
  event: 'velin:chat:event',
  stop: 'velin:chat:stop',
  openExternalLink: 'velin:chat:open-external-link',
  listConversations: 'velin:chat:list-conversations',
  loadConversation: 'velin:chat:load-conversation',
  deleteConversation: 'velin:chat:delete-conversation',
  renameConversation: 'velin:chat:rename-conversation',
  reorderConversations: 'velin:chat:reorder-conversations',
  pickAttachments: 'velin:chat:pick-attachments',
  listPendingAttachments: 'velin:chat:list-pending-attachments',
  uploadAttachment: 'velin:chat:upload-attachment',
  reprocessAttachment: 'velin:chat:reprocess-attachment',
  attachmentStatus: 'velin:chat:attachment-status',
  cancelAttachmentProcessing: 'velin:chat:cancel-attachment-processing',
  deleteAttachment: 'velin:chat:delete-attachment',
} as const

export type SendMessageRequest = z.infer<typeof chatRequestSchema>
export type StopMessageRequest = z.infer<typeof chatStopRequestSchema>
export type ChatHistoryLoadRequest = z.infer<
  typeof chatHistoryLoadRequestSchema
>
export type ChatHistoryDeleteRequest = z.infer<
  typeof chatHistoryDeleteRequestSchema
>
export type ChatRenameRequest = z.infer<typeof chatRenameRequestSchema>
export type ChatOrderRequest = z.infer<typeof chatOrderRequestSchema>
export type ChatListRequest = z.infer<typeof chatListRequestSchema>
export type ChatAttachmentPickRequest = z.infer<
  typeof chatAttachmentPickRequestSchema
>
export type ChatAttachmentUploadRequest = z.infer<
  typeof chatAttachmentUploadRequestSchema
> & { bytes: Uint8Array }
export type ChatPendingAttachmentsRequest = z.infer<
  typeof chatPendingAttachmentsRequestSchema
>
export type ChatAttachmentReprocessRequest = z.infer<
  typeof chatAttachmentReprocessRequestSchema
>
export type ChatAttachmentStatusRequest = z.infer<
  typeof chatAttachmentStatusRequestSchema
>
export type ChatAttachmentCancelRequest = z.infer<
  typeof chatAttachmentCancelRequestSchema
>
export type ChatAttachmentDeleteRequest = z.infer<
  typeof chatAttachmentDeleteRequestSchema
>
export type ChatAttachmentPickResult = {
  attachments: MessageAttachment[]
  error?: string
}

export type ChatEvent = z.infer<typeof chatEventSchema>
