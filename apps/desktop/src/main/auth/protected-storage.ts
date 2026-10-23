type Storage = {
  getItem: (key: string) => unknown
  setItem: (key: string, value: unknown) => void
}

// 认证库负责加解密；本层只决定是否允许持久化，避免弱后端落盘。
export function protectedStorage(storage: Storage, canPersist: () => boolean) {
  const memory = new Map<string, unknown>()
  return {
    getItem(key: string) {
      if (canPersist()) return storage.getItem(key)
      if (storage.getItem(key) !== null) storage.setItem(key, null)
      return memory.get(key) ?? null
    },
    setItem(key: string, value: unknown) {
      if (canPersist()) storage.setItem(key, value)
      else {
        memory.set(key, value)
        storage.setItem(key, null)
      }
    },
  }
}
