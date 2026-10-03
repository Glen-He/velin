import { Camera, ChevronRight, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { authClient } from '../auth-client'
import {
  accountInitial,
  avatarDisplayUrl,
  errorMessage,
  useArmConfirm,
} from '../shared'
import { LoadingState } from '../shared-ui'
import { AvatarCropDialog } from './AvatarCropDialog'

// 账号中心：身份（头像/用户名）与安全、会话入口。
// 网页端不提供对话功能，这里是网页侧的账号主页面。
export function AccountPage() {
  const { data: session, isPending, refetch } = authClient.useSession()
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [isSavingName, setIsSavingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const { armed, arm } = useArmConfirm()

  useEffect(() => {
    // 会话失效时回到登录页（例如在本页退出登录之后）。
    if (!isPending && !session) {
      window.location.replace('/sign-in')
    }
  }, [isPending, session])

  if (isPending || !session) {
    return <LoadingState label="正在读取账号…" />
  }

  const user = session.user
  const displayName = user.name.trim() || user.email
  const avatarUrl = user.image ? avatarDisplayUrl(user.image) : null

  function startNameEdit() {
    setNameDraft(displayName)
    setNameError(null)
    setIsEditingName(true)
  }

  function cancelNameEdit() {
    setIsEditingName(false)
    setNameDraft('')
    setNameError(null)
  }

  async function saveName() {
    if (isSavingName) {
      return
    }

    const name = nameDraft.trim()

    if (name.length < 1 || name.length > 32) {
      setNameError('用户名需为 1–32 个可见字符。')
      return
    }

    setIsSavingName(true)
    setNameError(null)
    try {
      const result = await authClient.updateUser({ name })

      if (result.error) {
        throw new Error(errorMessage(result.error))
      }

      await refetch()
      setIsEditingName(false)
    } catch (cause) {
      setNameError(
        cause instanceof Error && cause.message
          ? cause.message
          : '更新用户名失败，请稍后重试。',
      )
    } finally {
      setIsSavingName(false)
    }
  }

  async function signOut() {
    await authClient.signOut()
    await refetch()
    // 会话清空后由上方的守卫跳回 /sign-in。
  }

  return (
    <main className="security-page">
      <header className="security-header">
        <div className="security-header-slot" />
        <h1>账号中心</h1>
      </header>

      <section className="account-section">
        <h2 className="account-section-title">账号</h2>
        <div className="security-card account-identity">
          <button
            className="account-avatar-button"
            type="button"
            aria-label="更换头像"
            onClick={() => setAvatarDialogOpen(true)}
          >
            <span className="account-avatar-lg" aria-hidden="true">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" />
              ) : (
                accountInitial(user.name, user.email)
              )}
              <span className="account-avatar-hint">
                <Camera aria-hidden="true" />
              </span>
            </span>
          </button>
          {isEditingName ? (
            <form
              className="name-editor"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                void saveName()
              }}
            >
              <input
                autoFocus
                className="web-field"
                type="text"
                value={nameDraft}
                maxLength={32}
                autoComplete="off"
                spellCheck={false}
                aria-label="用户名"
                onChange={(event) => {
                  setNameDraft(event.target.value)
                  if (nameError) {
                    setNameError(null)
                  }
                }}
              />
              <span
                className={nameError ? 'name-count is-error' : 'name-count'}
                role={nameError ? 'alert' : undefined}
              >
                {nameError ?? `${nameDraft.trim().length}/32`}
              </span>
              <div className="name-editor-actions">
                <button
                  className="security-action is-outline is-narrow"
                  type="button"
                  disabled={isSavingName}
                  onClick={cancelNameEdit}
                >
                  取消
                </button>
                <button
                  className="security-action is-primary is-narrow"
                  type="submit"
                  disabled={isSavingName || nameDraft.trim() === displayName}
                >
                  保存
                </button>
              </div>
            </form>
          ) : (
            <div className="account-identity-copy">
              <div className="account-identity-name">
                <span>{displayName}</span>
                <button
                  className="icon-pencil"
                  type="button"
                  aria-label="修改用户名"
                  title="修改用户名"
                  onClick={startNameEdit}
                >
                  <Pencil aria-hidden="true" />
                </button>
              </div>
              <div className="account-identity-email">{user.email}</div>
            </div>
          )}
        </div>
      </section>

      <section className="account-section">
        <h2 className="account-section-title">安全</h2>
        <div className="session-group">
          <a className="session-card" href="/security">
            <div className="session-copy">
              <div className="session-name">登录与安全</div>
              <div className="session-meta">通行密钥、双重认证和密码。</div>
            </div>
            <ChevronRight
              className="security-card-chevron"
              aria-hidden="true"
            />
          </a>
        </div>
      </section>

      <section className="account-section">
        <h2 className="account-section-title">会话</h2>
        <div className="session-group">
          <a className="session-card" href="/account/sessions">
            <div className="session-copy">
              <div className="session-name">登录设备</div>
              <div className="session-meta">查看并退出登录中的设备。</div>
            </div>
            <ChevronRight
              className="security-card-chevron"
              aria-hidden="true"
            />
          </a>
          <div className="session-card">
            <div className="session-copy">
              <div className="session-name">退出登录</div>
              <div className="session-meta">移除这台浏览器上的登录会话。</div>
            </div>
            <button
              className={`security-action danger-button${armed === 'signout' ? ' is-armed' : ''}`}
              type="button"
              onClick={() => {
                if (armed === 'signout') {
                  void signOut()
                } else {
                  arm('signout')
                }
              }}
            >
              {armed === 'signout' ? '确认' : '退出登录'}
            </button>
          </div>
        </div>
      </section>

      {avatarDialogOpen ? (
        <AvatarCropDialog
          currentImage={avatarUrl}
          initial={accountInitial(user.name, user.email)}
          onClose={() => setAvatarDialogOpen(false)}
          onUploaded={() => void refetch()}
        />
      ) : null}
    </main>
  )
}
