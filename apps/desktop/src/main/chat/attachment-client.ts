import {
  attachmentExtensions,
  attachmentLimits,
  attachmentMimeType,
  imageExtensions,
  isImageMimeType,
  type MessageAttachment,
} from '@velin/contracts/attachments'
import {
  chatAttachmentUploadResponseSchema,
  chatPendingAttachmentsResponseSchema,
} from '@velin/contracts/chat-validation'
import { errorMessage, UserFacingError } from '@velin/contracts/error-copy'
import { isRecord } from '@velin/contracts/value'
import { BrowserWindow, dialog } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { ChatAttachmentPickResult } from '@velin/contracts/chat-protocol'
import { credentialScope, serviceUrl } from '../auth/auth-client'

const requestTimeoutMs = 120_000

function readError(value: unknown, fallback: string) {
  return errorMessage(value, fallback)
}

function parseAttachmentResponse(value: unknown) {
  const parsed = chatAttachmentUploadResponseSchema.safeParse(value)
  if (!parsed.success) {
    throw new UserFacingError('附件返回的数据不完整，请重新添加。')
  }
  return parsed.data.attachment
}

function parsePendingAttachmentsResponse(value: unknown) {
  const parsed = chatPendingAttachmentsResponseSchema.safeParse(value)
  if (!parsed.success) {
    throw new UserFacingError('未发送附件返回的数据不完整，请稍后重试。')
  }
  return parsed.data.attachments
}

export class ChatAttachmentClient {
  private readonly onUnauthorized: () => void

  constructor(onUnauthorized: () => void) {
    this.onUnauthorized = onUnauthorized
  }

