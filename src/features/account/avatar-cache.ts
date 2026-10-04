type AvatarResources = {
  load: (source: string) => Promise<Uint8Array>
  create: (bytes: Uint8Array) => string
  revoke: (url: string) => void
}
type Entry = {
  references: number
  disposed: boolean
  url: string | null
  pending: Promise<string | null>
  disposal: ReturnType<typeof setTimeout> | null
}

export function createAvatarCache(resources: AvatarResources) {
  const entries = new Map<string, Entry>()
  return {
    acquire(key: string, source: string) {
      let entry = entries.get(key)
      if (!entry) {
        const created: Entry = {
          references: 0,
          disposed: false,
          url: null,
          pending: Promise.resolve(null),
          disposal: null,
        }
        created.pending = Promise.resolve()
          .then(() => resources.load(source))
          .then((bytes) => {
            if (created.disposed) return null
            created.url = resources.create(bytes)
            return created.url
          })
          .catch((error: unknown) => {
            if (entries.get(key) === created) entries.delete(key)
            throw error
          })
        entries.set(key, created)
        entry = created
      }
      const retained = entry
      if (retained.disposal !== null) clearTimeout(retained.disposal)
      retained.disposal = null
      retained.references += 1
      let released = false
      return {
        pending: retained.pending,
        release() {
          if (released) return
          released = true
          retained.references -= 1
          if (retained.references) return
          // 延迟一个任务释放，支持 Strict Mode 的立即卸载/重挂，不留下长期缓存。
          retained.disposal = setTimeout(() => {
            retained.disposed = true
            if (entries.get(key) === retained) entries.delete(key)
            if (retained.url) resources.revoke(retained.url)
          }, 0)
        },
      }
    },
  }
}
