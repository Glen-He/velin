import {
  attachmentLimits,
  attachmentMimeType,
} from '@velin/contracts/attachments'
import type { VelinApi } from '@velin/contracts/velin-api'
import type { MessageAttachment } from '@velin/contracts/chat'

// 每个异步边界都检查所属输入框的生命周期，避免切换账号后继续提交下一份文件。
export async function uploadFiles(
  selected: {
    file: Pick<File, 'name' | 'size' | 'arrayBuffer'>
    isImage: boolean
  }[],
  options: {
    accountId: string
    signal: AbortSignal
    conversationId?: string
    upload: VelinApi['chat']['uploadAttachment']
    onUploaded: (attachment: MessageAttachment) => void
    onError: (error: unknown) => void
    onSettled: (isImage: boolean) => void
  },
) {
  for (const { file, isImage } of selected) {
    if (options.signal.aborted) return
    try {
      const mimeType = attachmentMimeType(file.name)
      if (!mimeType) throw new Error('不支持这种文件类型。')
      if (file.size === 0) throw new Error('文件为空，无法添加。')
      if (isImage && file.size > attachmentLimits.imageBytes)
        throw new Error('图片过大，单张不能超过 5 MB。')
      if (!isImage && file.size > attachmentLimits.fileBytes)
        throw new Error('文件过大，单个文件不能超过 20 MB。')
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (options.signal.aborted) return
      const attachment = await options.upload({
        accountId: options.accountId,
        name: file.name,
        mimeType,
        bytes,
        ...(options.conversationId
          ? { conversationId: options.conversationId }
          : {}),
      })
      if (options.signal.aborted) return
      options.onUploaded(attachment)
    } catch (error) {
      if (options.signal.aborted) return
      options.onError(error)
    } finally {
      if (!options.signal.aborted) options.onSettled(isImage)
    }
  }
}
