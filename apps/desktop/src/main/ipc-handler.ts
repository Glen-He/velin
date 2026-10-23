import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { executeIpc } from './ipc-result'
import { logIpcFailure } from './logging'

export function handleIpc(
  channel: string,
  listener: (
    event: IpcMainInvokeEvent,
    ...payload: unknown[]
  ) => unknown | Promise<unknown>,
) {
  ipcMain.handle(channel, (event, ...payload: unknown[]) =>
    executeIpc(
      () => listener(event, ...payload),
      (name) => logIpcFailure(channel, name),
    ),
  )
}
