import { Camera, Pencil } from 'lucide-react'
import { useState } from 'react'
import type { SettingsViewProps } from '../settings/types'
import {
  SettingsPanel,
  SettingsGroup,
  SettingsRow,
} from '../settings/SettingsPrimitives'
import { AvatarDialog } from './AvatarDialog'
import { SessionsDialog } from './SessionsDialog'
import { UserAvatar } from './UserAvatar'
import { CardDialog } from '../../components/CardDialog'

export function AccountSettings({
  authUser,
  onUploadAvatar,
  onChangeDisplayName,
  onOpenSecuritySettings,
  onSignIn,
  onSignOut,
}: Pick<
  SettingsViewProps,
  | 'authUser'
  | 'onUploadAvatar'
  | 'onChangeDisplayName'
  | 'onOpenSecuritySettings'
  | 'onSignIn'
  | 'onSignOut'
>) {
  const [nameDialogOpen, setNameDialogOpen] = useState(false)
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false)
  const [sessionsDialogOpen, setSessionsDialogOpen] = useState(false)
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false)

  if (!authUser) {
    return (
      <SettingsPanel title="账号">
        <SettingsGroup title="登录状态">
          <div className="settings-card">
            <SettingsRow
              title="登录以使用完整功能"
              description="同步会话，并在不同设备间继续使用。"
            >
              <button
                className="settings-action-button is-narrow"
                type="button"
                onClick={onSignIn}
              >
                登录
              </button>
            </SettingsRow>
          </div>
        </SettingsGroup>
      </SettingsPanel>
    )
  }

  const displayName = authUser.name.trim() || authUser.email

  return (
    <SettingsPanel title="账号">
      <SettingsGroup title="个人信息">
        <div className="settings-card">
          <div className="settings-row settings-identity-row">
            <button
              className="settings-avatar-button"
              type="button"
              aria-label="更换头像"
              title="更换头像"
              onClick={() => setAvatarDialogOpen(true)}
            >
              <UserAvatar user={authUser} className="settings-avatar">
                <span className="settings-avatar-hint" aria-hidden="true">
                  <Camera />
                </span>
              </UserAvatar>
            </button>
            <div className="settings-identity-copy">
              <span className="settings-identity-name">{displayName}</span>
              <span className="settings-identity-email">{authUser.email}</span>
            </div>
          </div>
          <SettingsRow title="用户名" description={displayName}>
            <button
              className="settings-icon-button"
              type="button"
              aria-label="编辑用户名"
              title="编辑用户名"
              onClick={() => setNameDialogOpen(true)}
            >
              <Pencil aria-hidden="true" />
            </button>
          </SettingsRow>
        </div>
      </SettingsGroup>
      <SettingsGroup title="安全">
        <div className="settings-card">
          <SettingsRow
            title="登录与安全"
            description="管理密码、通行密钥和双重认证。"
          >
            <button
              className="settings-action-button is-secondary"
              type="button"
              onClick={onOpenSecuritySettings}
            >
              安全设置
            </button>
          </SettingsRow>
        </div>
      </SettingsGroup>
      <SettingsGroup title="设备与登录">
        <div className="settings-card">
          <SettingsRow
            title="登录设备"
            description="查看账号登录的设备，并可远程退出。"
          >
            <button
              className="settings-action-button is-secondary"
              type="button"
              onClick={() => setSessionsDialogOpen(true)}
            >
              查看设备
            </button>
          </SettingsRow>
          <SettingsRow
            title="退出当前账号"
            description="移除这台设备上的加密登录会话。"
          >
            <button
              className="settings-action-button is-danger"
              type="button"
              onClick={() => setSignOutDialogOpen(true)}
            >
              退出登录
            </button>
          </SettingsRow>
        </div>
      </SettingsGroup>

      {nameDialogOpen ? (
        <NameDialog
          initialName={displayName}
          onClose={() => setNameDialogOpen(false)}
          onSave={onChangeDisplayName}
        />
      ) : null}
      {avatarDialogOpen ? (
        <AvatarDialog
          authUser={authUser}
          onUpload={onUploadAvatar}
          onClose={() => setAvatarDialogOpen(false)}
        />
      ) : null}
      {sessionsDialogOpen ? (
        <SessionsDialog onClose={() => setSessionsDialogOpen(false)} />
      ) : null}
      {signOutDialogOpen ? (
        <SignOutConfirmDialog
          onClose={() => setSignOutDialogOpen(false)}
          onSignOut={onSignOut}
        />
      ) : null}
    </SettingsPanel>
  )
}

function SignOutConfirmDialog({
  onClose,
  onSignOut,
}: {
  onClose: () => void
  onSignOut: () => void
}) {
  return (
    <CardDialog title="退出登录" onClose={onClose}>
      <p className="card-dialog-text">
        确认要退出当前账号吗？这台设备上的加密登录会话将被移除。
      </p>
      <div className="card-dialog-actions">
        <button
          className="settings-action-button is-outline"
          type="button"
          onClick={onClose}
        >
          取消
        </button>
        <button
          className="settings-action-button is-danger-primary"
          type="button"
          onClick={() => {
            onClose()
            onSignOut()
          }}
        >
          退出登录
        </button>
      </div>
    </CardDialog>
  )
}

function NameDialog({
  initialName,
  onClose,
  onSave,
}: {
  initialName: string
  onClose: () => void
  onSave: (name: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function save() {
    if (isSaving) {
      return
    }

    const name = draft.trim()

    if (name.length < 1 || name.length > 32) {
      setError('用户名需为 1–32 个可见字符。')
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      await onSave(name)
      onClose()
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : '更新用户名失败，请稍后重试。',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <CardDialog title="用户名" onClose={onClose}>
      <input
        autoFocus
        className="card-dialog-input"
        type="text"
        value={draft}
        maxLength={32}
        autoComplete="off"
        spellCheck={false}
        aria-label="用户名"
        onChange={(event) => {
          setDraft(event.target.value)
          if (error) {
            setError(null)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            void save()
          }
        }}
      />
      <p className="card-dialog-feedback" role={error ? 'alert' : undefined}>
        {error ?? `${draft.trim().length}/32`}
      </p>
      <div className="card-dialog-actions">
        <button
          className="settings-action-button is-outline is-narrow"
          type="button"
          disabled={isSaving}
          onClick={onClose}
        >
          取消
        </button>
        <button
          className="settings-action-button is-narrow"
          type="button"
          disabled={isSaving || draft.trim() === initialName}
          onClick={() => void save()}
        >
          {isSaving ? '保存中…' : '保存'}
        </button>
      </div>
    </CardDialog>
  )
}
