import 'server-only'

import { PgBoss } from 'pg-boss'
import type { Db } from 'pg-boss'
import type { PoolClient } from 'pg'
import { config } from '../config'
import { logger } from '../logging'

export const ocrQueueName = 'chat-pdf-ocr'
export const ocrDeadLetterQueueName = 'chat-pdf-ocr-failed'

export type OcrJobData = {
  attachmentId: string
  generation: string
}

const runtime = globalThis as typeof globalThis & {
  velinOcrQueue?: Promise<PgBoss>
}

async function createQueue() {
  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    application_name: 'velin-ocr-queue',
    schema: 'pgboss',
    max: 5,
  })
  boss.on('error', (error: unknown) => {
    logger.error('ocr.queue_error', { error })
  })
  try {
    const started = await boss.start()
    await started.createQueue('chat-context-maintenance', {
      retryLimit: 3,
      retryDelay: 15,
      retryBackoff: true,
      expireInSeconds: 420,
      deleteAfterSeconds: 86400,
    })
    await started.createQueue(ocrDeadLetterQueueName)
    const options = {
      retryLimit: 1,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 2 * 60 * 60,
      heartbeatSeconds: 60,
      deleteAfterSeconds: 60 * 60,
      deadLetter: ocrDeadLetterQueueName,
    }
    await started.createQueue(ocrQueueName, options)
    await started.updateQueue(ocrQueueName, options)
    return started
  } catch (error) {
    await boss.stop({ graceful: false, close: true }).catch(() => {})
    throw error
  }
}

export function getOcrQueue() {
  if (!runtime.velinOcrQueue) {
    const pending = createQueue()
    runtime.velinOcrQueue = pending
    void pending.catch(() => {
      if (runtime.velinOcrQueue === pending) runtime.velinOcrQueue = undefined
    })
  }
  return runtime.velinOcrQueue
}

export function pgBossDb(client: PoolClient): Db {
  return {
    executeSql: async (text, values) => {
      const result = await client.query(text, values)
      return { rows: result.rows }
    },
  }
}

export async function enqueuePdfOcr(
  attachmentId: string,
  generation: string,
  client?: PoolClient,
) {
  const boss = await getOcrQueue()
  const data: OcrJobData = { attachmentId, generation }
  const jobId = await boss.send(ocrQueueName, data, {
    id: generation,
    retryLimit: 1,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 2 * 60 * 60,
    ...(client ? { db: pgBossDb(client) } : {}),
  })
  if (jobId === null) throw new Error('OCR job could not be enqueued.')
  return jobId
}

export async function stopOcrQueue() {
  const pending = runtime.velinOcrQueue
  runtime.velinOcrQueue = undefined
  if (!pending) return
  const boss = await pending.catch(() => null)
  await boss
    ?.stop({ graceful: true, timeout: 10_000, close: true })
    .catch(() => {})
}
