import { useEffect, useState } from 'react'
import { UserRound } from 'lucide-react'
import { accountInitial, ownedAvatarPath } from '@velin/contracts/avatar'
import { createAvatarCache } from './avatar-cache'
import type { ReactNode } from 'react'
import type { AuthUser } from '@velin/contracts/auth-protocol'

// 订阅者共享请求与 Blob；最后一个订阅者退出后释放，账号之间不共享缓存。
const avatarCache = createAvatarCache({
  load: (source) => window.velin.auth.fetchAvatarImage(source),
  create: (bytes) =>
    URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
    ),
  revoke: (url) => URL.revokeObjectURL(url),
})

export function UserAvatar({
  user,
  className,
  children,
}: {
  user: AuthUser | null
  className?: string
  children?: ReactNode
}) {
  const source = user?.image ?? null
  const imageUrl = source && ownedAvatarPath(source) ? source : null
  const key = user && imageUrl ? JSON.stringify([user.id, imageUrl]) : null
  const [resolved, setResolved] = useState<{
    key: string
    objectUrl: string
  } | null>(null)

  useEffect(() => {
    if (!imageUrl || !key) {
      return
    }

    let active = true

    const retained = avatarCache.acquire(key, imageUrl)
    void retained.pending
      .then((objectUrl) => {
        if (active && objectUrl) {
          setResolved({ key, objectUrl })
        }
      })
      .catch(() => {
        // 加载失败时按没有头像渲染，回退显示首字母。
      })

    return () => {
      active = false
      retained.release()
    }
  }, [imageUrl, key])

  const activeObjectUrl =
    resolved && resolved.key === key ? resolved.objectUrl : null

  const classes = className ? `account-avatar ${className}` : 'account-avatar'

  return (
    <span className={classes} aria-hidden="true">
      {user && activeObjectUrl ? (
        <img src={activeObjectUrl} alt="" onError={() => setResolved(null)} />
      ) : user ? (
        accountInitial(user.name, user.email)
      ) : (
        <UserRound />
      )}
      {children}
    </span>
  )
}