  private async request(
    path: string,
    init: RequestInit,
    scope = credentialScope.capture(),
  ) {
    if (!scope.isCurrent()) {
      throw new UserFacingError('登录状态已变化，请重新添加附件。')
    }
    const response = await fetch(`${serviceUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Cookie: scope.cookie,
      },
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([
        scope.signal,
        AbortSignal.timeout(requestTimeoutMs),
      ]),
    })

    if (!scope.isCurrent()) {
      await response.body?.cancel().catch(() => {})
      throw new UserFacingError('登录状态已变化，请重新添加附件。')
    }
    if (response.status === 401) {
      await response.body?.cancel().catch(() => {})
      if (scope.isCurrent()) this.onUnauthorized()
      throw new UserFacingError('登录状态已过期，请重新登录。')
    }

    return response
  }

  async upload(
    name: string,
    mimeType: string,
    bytes: Uint8Array,
    options: { accountId: string; pageRange?: string; conversationId?: string },
    scope = credentialScope.capture(),
  ): Promise<MessageAttachment> {
    const safeName = basename(name).slice(0, 200)
    const expectedMimeType = attachmentMimeType(safeName)
    if (!expectedMimeType || expectedMimeType !== mimeType) {
      throw new UserFacingError('不支持这种文件类型。')
    }
    if (bytes.byteLength === 0) {
      throw new UserFacingError('文件为空，无法添加。')
    }
    const isImage = isImageMimeType(mimeType)
    if (isImage && bytes.byteLength > attachmentLimits.imageBytes) {
      throw new UserFacingError('图片过大，单张不能超过 5 MB。')
    }
    if (!isImage && bytes.byteLength > attachmentLimits.fileBytes) {
      throw new UserFacingError('文件过大，单个文件不能超过 20 MB。')
    }

    const form = new FormData()
    form.append('accountId', options.accountId)
    form.append('file', new Blob([bytes], { type: mimeType }), safeName)
    if (options.pageRange) {
      form.append('pageRange', options.pageRange)
    }
    if (options.conversationId) {
      form.append('conversationId', options.conversationId)
    }
    const response = await this.request(
      '/api/chat/attachments',
      {
        method: 'POST',
        body: form,
      },
      scope,
    )

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null)
      if (response.status === 413) {
        throw new UserFacingError('文件过大，单个文件不能超过 20 MB。')
      }
      throw new UserFacingError(readError(body, '添加文件失败，请稍后重试。'))
    }

    return parseAttachmentResponse(await response.json().catch(() => null))
  }

  async listPending(conversationId?: string) {
    const query = conversationId
      ? `?conversationId=${encodeURIComponent(conversationId)}`
      : ''
    const response = await this.request(`/api/chat/attachments${query}`, {
      method: 'GET',
    })
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null)
      throw new UserFacingError(readError(body, '读取未发送附件失败。'))
    }
    return parsePendingAttachmentsResponse(
      await response.json().catch(() => null),
    )
  }

  async pick(
    kind: 'file' | 'image',
    remaining: number,
    window: BrowserWindow | null,
    accountId: string,
    conversationId?: string,
  ): Promise<ChatAttachmentPickResult> {
    const scope = credentialScope.capture()
    const wantsImage = kind === 'image'
    const options: OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [
        wantsImage
          ? { name: '图片', extensions: [...imageExtensions] }
          : { name: '文本、代码与 PDF', extensions: [...attachmentExtensions] },
      ],
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return { attachments: [] }
    }

    const errors: string[] = []
    const paths = result.filePaths.slice(0, remaining)
    if (result.filePaths.length > remaining) {
      errors.push(`最多还能添加 ${remaining} 个文件。`)
    }

    const attachments: MessageAttachment[] = []
    for (const path of paths) {
      if (!scope.isCurrent()) {
        throw new UserFacingError('登录状态已变化，请重新添加附件。')
      }
      try {
        const info = await stat(path)
        if (!info.isFile()) {
          throw new UserFacingError('请选择文件。')
        }
        if (wantsImage && info.size > attachmentLimits.imageBytes) {
          throw new UserFacingError('图片过大，单张不能超过 5 MB。')
        }
        if (!wantsImage && info.size > attachmentLimits.fileBytes) {
          throw new UserFacingError('文件过大，单个文件不能超过 20 MB。')
        }
        const name = basename(path)
        const mimeType = attachmentMimeType(name)
        if (!mimeType || isImageMimeType(mimeType) !== wantsImage) {
          throw new UserFacingError(
            wantsImage ? '请选择图片文件。' : '不支持这种文件类型。',
          )
        }
        const bytes = await readFile(path)
        attachments.push(
          await this.upload(
            name,
            mimeType,
            bytes,
            { accountId, conversationId },
            scope,
          ),
        )
      } catch (error) {
        errors.push(
          error instanceof Error ? error.message : '添加文件失败，请稍后重试。',
        )
      }
    }

    return {
      attachments,
      ...(errors.length > 0 ? { error: [...new Set(errors)].join(' ') } : {}),
    }
  }

  async reprocess(attachmentId: string, pageRange: string) {
    const response = await this.request(
      `/api/chat/attachments/${encodeURIComponent(attachmentId)}/reprocess`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageRange }),
      },
    )
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null)
      throw new UserFacingError(readError(body, '重新识别失败，请稍后重试。'))
    }
    return parseAttachmentResponse(await response.json().catch(() => null))
  }

  async getStatus(attachmentId: string) {
    const response = await this.request(
      `/api/chat/attachments/${encodeURIComponent(attachmentId)}`,
      { method: 'GET' },
    )
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null)
      throw new UserFacingError(readError(body, '读取附件状态失败。'))
    }
    return parseAttachmentResponse(await response.json().catch(() => null))
  }

  async cancel(attachmentId: string) {
    const response = await this.request(
      `/api/chat/attachments/${encodeURIComponent(attachmentId)}/cancel`,
      { method: 'POST' },
    )
    if (response.status === 204 || response.status === 409) {
      await response.body?.cancel().catch(() => {})
      return
    }
    const body: unknown = await response.json().catch(() => null)
    throw new UserFacingError(readError(body, '停止识别失败，请稍后重试。'))
  }

  async delete(attachmentId: string) {
    const response = await this.request(
      `/api/chat/attachments/${encodeURIComponent(attachmentId)}`,
      { method: 'DELETE' },
    )
    if (response.status === 204 || response.status === 404) {
      await response.body?.cancel().catch(() => {})
      return
    }

    const body: unknown = await response.json().catch(() => null)
    if (!isRecord(body)) {
      throw new UserFacingError('移除附件失败，请稍后重试。')
    }
    throw new UserFacingError(readError(body, '移除附件失败，请稍后重试。'))
  }
}
