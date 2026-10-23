import 'server-only'

import { parseOcrPageRange } from '@velin/contracts/attachments'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { databasePool } from '../database/connection'
import { logger } from '../logging'
import {
  assemblePdfText,
  capPdfText,
  PdfOcrInputError,
  PdfOcrSession,
  PdfOcrTimeoutError,
  pdfOcrBudgetMs,
  pdfOcrEngineVersion,
  stripRepeatedOcrMargins,
  type PdfOcrPageResult,
} from './pdf'
import {
  analyzePdfIsolated,
  extractPdfPageImagesIsolated,
} from './pdf-isolation'
import { prunePdfPageCache } from './cache'

const ocrBatchSize = 10

class OcrAttemptStopped extends Error {}

type OcrAttempt = {
  attachmentId: string
  generation: string
  attemptId: string
  signal?: AbortSignal
}

type ProcessingAttachment = {
  userId: string
  sha256: string
  data: Buffer
  requestedPages: number[] | undefined
}

type PageRow = {
  page_number: number
  source: 'text' | 'ocr' | 'empty'
  text_content: string
  confidence: number | null
}

function checkSignal(attempt: OcrAttempt) {
  if (attempt.signal?.aborted) throw new OcrAttemptStopped()
}

async function claimProcessingAttachment(
  attempt: OcrAttempt,
): Promise<ProcessingAttachment | null> {
  checkSignal(attempt)
  const result = await databasePool.query<{
    user_id: string
    ocr_page_range: string | null
    sha256: string | null
    data: Buffer | null
  }>(
    `with claimed as (
       update chat_attachment
       set ocr_attempt_id = $3
       where id = $1 and ocr_generation = $2
         and message_id is null and status = 'processing'
       returning id, user_id, ocr_page_range
     )
     select a.user_id, a.ocr_page_range, s.sha256, s.data
     from claimed a
     left join chat_attachment_source s on s.attachment_id = a.id`,
    [attempt.attachmentId, attempt.generation, attempt.attemptId],
  )
  checkSignal(attempt)
  const row = result.rows[0]
  if (!row) return null
  if (row.sha256 === null || row.data === null) {
    throw new Error('OCR attachment source is unavailable.')
  }
  const range = row.ocr_page_range
    ? parseOcrPageRange(row.ocr_page_range)
    : null
  return {
    userId: row.user_id,
    sha256: row.sha256,
    data: row.data,
    requestedPages: range?.ok ? range.pages : undefined,
  }
}

async function withAttempt<T>(
  attempt: OcrAttempt,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  checkSignal(attempt)
  const client = await databasePool.connect()
  let discardClient = false
  try {
    await client.query('begin')
    // 与取消、重新 OCR、下一次 claim 共用附件行锁，检查与写入不可分离。
    const current = await client.query(
      `select id from chat_attachment
       where id = $1 and ocr_generation = $2 and ocr_attempt_id = $3
         and status = 'processing' and message_id is null
       for update`,
      [attempt.attachmentId, attempt.generation, attempt.attemptId],
    )
    if (current.rows.length === 0) throw new OcrAttemptStopped()
    checkSignal(attempt)
    const result = await callback(client)
    checkSignal(attempt)
    await client.query('commit')
    return result
  } catch (error) {
    try {
      await client.query('rollback')
    } catch {
      discardClient = true
    }
    throw error
  } finally {
    client.release(discardClient)
  }
}

async function checkAttempt(attempt: OcrAttempt) {
  await withAttempt(attempt, async () => {})
}

async function loadPageRows(attempt: OcrAttempt) {
  return withAttempt(attempt, async (client) => {
    const rows = await client.query<PageRow>(
      `select page_number, source, text_content, confidence
       from chat_attachment_page
       where attachment_id = $1 and engine_version = $2`,
      [attempt.attachmentId, pdfOcrEngineVersion],
    )
    return new Map(rows.rows.map((row) => [row.page_number, row]))
  })
}

