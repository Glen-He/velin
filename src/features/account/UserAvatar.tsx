import { useEffect, useState } from 'react'
import { UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AuthUser } from '@velin/contracts/auth-protocol'

// 头像字节由 Main 代取后转为 blob: URL；同一地址在会话内只取一次，
// 供侧边栏、设置页与对话框共享。加载失败时回退显示首字母。
const objectUrlCache = new Map<string, Promise<string>>()

function loadAvatarObjectUrl(imageUrl: string): Promise<string> {
  const cached = objectUrlCache.get(imageUrl)

  if (cached) {
    return cached
  }

  const pending = window.velin.auth
    .fetchAvatarImage(imageUrl)
    .then((bytes) =>
      URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })),
    )
    .catch((cause) => {
      objectUrlCache.delete(imageUrl)
      throw cause
    })

  objectUrlCache.set(imageUrl, pending)
  return pending
}

function getAccountInitial(user: AuthUser) {
  return (user.name.trim()[0] ?? user.email[0] ?? 'V').toUpperCase()
}

export function UserAvatar({
  user,
  className,
  children,
}: {
  user: AuthUser | null
  className?: string
  children?: ReactNode
}) {
  const imageUrl = user?.image ?? null
  const [resolved, setResolved] = useState<{
    source: string
    objectUrl: string
  } | null>(null)

  useEffect(() => {
    if (!imageUrl) {
      return
    }

    let active = true

    void loadAvatarObjectUrl(imageUrl)
      .then((objectUrl) => {
        if (active) {
          setResolved({ source: imageUrl, objectUrl })
        }
      })
      .catch(() => {
        // 加载失败时按没有头像渲染，回退显示首字母。
      })

    return () => {
      active = false
    }
  }, [imageUrl])

  const activeObjectUrl =
    resolved && resolved.source === imageUrl ? resolved.objectUrl : null

  const classes = className ? `account-avatar ${className}` : 'account-avatar'

  return (
    <span className={classes} aria-hidden="true">
      {user && activeObjectUrl ? (
        <img src={activeObjectUrl} alt="" />
      ) : user ? (
        getAccountInitial(user)
      ) : (
        <UserRound />
      )}
      {children}
    </span>
  )
}
