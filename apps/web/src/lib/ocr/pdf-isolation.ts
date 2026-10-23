import 'server-only'
import { fork } from 'node:child_process'
import { resolve } from 'node:path'
import { attachmentLimits } from '@velin/contracts/attachments'
import { z } from 'zod'
import { PdfOcrInputError, type PdfPlan } from './pdf'

const planSchema = z.object({
  pageCount: z.number().int().min(1).max(attachmentLimits.pdfPages),
  pages: z
    .array(
      z.object({
        pageNumber: z.number().int().min(1).max(attachmentLimits.pdfPages),
        type: z.enum(['text', 'ocr', 'outside', 'empty']),
        text: z.string().max(attachmentLimits.characters * 2),
      }),
    )
    .max(attachmentLimits.pdfPages),
  requestedPages: z.array(z.number()),
  outsideRangePages: z.array(z.number()),
  ocrPageNumbers: z.array(z.number()),
  processablePageCount: z.number(),
})

function runPdfWorker(
  task: 'analyze' | 'images',
  bytes: Uint8Array,
  pages: number[] | undefined,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolveResult, reject) => {
    if (signal?.aborted) {
      reject(new Error('PDF processing aborted.'))
      return
    }
    const child = fork(resolve(process.cwd(), 'scripts/pdf-worker.ts'), [], {
      execArgv: [
        '--max-old-space-size=512',
        '--conditions=react-server',
        '--import',
        'tsx',
      ],
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TMPDIR: process.env.TMPDIR,
        TEMP: process.env.TEMP,
      },
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    let settled = false
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      child.kill('SIGKILL')
      if (error) reject(error)
      else resolveResult(result)
    }
    const abort = () => finish(new Error('PDF processing aborted.'))
    const timer = setTimeout(
      () => finish(new PdfOcrInputError('PDF 解析超时，请精简后重试。')),
      attachmentLimits.processingTimeoutMs,
    )
    signal?.addEventListener('abort', abort, { once: true })
    child.once('message', (value: unknown) => finish(undefined, value))
    child.once('error', () => finish(new Error('PDF process unavailable.')))
    child.once('exit', () =>
      finish(
        new PdfOcrInputError('PDF 超出解析资源限制或格式无效，请精简后重试。'),
      ),
    )
    child.send({ task, bytes, pages }, (error) => {
      if (error) finish(new Error('PDF process IPC failed.'))
    })
  })
}

export async function analyzePdfIsolated(
  bytes: Uint8Array,
  pages?: number[],
  signal?: AbortSignal,
): Promise<PdfPlan> {
  const value = await runPdfWorker('analyze', bytes, pages, signal)
  if (
    z
      .object({ ok: z.literal(false), inputError: z.literal(false) })
      .safeParse(value).success
  )
    throw new Error('PDF analysis process failed.')
  const result = z
    .object({ ok: z.literal(true), plan: planSchema })
    .safeParse(value)
  if (!result.success)
    throw new PdfOcrInputError('无法读取该 PDF，可能已加密或格式无效。')
  return result.data.plan
}

export async function extractPdfPageImagesIsolated(
  bytes: Uint8Array,
  pages: number[],
  signal?: AbortSignal,
) {
  const value = await runPdfWorker('images', bytes, pages, signal)
  if (
    z
      .object({ ok: z.literal(false), inputError: z.literal(false) })
      .safeParse(value).success
  )
    throw new Error('PDF image process failed.')
  const result = z
    .object({
      ok: z.literal(true),
      images: z.map(z.number(), z.array(z.instanceof(Uint8Array))),
    })
    .safeParse(value)
  if (!result.success) throw new PdfOcrInputError('无法读取 PDF 页面图像。')
  return new Map(
    [...result.data.images].map(([page, buffers]) => [
      page,
      buffers.map((buffer) => Buffer.from(buffer)),
    ]),
  )
}
