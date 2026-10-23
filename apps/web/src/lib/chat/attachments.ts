import 'server-only'

import {
  attachmentLimits,
  attachmentMimeType,
  formatOcrPageRange,
  isImageMimeType,
  parseOcrPageRange,
  type MessageAttachment,
  type MessageAttachmentKind,
  type MessageAttachmentStatus,
} from '@velin/contracts/attachments'
import { createHash } from 'node:crypto'
import { isValidStorageText } from '@velin/contracts/policy'
import type { PoolClient } from 'pg'
import { databasePool } from '../database/connection'
import { config } from '../config'
import { DocumentProcessingError, processDocument } from '../documents/process'
import { hasPdfHeader } from '../ocr/pdf'
import { pruneUnreferencedPdfCache } from '../maintenance'
import { consumeAttachmentBudget } from './attachment-budget'

const pendingAttachmentLimit = attachmentLimits.maxFiles * 4
const pendingAttachmentHours = 24

export class ChatAttachmentValidationError extends Error {}
export class ChatAttachmentQuotaError extends Error {}
export class ChatAttachmentAccessError extends Error {}

type AttachmentRow = {
  id: string
  message_id: string | null
  kind: MessageAttachmentKind
  name: string
  mime_type: string
  size_bytes: number
  thumbnail: string | null
  status: MessageAttachmentStatus
  page_count: number | null
  ocr_page_range: string | null
  ocr_error: string | null
  ocr_completed_pages: number
  ocr_total_pages: number | null
}

type AttachmentImageRow = {
  message_id: string
  data: Buffer
  mime_type: string
}

const attachmentColumns = `id, message_id, kind, name, mime_type, size_bytes,
  thumbnail, status, page_count, ocr_page_range, ocr_error,
  ocr_completed_pages, ocr_total_pages`

function toAttachment(row: AttachmentRow): MessageAttachment {
  const showsProgress =
    row.status === 'processing' ||
    row.status === 'failed' ||
    row.status === 'canceled'
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    status: row.status,
    ...(row.thumbnail ? { thumbnail: row.thumbnail } : {}),
    ...(row.page_count !== null ? { pageCount: row.page_count } : {}),
    ...(row.ocr_page_range ? { ocrPageRange: row.ocr_page_range } : {}),
    ...(row.ocr_error ? { ocrError: row.ocr_error } : {}),
    ...(showsProgress
      ? {
          progress: {
            completed: row.ocr_completed_pages,
            total: row.ocr_total_pages ?? 0,
          },
        }
      : {}),
  }
}

function sanitizeName(value: string) {
  const filename = value.replace(/^.*[\\/]/, '').trim()
  return [...filename]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return (
        codePoint >= 0x20 && codePoint !== 0x7f && isValidStorageText(character)
      )
    })
    .slice(0, 200)
    .join('')
}

function hasBytes(bytes: Uint8Array, offset: number, values: number[]) {
  if (bytes.length < offset + values.length) return false
  return values.every((value, index) => bytes[offset + index] === value)
}

function imageSignatureValid(mimeType: string, bytes: Uint8Array) {
  if (mimeType === 'image/png') {
    return hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  }
  if (mimeType === 'image/jpeg') {
    return hasBytes(bytes, 0, [0xff, 0xd8, 0xff])
  }
  if (mimeType === 'image/webp') {
    return (
      hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
      hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])
    )
  }
  return false
}

function parsePageRange(value: string | undefined) {
  if (value === undefined) return { requested: undefined, normalized: null }
  const parsed = parseOcrPageRange(value)
  if (parsed && !parsed.ok) {
    throw new ChatAttachmentValidationError(
      parsed.error === 'limit'
        ? `OCR 页码最多 ${attachmentLimits.pdfOcrPages} 页。`
        : 'OCR 页码格式无效，请使用如 1-3,7 的格式。',
    )
  }
  if (!parsed?.ok) return { requested: undefined, normalized: null }
  return {
    requested: parsed.pages,
    normalized: formatOcrPageRange(parsed.pages),
  }
}

