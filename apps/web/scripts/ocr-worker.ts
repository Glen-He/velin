import { logger } from '../src/lib/logging'
import { stopOcrQueue } from '../src/lib/ocr/queue'
import { startOcrWorker } from '../src/lib/ocr/worker-runtime'
import { startMaintenance, startWorkerHeartbeat } from '../src/lib/maintenance'
import { databasePool } from '../src/lib/database/connection'
import { assertDatabaseSchema } from '../src/lib/database/schema'
import { startContextWorker } from '../src/lib/chat/context-jobs'

try {
  await assertDatabaseSchema(databasePool)
  await startOcrWorker()
  await startContextWorker()
} catch (error) {
  logger.error('ocr.worker_start_failed', { error })
  process.exit(1)
}

let stopping = false
const stopMaintenance = startMaintenance()
const stopHeartbeat = startWorkerHeartbeat()
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  logger.info('ocr.worker_shutdown_requested', { signal })
  await stopMaintenance()
  await stopHeartbeat()
  await stopOcrQueue()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
