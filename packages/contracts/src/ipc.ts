export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string } }