export async function storeAttachment(
  userId: string,
  input: {
    name: string
    bytes: Uint8Array
    pageRange?: string
    conversationId?: string
    signal?: AbortSignal
  },
): Promise<MessageAttachment> {
  const name = sanitizeName(input.name)
  const mimeType = attachmentMimeType(name)

  if (!name || !mimeType) {
    throw new ChatAttachmentValidationError('不支持这种文件类型。')
  }
  if (input.bytes.byteLength === 0) {
    throw new ChatAttachmentValidationError('文件为空，无法添加。')
  }

  const kind: MessageAttachmentKind = isImageMimeType(mimeType)
    ? 'image'
    : 'file'
  const isPdf = kind === 'file' && mimeType === 'application/pdf'
  if (input.pageRange !== undefined && !isPdf) {
    throw new ChatAttachmentValidationError('OCR 页码仅适用于 PDF。')
  }
  const pageRange = parsePageRange(input.pageRange)

  let textContent = ''
  let thumbnail: string | null = null
  let imageData: Buffer | null = null
  let status: MessageAttachmentStatus = 'ready'
  let sha256: string | null = null
  let enqueue: typeof import('../ocr/queue').enqueuePdfOcr | undefined

  if (kind === 'image') {
    if (input.bytes.byteLength > attachmentLimits.imageBytes) {
      throw new ChatAttachmentValidationError('图片过大，单张不能超过 5 MB。')
    }
    if (!imageSignatureValid(mimeType, input.bytes)) {
      throw new ChatAttachmentValidationError('图片文件格式无效。')
    }
    imageData = Buffer.from(input.bytes)
  } else {
    if (input.bytes.byteLength > attachmentLimits.fileBytes) {
      throw new ChatAttachmentValidationError(
        '文件过大，单个文件不能超过 20 MB。',
      )
    }
    if (isPdf) {
      if (!hasPdfHeader(input.bytes)) {
        throw new ChatAttachmentValidationError('PDF 文件格式无效。')
      }
      status = 'processing'
      sha256 = createHash('sha256').update(input.bytes).digest('hex')
      const queue = await import('../ocr/queue')
      await queue.getOcrQueue()
      enqueue = queue.enqueuePdfOcr
    }
  }

  const client = await databasePool.connect()
  const leaseId = crypto.randomUUID()
  let attachmentId: string | undefined
  let row: AttachmentRow

  try {
    await client.query('begin')
    await client.query('select id from "user" where id = $1 for update', [
      userId,
    ])
    if (input.conversationId) {
      const conversation = await client.query(
        `select 1 from chat_conversation where id = $1 and user_id = $2`,
        [input.conversationId, userId],
      )
      if (conversation.rowCount !== 1) {
        throw new ChatAttachmentAccessError('对话不存在或已经删除。')
      }
    }
    await client.query(
      `delete from chat_attachment
       where user_id = $1 and message_id is null
         and created_at < now() - ($2 || ' hours')::interval`,
      [userId, pendingAttachmentHours],
    )
    const pending = await client.query<{ count: number }>(
      `select count(*)::int as count
       from chat_attachment
       where user_id = $1 and message_id is null`,
      [userId],
    )
    if (pending.rows[0]?.count >= pendingAttachmentLimit) {
      throw new ChatAttachmentQuotaError('待发送附件过多，请先发送或移除。')
    }
    if (!(await consumeAttachmentBudget(client, userId))) {
      throw new ChatAttachmentQuotaError('文件处理次数过多，请一小时后重试。')
    }

    if (!isPdf) {
      // 短事务只预留容量；解析在提交后进入受限子进程，不能占住用户行锁。
      await client.query('select pg_advisory_xact_lock(20261022, 2)')
      await client.query(
        'delete from document_processing_lease where expires_at <= now()',
      )
      const leases = await client.query<{ total: number; own: number }>(
        'select count(*)::int as total, count(*) filter (where user_id = $1)::int as own from document_processing_lease',
        [userId],
      )
      if (
        leases.rows[0].own ||
        leases.rows[0].total >= config.documents.concurrency
      ) {
        throw new ChatAttachmentQuotaError('文件处理繁忙，请稍后再添加。')
      }
      await client.query(
        `insert into document_processing_lease (user_id, lease_id, expires_at)
         values ($1, $2, now() + interval '90 seconds')`,
        [userId, leaseId],
      )
      status = 'processing'
    }

    const id = crypto.randomUUID()
    const generation = crypto.randomUUID()
    const inserted = await client.query<AttachmentRow>(
      `insert into chat_attachment
         (id, user_id, kind, name, mime_type, size_bytes, text_content,
          data, thumbnail, status, ocr_page_range, ocr_generation,
          draft_conversation_id, source_sha256)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       returning ${attachmentColumns}`,
      [
        id,
        userId,
        kind,
        name,
        mimeType,
        input.bytes.byteLength,
        textContent,
        imageData,
        thumbnail,
        status,
        pageRange.normalized,
        generation,
        input.conversationId ?? null,
        sha256,
      ],
    )
    row = inserted.rows[0]
    if (!row) throw new Error('Attachment insert did not return a row.')
    attachmentId = id

    if (isPdf && sha256 && enqueue) {
      await client.query(
        `insert into chat_attachment_source
           (attachment_id, user_id, sha256, data)
         values ($1, $2, $3, $4)`,
        [id, userId, sha256, Buffer.from(input.bytes)],
      )
      await enqueue(id, generation, client)
    }

    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }

  if (isPdf) return toAttachment(row!)
  try {
    const parsed = await processDocument(mimeType, input.bytes, input.signal)
    textContent = parsed.text
    thumbnail = parsed.thumbnail ?? null
    const updated = await databasePool.query<AttachmentRow>(
      `update chat_attachment set text_content = $3, thumbnail = $4, status = 'ready'
       where id = $1 and user_id = $2 and status = 'processing' and message_id is null
       returning ${attachmentColumns}`,
      [attachmentId, userId, textContent, thumbnail],
    )
    if (!updated.rows[0])
      throw new ChatAttachmentAccessError('附件已移除或处理已取消。')
    return toAttachment(updated.rows[0])
  } catch (error) {
    await databasePool.query(
      "delete from chat_attachment where id = $1 and user_id = $2 and message_id is null and status = 'processing'",
      [attachmentId, userId],
    )
    if (error instanceof DocumentProcessingError)
      throw new ChatAttachmentValidationError(error.message)
    throw error
  } finally {
    await databasePool.query(
      'delete from document_processing_lease where user_id = $1 and lease_id = $2',
      [userId, leaseId],
    )
  }
}