async function loadPageCache(
  attempt: OcrAttempt,
  userId: string,
  sha256: string,
  pageNumbers: number[],
) {
  return withAttempt(attempt, async (client) => {
    if (pageNumbers.length === 0) return new Map<number, PageRow>()
    const rows = await client.query<PageRow>(
      `select page_number, source, text_content, confidence
       from chat_pdf_page_cache
       where user_id = $1 and sha256 = $2 and engine_version = $3
         and page_number = any($4::int[])
         and source = 'ocr' and text_content <> ''`,
      [userId, sha256, pdfOcrEngineVersion, pageNumbers],
    )
    return new Map(rows.rows.map((row) => [row.page_number, row]))
  })
}

async function writePageRow(
  client: PoolClient,
  attachmentId: string,
  pageNumber: number,
  source: PageRow['source'],
  text: string,
  confidence: number | null,
) {
  await client.query(
    `insert into chat_attachment_page
       (attachment_id, page_number, source, text_content, confidence,
        engine_version)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (attachment_id, page_number) do update set
       source = excluded.source,
       text_content = excluded.text_content,
       confidence = excluded.confidence,
       engine_version = excluded.engine_version,
       updated_at = now()`,
    [attachmentId, pageNumber, source, text, confidence, pdfOcrEngineVersion],
  )
}

async function writePageCache(
  client: PoolClient,
  userId: string,
  sha256: string,
  pageNumber: number,
  result: PdfOcrPageResult,
) {
  await client.query(
    `insert into chat_pdf_page_cache
       (user_id, sha256, engine_version, page_number, source, text_content, confidence)
     values ($1, $2, $3, $4, 'ocr', $5, $6)
     on conflict (user_id, sha256, engine_version, page_number) do update set
       source = excluded.source,
       text_content = excluded.text_content,
       confidence = excluded.confidence,
       updated_at = now()`,
    [
      userId,
      sha256,
      pdfOcrEngineVersion,
      pageNumber,
      result.text,
      result.confidence ?? null,
    ],
  )
}

async function updateProgress(
  attempt: OcrAttempt,
  completedPages: number,
  totalPages: number,
) {
  await withAttempt(attempt, async (client) => {
    await client.query(
      `update chat_attachment
       set ocr_completed_pages = $2, ocr_total_pages = $3
       where id = $1`,
      [attempt.attachmentId, completedPages, totalPages],
    )
  })
}

async function setPageCount(
  attempt: OcrAttempt,
  pageCount: number,
  totalPages: number,
) {
  await withAttempt(attempt, async (client) => {
    await client.query(
      `update chat_attachment
       set page_count = $2, ocr_total_pages = $3, ocr_completed_pages = 0
       where id = $1`,
      [attempt.attachmentId, pageCount, totalPages],
    )
  })
}

async function markReady(
  attempt: OcrAttempt,
  text: string,
  pageCount: number,
  totalPages: number,
  completedPages: number,
  warning: string | null,
) {
  await withAttempt(attempt, async (client) => {
    await client.query(
      `update chat_attachment
       set text_content = $2, status = 'ready', page_count = $3,
           ocr_total_pages = $4, ocr_completed_pages = $5,
           ocr_error = $6, ocr_attempt_id = null
       where id = $1`,
      [
        attempt.attachmentId,
        text,
        pageCount,
        totalPages,
        completedPages,
        warning,
      ],
    )
  })
}

async function markCanceled(
  attempt: OcrAttempt,
  totalPages: number,
  completedPages: number,
) {
  await withAttempt(attempt, async (client) => {
    await client.query(
      `update chat_attachment
       set text_content = '', status = 'canceled', ocr_total_pages = $2,
           ocr_completed_pages = $3, ocr_error = $4, ocr_attempt_id = null
       where id = $1`,
      [
        attempt.attachmentId,
        totalPages,
        completedPages,
        '识别时间过长，已暂停；可继续识别。',
      ],
    )
  })
}

async function markFailed(attempt: OcrAttempt, message: string) {
  await withAttempt(attempt, async (client) => {
    await client.query(
      `update chat_attachment
       set text_content = '', status = 'failed', ocr_error = $2,
           ocr_attempt_id = null
       where id = $1`,
      [attempt.attachmentId, message],
    )
  })
}

