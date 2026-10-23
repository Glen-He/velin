import { ipcRenderer } from 'electron'
import { isRecord } from '@velin/contracts/value'

// 仅供本地窄接口组装，不暴露给 Renderer。
export async function invoke<T>(
  channel: string,
  ...payload: unknown[]
): Promise<T> {
  let result: unknown
  try {
    result = await ipcRenderer.invoke(channel, ...payload)
  } catch {
    throw new Error('桌面连接已中断，请重新打开窗口后重试。')
  }
  if (!isRecord(result) || typeof result.ok !== 'boolean')
    throw new Error('桌面返回的数据不完整，请重新打开窗口。')
  if (!result.ok) {
    const message =
      isRecord(result.error) &&
      typeof result.error.message === 'string' &&
      result.error.message.length <= 500
        ? result.error.message
        : '操作暂时无法完成，请稍后重试。'
    throw new Error(message)
  }
  return result.value as T
}
