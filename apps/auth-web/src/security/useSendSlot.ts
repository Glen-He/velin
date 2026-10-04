import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createSendSlots } from './send-slot-store'

const cooldownSeconds = import.meta.env.DEV ? 5 : 60

// 收件地址变更时选择不同发送槽；返回旧地址仍保留冷却，
// 迟到投递结果不能把新地址标记为已发送。
export function useSendSlot(recipient: string, seconds = cooldownSeconds) {
  const [store] = useState(() => createSendSlots(seconds * 1000))
  const selectedRecipient = useRef(recipient)
  useLayoutEffect(() => {
    selectedRecipient.current = recipient
  }, [recipient])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const slot = snapshot.slots[recipient]
  const remaining = Math.max(
    0,
    Math.ceil(((slot?.expiresAt ?? 0) - snapshot.now) / 1000),
  )
  const cooling = Object.values(snapshot.slots).some(
    (item) => item.expiresAt > snapshot.now,
  )
  useEffect(() => {
    if (!cooling) return
    const timer = window.setTimeout(store.tick, 1000)
    return () => window.clearTimeout(timer)
  }, [cooling, snapshot.now, store])
  return {
    pending: slot?.pending ?? false,
    sent: slot?.sent ?? false,
    remaining,
    busy: Boolean(slot?.pending) || remaining > 0,
    begin: () => store.begin(recipient),
    delivered: store.delivered,
    settle: store.settle,
    isCurrent: (ticket: Parameters<typeof store.isCurrent>[0]) =>
      ticket.recipient === selectedRecipient.current && store.isCurrent(ticket),
  }
}
