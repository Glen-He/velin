// Main 只记录固定事件和分类，不输出原始异常、URL、Cookie 或请求参数。
export function logIpcFailure(channel: string, name: string) {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'ipc.failed',
      message: 'IPC operation failed',
      channel,
      error: { name },
    }),
  )
}
