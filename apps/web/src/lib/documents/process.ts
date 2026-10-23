import 'server-only'
import { resolve } from 'node:path'
import { z } from 'zod'
import { attachmentLimits } from '@velin/contracts/attachments'

const resultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      text: z.string().max(attachmentLimits.characters + 200),
      thumbnail: z
        .string()
        .max(attachmentLimits.thumbnailCharacters)
        .optional(),
    })
    .strict(),
  z.object({ ok: z.literal(false), message: z.string().max(200) }).strict(),
])

export class DocumentProcessingError extends Error {}

export function processDocument(
  mimeType: string,
  bytes: Uint8Array,
  signal?: AbortSignal,
) {
  // 使用真实 Node 入口；Next 的 fork 静态追踪会把 TS 子进程路径改写为打包模块路径。
  const { fork } = process.getBuiltinModule('node:child_process')
  return new Promise<{ text: string; thumbnail?: string }>(
    (resolveResult, reject) => {
      if (signal?.aborted) {
        reject(new DocumentProcessingError('文件处理已取消。'))
        return
      }
      const child = fork(
        resolve(process.cwd(), 'scripts/document-worker.ts'),
        [],
        {
          execArgv: [
            '--max-old-space-size=256',
            '--conditions=react-server',
            '--import',
            'tsx',
          ],
          // 文档进程不继承数据库、SMTP、模型和认证凭据。
          env: {
            NODE_ENV: process.env.NODE_ENV,
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            TMPDIR: process.env.TMPDIR,
            TEMP: process.env.TEMP,
          },
          serialization: 'advanced',
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      )
      let settled = false
      const finish = (
        error?: Error,
        result?: { text: string; thumbnail?: string },
      ) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        child.kill('SIGKILL')
        if (error) reject(error)
        else resolveResult(result!)
      }
      const abort = () =>
        finish(new DocumentProcessingError('文件处理已取消。'))
      const timer = setTimeout(
        () =>
          finish(
            new DocumentProcessingError('文件处理超时，请精简文件后重试。'),
          ),
        attachmentLimits.processingTimeoutMs,
      )
      signal?.addEventListener('abort', abort, { once: true })
      child.once('message', (value: unknown) => {
        const parsed = resultSchema.safeParse(value)
        if (!parsed.success) {
          finish(new DocumentProcessingError('文件处理返回无效结果。'))
          return
        }
        if (!parsed.data.ok) {
          finish(new DocumentProcessingError(parsed.data.message))
          return
        }
        finish(undefined, parsed.data)
      })
      child.once('error', () =>
        finish(new DocumentProcessingError('文件处理暂时不可用，请稍后重试。')),
      )
      child.once('exit', () =>
        finish(
          new DocumentProcessingError(
            '文件处理超出资源限制或意外中断，请精简后重试。',
          ),
        ),
      )
      child.send({ mimeType, bytes }, (error) => {
        if (error) finish(new DocumentProcessingError('无法开始文件处理。'))
      })
    },
  )
}
