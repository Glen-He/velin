import { z } from 'zod'
import { attachmentLimits } from '@velin/contracts/attachments'
import {
  analyzePdf,
  extractPdfPageImages,
  PdfOcrInputError,
} from '../src/lib/ocr/pdf'

const schema = z
  .object({
    task: z.enum(['analyze', 'images']),
    bytes: z
      .instanceof(Uint8Array)
      .refine((value) => value.byteLength <= attachmentLimits.fileBytes),
    pages: z
      .array(z.number().int().min(1).max(attachmentLimits.pdfPages))
      .max(attachmentLimits.pdfPages)
      .optional(),
  })
  .strict()

function sendResult(value: unknown) {
  return new Promise<void>((resolve, reject) => {
    if (!process.send) {
      reject(new Error('PDF result channel unavailable.'))
      return
    }
    process.send(value, (error) => (error ? reject(error) : resolve()))
  })
}

process.once('message', async (value: unknown) => {
  try {
    const input = schema.parse(value)
    if (input.task === 'analyze') {
      const plan = await analyzePdf(input.bytes, input.pages)
      // 页计划只跨进程传输有限文本；最终发送预算仍由正文组装和上下文层执行。
      let remaining = attachmentLimits.characters * 2
      for (const page of plan.pages) {
        page.text = page.text.slice(0, Math.max(remaining, 0))
        remaining -= page.text.length
      }
      await sendResult({ ok: true, plan })
    } else {
      const images = await extractPdfPageImages(input.bytes, input.pages ?? [])
      let total = 0
      for (const buffers of images.values()) {
        for (const buffer of buffers) total += buffer.byteLength
      }
      if (total > attachmentLimits.archiveBytes)
        throw new PdfOcrInputError('PDF 页面图像过大，请缩小后重试。')
      await sendResult({ ok: true, images })
    }
  } catch (error) {
    await sendResult({
      ok: false,
      inputError: error instanceof PdfOcrInputError,
    }).catch(() => {})
  } finally {
    process.disconnect?.()
  }
})
