import { useEffect, useRef, useState } from 'react'
import { actionErrorMessage } from '../api/http'
import type { ReactNode } from 'react'
import { SecurityDialog } from './SecurityDialog'
import {
  fetchSecurityState,
  type DialogOperation,
  type OperationRequirement,
  type SecurityState,
} from './security-api'

export type GatedEntry = {
  operation: DialogOperation
  passkeyId?: string
}

// 敏感操作入口：登录与安全总览页和通行密钥管理页共用同一套流程。
export function useGatedActions({
  userId,
  email,
  hasPasskey,
  hasTwoFactor,
  onOpened,
  onCompleted,
}: {
  userId: string | null
  email: string
  hasPasskey: boolean
  hasTwoFactor: boolean
  // 页面用它清掉上一次的分组反馈，避免旧文案留在原地。
  onOpened?: () => void
  onCompleted: (operation: DialogOperation, message?: string) => void
}) {
  const [security, setSecurity] = useState<SecurityState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const pendingRequest = useRef<AbortSignal | null>(null)
  const scopeController = useRef<AbortController | null>(null)
  const [scope, setScope] = useState(userId)
  const [opening, setOpening] = useState<GatedEntry | null>(null)
  const [entry, setEntry] = useState<GatedEntry | null>(null)
  // 账号变化立即重置所属界面；外部请求由下方的账号生命周期取消。
  if (scope !== userId) {
    setScope(userId)
    setSecurity(null)
    setLoadError(null)
    setOpening(null)
    setEntry(null)
  }
  useEffect(() => {
    const controller = new AbortController()
    scopeController.current = controller
    return () => {
      controller.abort()
    }
  }, [userId])

  // 打开时刷新操作策略；读取失败必须可见，不能等同于允许操作。
  async function open(next: GatedEntry) {
    const signal = scopeController.current?.signal
    if (
      !userId ||
      !signal ||
      signal.aborted ||
      (pendingRequest.current && !pendingRequest.current.aborted)
    )
      return
    pendingRequest.current = signal
    setOpening(next)
    onOpened?.()
    setLoadError(null)
    try {
      const policy = await fetchSecurityState(signal)
      if (signal.aborted || pendingRequest.current !== signal) return
      setSecurity(policy)
      setEntry(next)
    } catch (cause) {
      if (!signal.aborted && pendingRequest.current === signal)
        setLoadError(actionErrorMessage(cause))
    } finally {
      if (!signal.aborted && pendingRequest.current === signal) {
        pendingRequest.current = null
        setOpening(null)
      }
    }
  }

  const requirement: OperationRequirement | null = entry
    ? entry.operation === 'changePassword'
      ? null
      : (security?.requirements[entry.operation] ?? null)
    : null

  const dialog: ReactNode = entry ? (
    <SecurityDialog
      operation={entry.operation}
      requirement={requirement}
      email={email}
      hasPasskey={hasPasskey}
      hasTwoFactor={hasTwoFactor}
      passkeyId={entry.passkeyId}
      onClose={() => setEntry(null)}
      onCompleted={(message) => {
        const operation = entry.operation
        setEntry(null)
        onCompleted(operation, message)
      }}
    />
  ) : loadError ? (
    <p className="error-message" role="alert">
      {loadError}
    </p>
  ) : null

  return { open, dialog, opening }
}
