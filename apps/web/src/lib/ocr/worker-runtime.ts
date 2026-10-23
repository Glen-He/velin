import 'server-only'

import type { Job } from 'pg-boss'
import { databasePool } from '../database/connection'
import { logger } from '../logging'
import { processPdfAttachment } from './process'
import {
  getOcrQueue,
  ocrDeadLetterQueueName,
  ocrQueueName,
  type OcrJobData,
} from './queue'

function jobData(job: Job<OcrJobData>): OcrJobData {
  const data = job.data
  if (
    typeof data?.attachmentId !== 'string' ||
    typeof data.generation !== 'string'
  ) {
    throw new Error('Invalid OCR job data.')
  }
  return data
}

export async function startOcrWorker() {
  const boss = await getOcrQueue()
  await boss.work<OcrJobData>(
    ocrDeadLetterQueueName,
    { localConcurrency: 1, batchSize: 1 },
    async (jobs: Job<OcrJobData>[]) => {
      for (const job of jobs) {
        const { attachmentId, generation } = jobData(job)
        // 最终重试失败也必须结束附件状态；旧 generation 和重复投递均不生效。
        await databasePool.query(
          `update chat_attachment
           set status = 'failed', text_content = '', ocr_attempt_id = null,
               ocr_error = $3
           where id = $1 and ocr_generation = $2
             and status = 'processing' and message_id is null`,
          [
            attachmentId,
            generation,
            'PDF 识别失败，请稍后重试或重新选择页码。',
          ],
        )
      }
    },
  )
  await boss.work<OcrJobData>(
    ocrQueueName,
    { localConcurrency: 1, batchSize: 1 },
    async (jobs: Job<OcrJobData>[]) => {
      for (const job of jobs) {
        const { attachmentId, generation } = jobData(job)
        await processPdfAttachment(attachmentId, generation, job.signal)
      }
    },
  )
  logger.info('ocr.worker_started')
  return boss
}
