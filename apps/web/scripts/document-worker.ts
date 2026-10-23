import { z } from 'zod'
import { attachmentLimits, isImageMimeType } from '@velin/contracts/attachments'
import { extractAttachmentText } from '../src/lib/documents/extract'

const inputSchema = z
  .object({
    mimeType: z.string().max(100),
    bytes: z
      .instanceof(Uint8Array)
      .refine((value) => value.length <= attachmentLimits.fileBytes),
  })
  .strict()

function sendResult(value: unknown) {
  return new Promise<void>((resolve, reject) => {
    if (!process.send) {
      reject(new Error('Document result channel unavailable.'))
      return
    }
    process.send(value, (error) => (error ? reject(error) : resolve()))
  })
}

process.once('message', async (value: unknown) => {
  try {
    const input = inputSchema.parse(value)
    if (isImageMimeType(input.mimeType)) {
      const sharp = (await import('sharp')).default
      const image = sharp(input.bytes, {
        limitInputPixels: attachmentLimits.imagePixels,
        failOn: 'error',
      })
      const meta = await image.metadata()
      const expected =
        input.mimeType === 'image/jpeg' ? 'jpeg' : input.mimeType.slice(6)
      if (
        meta.format !== expected ||
        !meta.width ||
        !meta.height ||
        meta.width > attachmentLimits.imageDimension ||
        meta.height > attachmentLimits.imageDimension ||
        (meta.pages ?? 1) > 1
      )
        throw new Error('图片格式或尺寸无效，请缩小后重试。')
      const thumbnail = await image
        .rotate()
        .resize({
          width: 240,
          height: 240,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82 })
        .toBuffer()
      await sendResult({
        ok: true,
        text: '',
        thumbnail: `data:image/jpeg;base64,${thumbnail.toString('base64')}`,
      })
    } else {
      const text = await extractAttachmentText(input.mimeType, input.bytes)
      await sendResult({ ok: true, text })
    }
  } catch {
    // 子进程只返回固定文案，不跨进程传播库的错误对象或输入片段。
    await sendResult({
      ok: false,
      message: '文件无法安全解析，可能过大、已加密或格式无效。',
    }).catch(() => {})
  } finally {
    process.disconnect?.()
  }
})
