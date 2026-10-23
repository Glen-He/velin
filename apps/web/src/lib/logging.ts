import { requestContext } from './http/request-context'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const messages = {
  'server.shutdown_failed': 'Velin web server shutdown failed',
  'server.started': 'Velin web server started',
  'server.shutdown_requested': 'Velin web server shutdown requested',
  'http.request_failed': 'HTTP request could not be completed',
  'http.completed': 'HTTP request completed',
  'database.pool_error': 'Unexpected database pool error',
  'avatar.save_failed': 'Avatar could not be saved',
  'avatar.read_failed': 'Avatar could not be read',
  'chat.context_failed': 'Conversation context maintenance failed',
  'chat.context_finished': 'Conversation context maintenance finished',
  'chat.context_stage': 'Conversation context preparation stage finished',
  'chat.first_output': 'First chat output reached the response stream',
  'chat.recall_degraded': 'Conversation recall used a reduced retrieval path',
  'chat.auxiliary_format_retry':
    'Auxiliary response format required one bounded retry',
  'chat.quota_failed': 'Chat quota could not be checked',
  'chat.usage_failed': 'Chat usage could not be recorded',
  'chat.turn_failed': 'Chat turn could not be persisted',
  'chat.persistence_failed': 'Chat response could not be persisted',
  'chat.title_failed': 'Chat title could not be generated',
  'chat.upstream_failed': 'Model generation request failed',
  'chat.generation_finished': 'Model generation lifecycle finished',
  'ocr.queue_error': 'OCR queue operation failed',
  'ocr.processing_failed': 'PDF OCR processing failed',
  'ocr.processing_finished': 'PDF OCR processing lifecycle finished',
  'ocr.cache_prune_failed': 'PDF OCR page cache could not be pruned',
  'ocr.worker_started': 'OCR worker started',
  'ocr.worker_start_failed': 'OCR worker could not start',
  'ocr.worker_shutdown_requested': 'OCR worker shutdown requested',
  'auth.email_preview': 'Development authentication email prepared',
  'auth.library_event': 'Authentication library reported an event',
  'maintenance.failed': 'Background data maintenance failed',
} as const

type LogEvent = keyof typeof messages
type LogFields = {
  origin?: string
  signal?: string
  recipient?: string
  purpose?: string
  error?: unknown
  durationMs?: number
  status?: number
  generationId?: string
  attachmentId?: string
  attemptId?: string
  model?: string
  outcome?: 'completed' | 'incomplete' | 'failed' | 'cancelled'
  inputTokens?: number | null
  outputTokens?: number | null
}

type LogSink = (level: LogLevel, line: string) => void

function errorSummary(cause: unknown) {
  if (!(cause instanceof Error)) return { name: 'UnknownError' }
  const code = 'code' in cause ? cause.code : undefined
  const status = 'status' in cause ? cause.status : undefined
  return {
    name: /^[A-Za-z][A-Za-z0-9]*$/.test(cause.name)
      ? cause.name
      : 'UnknownError',
    ...(typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code)
      ? { code }
      : {}),
    ...(typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
      ? { status }
      : {}),
  }
}

// 不展开调用方对象或 Error：上游可能附带密码、SQL 参数与请求内容。
export function createLogger(
  sink: LogSink = (level, line) => console[level](line),
) {
  function write(level: LogLevel, event: LogEvent, fields: LogFields = {}) {
    sink(
      level,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event,
        message: messages[event],
        requestId: requestContext.getStore()?.requestId,
        origin: fields.origin,
        signal: fields.signal,
        recipient: fields.recipient,
        purpose: fields.purpose,
        durationMs: fields.durationMs,
        status: fields.status,
        generationId: fields.generationId,
        attachmentId: fields.attachmentId,
        attemptId: fields.attemptId,
        model: fields.model,
        outcome: fields.outcome,
        inputTokens: fields.inputTokens,
        outputTokens: fields.outputTokens,
        ...(fields.error === undefined
          ? {}
          : { error: errorSummary(fields.error) }),
      }),
    )
  }
  return {
    write,
    info: (event: LogEvent, fields?: LogFields) => write('info', event, fields),
    error: (event: LogEvent, fields?: LogFields) =>
      write('error', event, fields),
  }
}

export const logger = createLogger()