function pageResultFromRow(row: PageRow): PdfOcrPageResult {
  return {
    text: row.text_content,
    ...(row.confidence !== null ? { confidence: row.confidence } : {}),
  }
}

export async function processPdfAttachment(
  attachmentId: string,
  generation: string,
  signal?: AbortSignal,
) {
  const startedAt = performance.now()
  const attempt: OcrAttempt = {
    attachmentId,
    generation,
    attemptId: randomUUID(),
    signal,
  }
  let claimedUserId: string | null = null
  try {
    const attachment = await claimProcessingAttachment(attempt)
    if (!attachment) return
    claimedUserId = attachment.userId
    try {
      await processPdfAttachmentInternal(attempt, attachment)
    } catch (error) {
      if (!(error instanceof PdfOcrInputError)) throw error
      await markFailed(attempt, error.message)
    }
  } catch (error) {
    if (error instanceof OcrAttemptStopped) return
    logger.error('ocr.processing_failed', {
      error,
      attachmentId,
      generationId: generation,
      attemptId: attempt.attemptId,
    })
    // 系统与数据库故障交给 pg-boss 重试，耗尽重试后由 DLQ 收敛终态。
    throw error
  } finally {
    if (claimedUserId) {
      await prunePdfPageCache(claimedUserId).catch((error: unknown) => {
        logger.error('ocr.cache_prune_failed', { error })
      })
      logger.info('ocr.processing_finished', {
        attachmentId,
        generationId: generation,
        attemptId: attempt.attemptId,
        durationMs: Math.round(performance.now() - startedAt),
      })
    }
  }
}