export async function reprocessAttachment(
  userId: string,
  attachmentId: string,
  pageRangeValue: string,
) {
  const pageRange = parsePageRange(pageRangeValue)
  const queue = await import('../ocr/queue')
  await queue.getOcrQueue()

  const client = await databasePool.connect()
  try {
    await client.query('begin')
    await client.query('select id from "user" where id = $1 for update', [
      userId,
    ])
    if (!(await consumeAttachmentBudget(client, userId))) {
      throw new ChatAttachmentQuotaError('文件处理次数过多，请一小时后重试。')
    }
    const existing = await client.query<{
      kind: MessageAttachmentKind
      mime_type: string
      status: MessageAttachmentStatus
      message_id: string | null
      page_count: number | null
    }>(
      `select kind, mime_type, status, message_id, page_count
       from chat_attachment
       where id = $1 and user_id = $2
       for update`,
      [attachmentId, userId],
    )
    const current = existing.rows[0]
    if (!current || current.message_id) {
      throw new ChatAttachmentAccessError('附件不存在或已经发送。')
    }
    if (current.kind !== 'file' || current.mime_type !== 'application/pdf') {
      throw new ChatAttachmentValidationError('OCR 页码仅适用于 PDF。')
    }
    if (current.status === 'processing') {
      throw new ChatAttachmentAccessError('附件正在识别中，请稍候。')
    }
    if (
      current.page_count !== null &&
      pageRange.requested?.some((page) => page > current.page_count!)
    ) {
      throw new ChatAttachmentValidationError(
        `OCR 页码超出 PDF 范围（共 ${current.page_count} 页）。`,
      )
    }
    const source = await client.query(
      `select 1 from chat_attachment_source where attachment_id = $1`,
      [attachmentId],
    )
    if (source.rowCount !== 1) {
      throw new ChatAttachmentAccessError(
        'PDF 源文件不可用，请移除后重新添加。',
      )
    }

    const generation = crypto.randomUUID()
    const updated = await client.query<AttachmentRow>(
      `update chat_attachment
       set status = 'processing', text_content = '', ocr_page_range = $3,
           ocr_completed_pages = 0, ocr_total_pages = null,
           ocr_error = null, ocr_generation = $4, ocr_attempt_id = null
       where id = $1 and user_id = $2
       returning ${attachmentColumns}`,
      [attachmentId, userId, pageRange.normalized, generation],
    )
    const row = updated.rows[0]
    if (!row) throw new Error('Attachment update did not return a row.')
    await queue.enqueuePdfOcr(attachmentId, generation, client)
    await client.query('commit')
    return toAttachment(row)
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function listPendingAttachments(
  userId: string,
  conversationId?: string,
) {
  const result = await databasePool.query<AttachmentRow>(
    `select ${attachmentColumns}
     from chat_attachment
     where user_id = $1 and message_id is null
       and draft_conversation_id is not distinct from $2::uuid
     order by created_at asc, id asc
     limit 100`,
    [userId, conversationId ?? null],
  )
  return result.rows.map(toAttachment)
}

export async function loadAttachmentStatus(
  userId: string,
  attachmentId: string,
) {
  const result = await databasePool.query<AttachmentRow>(
    `select ${attachmentColumns}
     from chat_attachment
     where id = $1 and user_id = $2`,
    [attachmentId, userId],
  )
  const row = result.rows[0]
  return row ? toAttachment(row) : null
}

export async function cancelAttachmentProcessing(
  userId: string,
  attachmentId: string,
) {
  const result = await databasePool.query(
    `update chat_attachment
     set status = 'canceled', text_content = '', ocr_error = null,
         ocr_attempt_id = null
     where id = $1 and user_id = $2 and message_id is null
       and status = 'processing'`,
    [attachmentId, userId],
  )
  return result.rowCount === 1
}

export async function deletePendingAttachment(
  userId: string,
  attachmentId: string,
) {
  const client = await databasePool.connect()
  try {
    await client.query('begin')
    await client.query('select id from "user" where id = $1 for update', [
      userId,
    ])
    const result = await client.query(
      `delete from chat_attachment where id = $1 and user_id = $2 and message_id is null`,
      [attachmentId, userId],
    )
    await pruneUnreferencedPdfCache(client, userId)
    await client.query('commit')
    return result.rowCount === 1
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function bindAttachments(
  client: PoolClient,
  userId: string,
  messageId: string,
  attachmentIds: string[],
  allowImages: boolean,
  conversationId: string,
) {
  if (attachmentIds.length === 0) return

  const bound = await client.query<{
    id: string
    kind: MessageAttachmentKind
    status: MessageAttachmentStatus
    draft_conversation_id: string | null
    message_id: string | null
  }>(
    `select id, kind, status, draft_conversation_id, message_id from chat_attachment
     where id = any($1::uuid[]) and user_id = $2 and (message_id is null or message_id = $3)
     for update`,
    [attachmentIds, userId, messageId],
  )
  if (bound.rowCount !== attachmentIds.length) {
    throw new ChatAttachmentAccessError('附件不存在或已经发送。')
  }
  if (bound.rows.some((row) => row.status !== 'ready')) {
    throw new ChatAttachmentAccessError('附件仍在识别中，请稍候再发送。')
  }
  const existingCounts = await client.query<{ images: number; files: number }>(
    `select count(*) filter (where kind = 'image')::int as images,
      count(*) filter (where kind = 'file')::int as files
      from chat_attachment where message_id = $1`,
    [messageId],
  )
  const additions = bound.rows.filter((row) => !row.message_id)
  if (
    additions.filter((row) => row.kind === 'image').length +
      existingCounts.rows[0].images >
      attachmentLimits.maxImages ||
    additions.length +
      existingCounts.rows[0].files +
      existingCounts.rows[0].images >
      attachmentLimits.maxFiles
  ) {
    throw new ChatAttachmentValidationError('单条消息的附件数量超出限制。')
  }
  if (!allowImages && bound.rows.some((row) => row.kind === 'image')) {
    throw new ChatAttachmentAccessError('当前模型不支持图片附件。')
  }
  if (
    bound.rows.some(
      (row) =>
        row.draft_conversation_id !== null &&
        row.draft_conversation_id !== conversationId,
    )
  ) {
    throw new ChatAttachmentAccessError('附件属于其他对话草稿。')
  }

  await client.query(
    `update chat_attachment
     set message_id = $1, draft_conversation_id = null
     where id = any($2::uuid[])`,
    [messageId, attachmentIds],
  )
  await client.query(
    `delete from chat_attachment_source
     where attachment_id = any($1::uuid[])`,
    [attachmentIds],
  )
}

export async function loadAttachmentsByMessage(
  messageIds: string[],
  database: Pick<PoolClient, 'query'> = databasePool,
): Promise<Map<string, MessageAttachment[]>> {
  const attachments = new Map<string, MessageAttachment[]>()
  if (messageIds.length === 0) return attachments

  const result = await database.query<AttachmentRow>(
    `select ${attachmentColumns}
     from chat_attachment
     where message_id = any($1::uuid[])
     order by created_at asc, id asc`,
    [messageIds],
  )
  for (const row of result.rows) {
    if (!row.message_id) continue
    const list = attachments.get(row.message_id) ?? []
    list.push(toAttachment(row))
    attachments.set(row.message_id, list)
  }
  return attachments
}

export async function loadImageDataByMessage(
  client: PoolClient,
  messageIds: string[],
  allowImages = true,
): Promise<{ images: Map<string, string[]>; limited: boolean }> {
  const images = new Map<string, string[]>()
  if (messageIds.length === 0) return { images, limited: false }

  if (!allowImages) {
    const existing = await client.query(
      `select 1 from chat_attachment
       where message_id = any($1::uuid[]) and kind = 'image' limit 1`,
      [messageIds],
    )
    if (existing.rowCount) {
      throw new ChatAttachmentAccessError(
        '当前对话包含图片，请选择支持图片的模型。',
      )
    }
    return { images, limited: false }
  }

  const result = await client.query<
    AttachmentImageRow & { total_count: number }
  >(
    `with candidates as (
       select a.id, a.size_bytes,
         row_number() over (order by m.position desc, a.created_at, a.id) as priority
       from unnest($1::uuid[]) with ordinality as m(message_id, position)
       join chat_attachment a on a.message_id = m.message_id
       where a.kind = 'image'
     ), selected as (
       select id, priority, sum(size_bytes) over (order by priority) as total_bytes
       from candidates where priority <= $2
     )
     select a.message_id, a.data, a.mime_type, (select count(*)::int from candidates) as total_count
     from selected s join chat_attachment a on a.id = s.id
     where s.total_bytes <= $3 order by s.priority`,
    [
      messageIds,
      attachmentLimits.maxPromptImages,
      attachmentLimits.promptImageBytes,
    ],
  )
  for (const row of result.rows) {
    if (!row.data) continue
    const list = images.get(row.message_id) ?? []
    list.push(`data:${row.mime_type};base64,${row.data.toString('base64')}`)
    images.set(row.message_id, list)
  }
  return {
    images,
    limited: (result.rows[0]?.total_count ?? 0) > result.rows.length,
  }
}
