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
  email,
  hasPasskey,
  hasTwoFactor,
  onOpened,
  onCompleted,
}: {
  email: string
  hasPasskey: boolean
  hasTwoFactor: boolean
  // 页面用它清掉上一次的分组反馈，避免旧文案留在原地。
  onOpened?: () => void
  onCompleted: (operation: DialogOperation, message?: string) => void
}) {
  const [security, setSecurity] = useState<SecurityState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const sequence = useRef(0)
  useEffect(
    () => () => {
      sequence.current++
    },
    [],
  )
  const [entry, setEntry] = useState<GatedEntry | null>(null)

  // Refresh operation policy when opening; failure remains visible and does not imply permission.
  async function open(next: GatedEntry) {
    onOpened?.()
    const request = ++sequence.current
    setLoadError(null)
    try {
      const policy = await fetchSecurityState()
      if (request !== sequence.current) return
      setSecurity(policy)
      setEntry(next)
    } catch (cause) {
      if (request === sequence.current) setLoadError(actionErrorMessage(cause))
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

  return { open, dialog }
}
