type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const messages = {
  'server.shutdown_failed': 'Velin web server shutdown failed',
  'server.started': 'Velin web server started',
  'server.shutdown_requested': 'Velin web server shutdown requested',
  'http.request_failed': 'HTTP request could not be completed',
  'database.pool_error': 'Unexpected database pool error',
  'avatar.save_failed': 'Avatar could not be saved',
  'avatar.read_failed': 'Avatar could not be read',
  'chat.quota_failed': 'Chat quota could not be checked',
  'chat.usage_failed': 'Chat usage could not be recorded',
  'auth.email_preview': 'Development authentication email prepared',
  'auth.library_event': 'Authentication library reported an event',
} as const

type LogEvent = keyof typeof messages
type LogFields = {
  origin?: string
  signal?: string
  recipient?: string
  purpose?: string
  error?: unknown
}

type LogSink = (level: LogLevel, line: string) => void

function errorSummary(cause: unknown) {
  if (!(cause instanceof Error)) return { name: 'UnknownError' }
  const code = 'code' in cause ? cause.code : undefined
  return {
    name: /^[A-Za-z][A-Za-z0-9]*$/.test(cause.name)
      ? cause.name
      : 'UnknownError',
    ...(typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code)
      ? { code }
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
        origin: fields.origin,
        signal: fields.signal,
        recipient: fields.recipient,
        purpose: fields.purpose,
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
