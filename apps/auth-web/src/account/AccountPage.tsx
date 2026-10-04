import { AccountOverview } from '@velin/ui/AccountOverview.tsx'
import { useEffect, useRef, useState } from 'react'
import { authClient } from '../auth-client'
import type { AuthUser } from '@velin/contracts/auth-protocol'
import { accountInitial } from '@velin/contracts/avatar'
import { errorMessage } from '@velin/contracts/error-copy'
import { ConfirmationDialog } from '@velin/ui/ConfirmationDialog.tsx'
import { LoadingState } from '../LoadingState'
import { AvatarCropDialog } from './AvatarCropDialog'
import { DisplayNameDialog } from '@velin/ui/DisplayNameDialog.tsx'

// 账号：身份（头像/用户名）与安全、会话入口。
// 网页端不提供对话功能，这里是网页侧的账号主页面。
export function AccountPage() {
  const { data: session, isPending, refetch } = authClient.useSession()

  useEffect(() => {
    // 会话失效时回到登录页（例如在本页退出登录之后）。
    if (!isPending && !session) {
      window.location.replace('/sign-in')
    }
  }, [isPending, session])

  if (isPending || !session) {
    return <LoadingState label="正在读取账号…" />
  }

  return (
    <AccountContent
      key={session.user.id}
      user={{
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      }}
      refetch={refetch}
    />
  )
}

function AccountContent({
  user,
  refetch,
}: {
  user: Pick<AuthUser, 'id' | 'name' | 'email' | 'image'>
  refetch: () => Promise<unknown>
}) {
  const [dialog, setDialog] = useState<'name' | 'avatar' | 'signOut' | null>(
    null,
  )
  const active = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const displayName = user.name.trim() || user.email
  const avatarUrl = user.image ?? null
  const activeDialog = dialog

  async function saveName(name: string) {
    const result = await authClient.updateUser({ name })
    if (result.error) throw new Error(errorMessage(result.error))
    await refetch()
  }

  async function signOut() {
    const result = await authClient.signOut()
    if (result.error)
      throw new Error(
        errorMessage(result.error, '退出登录失败，请检查网络后重试。'),
      )
    if (active.current) window.location.replace('/sign-in')
  }

  return (
    <main className="security-page">
      <header className="security-header">
        <div className="security-header-slot" aria-hidden="true" />
        <h1>账号</h1>
      </header>

      <AccountOverview
        name={displayName}
        email={user.email}
        avatar={
          avatarUrl ? (
            <img src={avatarUrl} alt="" />
          ) : (
            accountInitial(user.name, user.email)
          )
        }
        onEditAvatar={() => setDialog('avatar')}
        onEditName={() => setDialog('name')}
        security={{ href: '/security' }}
        devices={{ href: '/account/sessions' }}
        onSignOut={() => setDialog('signOut')}
      />

      {activeDialog === 'signOut' ? (
        <ConfirmationDialog
          key={user.id}
          title="退出登录"
          confirmLabel="退出登录"
          pendingLabel="退出中…"
          failureMessage="退出登录失败，请检查网络后重试。"
          onConfirm={signOut}
          onClose={() => setDialog(null)}
        >
          确认要退出当前账号吗？当前登录会话将被移除。
        </ConfirmationDialog>
      ) : null}

      {activeDialog === 'name' ? (
        <DisplayNameDialog
          key={user.id}
          initialName={displayName}
          onSave={saveName}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {activeDialog === 'avatar' ? (
        <AvatarCropDialog
          key={user.id}
          currentImage={avatarUrl}
          initial={accountInitial(user.name, user.email)}
          onClose={() => setDialog(null)}
          onUploaded={() => void refetch()}
        />
      ) : null}
    </main>
  )
}