async function processPdfAttachmentInternal(
  attempt: OcrAttempt,
  attachment: ProcessingAttachment,
) {
  await checkAttempt(attempt)
  const plan = await analyzePdfIsolated(
    attachment.data,
    attachment.requestedPages,
    attempt.signal,
  )
  await setPageCount(attempt, plan.pageCount, plan.processablePageCount)

  const existingPages = await loadPageRows(attempt)
  const existingOcrPages = new Map(
    [...existingPages].filter(
      ([, row]) => row.source === 'ocr' && row.text_content.length > 0,
    ),
  )
  const results = new Map<number, PdfOcrPageResult>()
  const failures = new Set<number>()
  let completedPages = 0

  const ocrPages = plan.pages.filter((page) => page.type === 'ocr')
  const missingOcrPages = ocrPages
    .filter((page) => !existingOcrPages.has(page.pageNumber))
    .map((page) => page.pageNumber)
  const cachedPages = await loadPageCache(
    attempt,
    attachment.userId,
    attachment.sha256,
    missingOcrPages,
  )

  await withAttempt(attempt, async (client) => {
    for (const page of plan.pages) {
      if (page.type !== 'text' && page.type !== 'empty') continue
      if (!existingPages.has(page.pageNumber)) {
        await writePageRow(
          client,
          attempt.attachmentId,
          page.pageNumber,
          page.type,
          page.type === 'text' ? page.text : '',
          null,
        )
      }
      completedPages += 1
    }
    for (const page of ocrPages) {
      const existing = existingOcrPages.get(page.pageNumber)
      const cached = cachedPages.get(page.pageNumber)
      const row = existing ?? cached
      if (!row) continue
      if (!existing) {
        await writePageRow(
          client,
          attempt.attachmentId,
          page.pageNumber,
          'ocr',
          row.text_content,
          row.confidence,
        )
      }
      results.set(page.pageNumber, pageResultFromRow(row))
      completedPages += 1
    }
  })

  await updateProgress(attempt, completedPages, plan.processablePageCount)
  const pendingOcrPages = ocrPages.filter(
    (page) =>
      !existingOcrPages.has(page.pageNumber) &&
      !cachedPages.has(page.pageNumber),
  )

  let timedOut = false
  const deadline = Date.now() + pdfOcrBudgetMs
  let session: PdfOcrSession | null = null
  let abortTermination: Promise<void> | undefined
  const onAbort = () => {
    abortTermination = session?.terminate()
  }

  try {
    if (pendingOcrPages.length > 0) {
      await checkAttempt(attempt)
      session = await PdfOcrSession.create()
      attempt.signal?.addEventListener('abort', onAbort, { once: true })
      if (attempt.signal?.aborted) onAbort()
      await checkAttempt(attempt)
    }

    for (
      let batchStart = 0;
      batchStart < pendingOcrPages.length;
      batchStart += ocrBatchSize
    ) {
      await checkAttempt(attempt)
      if (Date.now() >= deadline) {
        timedOut = true
        break
      }

      const batch = pendingOcrPages.slice(batchStart, batchStart + ocrBatchSize)
      const batchNumbers = batch.map((page) => page.pageNumber)
      let pageImages: Map<number, Buffer[]>
      try {
        pageImages = await extractPdfPageImagesIsolated(
          attachment.data,
          batchNumbers,
          attempt.signal,
        )
      } catch (error) {
        if (!(error instanceof PdfOcrInputError)) throw error
        for (const page of batch) {
          failures.add(page.pageNumber)
          completedPages += 1
        }
        await updateProgress(attempt, completedPages, plan.processablePageCount)
        continue
      }

      for (const page of batch) {
        await checkAttempt(attempt)
        if (Date.now() >= deadline) {
          timedOut = true
          break
        }

        const images = pageImages.get(page.pageNumber) ?? []
        if (images.length === 0) {
          // OCR 候选页没有图像是本次失败，不写 empty，下一次仍可重试。
          failures.add(page.pageNumber)
          completedPages += 1
          await updateProgress(
            attempt,
            completedPages,
            plan.processablePageCount,
          )
          continue
        }

        if (!session) throw new Error('OCR session is not ready.')
        let result: PdfOcrPageResult | undefined
        let pageTimedOut = false
        try {
          result = await session.recognize(images)
        } catch (error) {
          checkSignal(attempt)
          pageTimedOut = error instanceof PdfOcrTimeoutError
        }
        if (pageTimedOut) {
          await checkAttempt(attempt)
          // 重建 worker 的系统故障不能被当成单页识别失败吞掉。
          await session.reset()
          await checkAttempt(attempt)
        }
        if (result?.text) {
          const recognized = result
          // 页结果与缓存共用同一授权边界；数据库异常必须触发队列重试。
          await withAttempt(attempt, async (client) => {
            await writePageRow(
              client,
              attempt.attachmentId,
              page.pageNumber,
              'ocr',
              recognized.text,
              recognized.confidence ?? null,
            )
            await writePageCache(
              client,
              attachment.userId,
              attachment.sha256,
              page.pageNumber,
              recognized,
            )
          })
          results.set(page.pageNumber, result)
        } else {
          failures.add(page.pageNumber)
        }
        completedPages += 1
        await updateProgress(attempt, completedPages, plan.processablePageCount)
      }
      if (timedOut) break
    }

    if (timedOut) {
      await markCanceled(attempt, plan.processablePageCount, completedPages)
      return
    }

    // 去页眉只影响本次组装，页表与跨附件缓存永久保留单页原始识别文本。
    stripRepeatedOcrMargins(results)
    const hasUsableText =
      plan.pages.some((page) => page.type === 'text' && page.text) ||
      results.size > 0
    if (!hasUsableText) {
      await markFailed(
        attempt,
        ocrPages.length > 0
          ? '扫描版 PDF 未能识别出文本，请确认扫描清晰度。'
          : 'PDF 没有可读取的文本内容。',
      )
      return
    }

    const assembled = assemblePdfText({
      plan,
      results,
      failures: [...failures],
    })
    const text = capPdfText(assembled, plan.pageCount)
    if (!text) {
      await markFailed(attempt, 'PDF 没有可读取的文本内容。')
      return
    }

    await markReady(
      attempt,
      text,
      plan.pageCount,
      plan.processablePageCount,
      completedPages,
      failures.size > 0 ? '部分页面 OCR 失败，可在 OCR 页码中重试。' : null,
    )
  } finally {
    attempt.signal?.removeEventListener('abort', onAbort)
    await abortTermination
    await session?.terminate()
  }
}
