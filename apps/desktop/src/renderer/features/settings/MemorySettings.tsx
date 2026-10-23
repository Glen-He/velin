import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@velin/ui/Button.tsx'
import { errorMessage } from '@velin/contracts/error-copy'
import type { MemoryAction, MemoryState } from '@velin/contracts/memory'
import { PanelCard } from '@velin/ui/Panel.tsx'
import { MemoryManagerDialog } from './MemoryManagerDialog'
import { SettingsPanel, SettingsRow, Toggle } from './SettingsPrimitives'

export function MemorySettings({ accountId }: { accountId: string | null }) {
  const [data, setData] = useState<MemoryState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const mounted = useRef(false)
  const occupied = useRef(false)
  const version = useRef(0)
  const load = useCallback(async () => {
    if (!accountId || occupied.current) return
    const expected = ++version.current
    try {
      const result = await window.velin.memory.read()
      if (mounted.current && version.current === expected) {
        setData(result)
        setError(null)
      }
    } catch (cause) {
      if (mounted.current && version.current === expected)
        setError(errorMessage(cause, '读取记忆失败，请重试。'))
    }
  }, [accountId])
  // 读取 Main 的外部状态；清理时递增请求代次，拒绝卸载后的迟到响应。
  useEffect(() => {
    mounted.current = true
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
    const focus = () => void load()
    window.addEventListener('focus', focus)
    return () => {
      mounted.current = false
      // 请求代次不是 DOM 引用，清理时必须使在途结果失效。
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      version.current++
      window.removeEventListener('focus', focus)
    }
  }, [load])
  async function update(action: MemoryAction) {
    if (occupied.current) throw new Error('操作正在进行，请稍候。')
    occupied.current = true
    version.current++
    setBusy(true)
    try {
      const result = await window.velin.memory.update(action)
      if (mounted.current) {
        setData(result)
        setError(null)
      }
    } catch (cause) {
      if (mounted.current)
        setError(errorMessage(cause, '更新记忆失败，请重试。'))
      throw cause
    } finally {
      if (mounted.current) {
        occupied.current = false
        setBusy(false)
      }
    }
  }
  return (
    <SettingsPanel title="记忆">
      {!accountId ? (
        <p className="memory-description">登录后，让之后的对话记住你的偏好。</p>
      ) : (
        <>
          <PanelCard>
            <SettingsRow
              title="记住我的偏好"
              description="在之后的对话中参考你的习惯和偏好。"
            >
              {data ? (
                <Toggle
                  disabled={busy}
                  checked={data.enabled}
                  label="记住我的偏好"
                  onChange={(enabled) => {
                    if (!busy)
                      void update({ action: 'settings', enabled }).catch(
                        () => {},
                      )
                  }}
                />
              ) : (
                <span className="memory-description">
                  {error ? '未能读取' : '读取中…'}
                </span>
              )}
            </SettingsRow>
            <SettingsRow
              title="参考历史对话"
              description="需要时，从之前的聊天中找回相关信息。"
            >
              <Toggle
                disabled={busy || !data?.enabled}
                checked={data?.referenceHistory ?? false}
                label="参考历史对话"
                onChange={(referenceHistory) => {
                  if (!busy)
                    void update({ action: 'settings', referenceHistory }).catch(
                      () => {},
                    )
                }}
              />
            </SettingsRow>
            <SettingsRow
              title="已保存的记忆"
              description={
                data
                  ? data.entries.length
                    ? `已保存 ${data.entries.length} 条，可随时修改或删除。`
                    : '你的长期偏好会保存在这里。'
                  : '查看和管理你保存的偏好。'
              }
            >
              <Button variant="secondary" onClick={() => setManagerOpen(true)}>
                管理
              </Button>
            </SettingsRow>
          </PanelCard>
          {error && !managerOpen ? (
            <div className="memory-inline-error" role="alert">
              <span>{error}</span>
              <Button variant="secondary" onClick={() => void load()}>
                重试
              </Button>
            </div>
          ) : null}
          {managerOpen ? (
            <MemoryManagerDialog
              data={data}
              error={error}
              busy={busy}
              onReload={load}
              onUpdate={update}
              onClose={() => setManagerOpen(false)}
            />
          ) : null}
        </>
      )}
    </SettingsPanel>
  )
}
