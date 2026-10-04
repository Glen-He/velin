import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '@velin/contracts/error-copy'
import { isValidDisplayName } from '@velin/contracts/policy'

// 两端共用名称校验和保存生命周期；关闭后的结果不影响后来打开的编辑器。
export function useDisplayNameEdit(
  initialName: string,
  onSave: (name: string) => Promise<void>,
  onComplete: () => void,
) {
  const [draft, setDraft] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const active = useRef(true)
  const busy = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  async function save() {
    if (busy.current || !active.current) return
    const name = draft.trim()
    if (!isValidDisplayName(name)) {
      setError('用户名需为 1–32 个可见字符。')
      return
    }
    busy.current = true
    setIsSaving(true)
    setError(null)
    try {
      await onSave(name)
      if (active.current) onComplete()
    } catch (cause) {
      if (active.current)
        setError(errorMessage(cause, '更新用户名失败，请稍后重试。'))
    } finally {
      busy.current = false
      if (active.current) setIsSaving(false)
    }
  }

  return {
    draft,
    error,
    isSaving,
    save,
    characterCount: [...draft.trim()].length,
    canSave: !isSaving && draft.trim() !== initialName.trim(),
    changeDraft(value: string) {
      setDraft(value)
      setError(null)
    },
  }
}
