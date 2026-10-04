type Slot = {
  sent: boolean
  pending: boolean
  expiresAt: number
  version: number
}
export type SendTicket = { recipient: string; version: number }
const emptySlot: Slot = {
  sent: false,
  pending: false,
  expiresAt: 0,
  version: 0,
}

export function createSendSlots(
  cooldownMs: number,
  now: () => number = Date.now,
) {
  // 首屏没有发送槽，时钟从统一初值开始；实际发送或 tick 再读取当前时间。
  const initialSnapshot = { slots: {} as Record<string, Slot>, now: 0 }
  let snapshot = initialSnapshot
  const listeners = new Set<() => void>()
  function update(recipient: string, slot: Slot) {
    snapshot = { slots: { ...snapshot.slots, [recipient]: slot }, now: now() }
    listeners.forEach((listener) => listener())
  }
  function current(ticket: SendTicket) {
    return snapshot.slots[ticket.recipient]?.version === ticket.version
  }
  return {
    getSnapshot: () => snapshot,
    // 服务端与 hydration 使用稳定初值，不订阅请求或读取其他账号的状态。
    getServerSnapshot: () => initialSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    begin(recipient: string): SendTicket | null {
      const slot = snapshot.slots[recipient] ?? emptySlot
      if (slot.pending || slot.expiresAt > now()) return null
      const version = slot.version + 1
      update(recipient, { ...slot, pending: true, version })
      return { recipient, version }
    },
    isCurrent: current,
    delivered(ticket: SendTicket) {
      if (current(ticket))
        update(ticket.recipient, {
          ...snapshot.slots[ticket.recipient],
          sent: true,
          expiresAt: now() + cooldownMs,
        })
    },
    settle(ticket: SendTicket) {
      if (current(ticket))
        update(ticket.recipient, {
          ...snapshot.slots[ticket.recipient],
          pending: false,
        })
    },
    tick() {
      snapshot = { ...snapshot, now: now() }
      listeners.forEach((listener) => listener())
    },
  }
}
