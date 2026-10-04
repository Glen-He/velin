import { errorMessage } from '@velin/contracts/error-copy'

type AuthResult<T> = { data: T; error?: unknown }
export type AuthAction = {
  signal: AbortSignal
  wait: <T>(promise: Promise<T>) => Promise<T>
  result: <T>(promise: Promise<AuthResult<T>>) => Promise<T>
}

// 登录入口共用互斥与生命周期；即使传输不响应取消，旧结果也不能继续下一步。
export function createAuthActionRunner({
  onPending,
  onError,
}: {
  onPending: (pending: boolean) => void
  onError: (message: string) => void
}) {
  let lifetime: AbortController | null = null
  let pending: AbortController | null = null

  function deactivate() {
    lifetime?.abort()
    lifetime = null
    pending = null
  }

  return {
    activate() {
      deactivate()
      lifetime = new AbortController()
    },
    deactivate,
    isPending: () => pending !== null,
    async run(
      operation: (action: AuthAction) => Promise<void>,
      fallback: string,
    ) {
      if (!lifetime || pending) return
      const owner = lifetime
      pending = owner
      onPending(true)
      async function wait<T>(promise: Promise<T>) {
        const value = await promise
        owner.signal.throwIfAborted()
        return value
      }
      try {
        await operation({
          signal: owner.signal,
          wait,
          async result<T>(promise: Promise<AuthResult<T>>) {
            const result = await wait(promise)
            if (result.error) throw result.error
            return result.data
          },
        })
      } catch (cause) {
        if (!owner.signal.aborted) onError(errorMessage(cause, fallback))
      } finally {
        // Strict Mode 重挂或页面离开后，不清掉后来启动的请求占用。
        if (lifetime === owner && pending === owner) {
          pending = null
          onPending(false)
        }
      }
    },
  }
}
