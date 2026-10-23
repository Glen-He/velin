import { UserFacingError } from '@velin/contracts/error-copy'
import type { IpcResult } from '@velin/contracts/ipc'

export async function executeIpc<T>(
  action: () => T | Promise<T>,
  report: (name: string) => void,
): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await action() }
  } catch (error) {
    const name =
      error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
        ? error.name
        : 'UnknownError'
    report(name)
    const message =
      error instanceof UserFacingError &&
      error.message.length <= 500 &&
      /\p{Script=Han}/u.test(error.message)
        ? error.message
        : '操作暂时无法完成，请稍后重试。'
    return { ok: false, error: { message } }
  }
}
