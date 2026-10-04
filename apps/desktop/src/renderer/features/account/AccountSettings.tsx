import { Button } from '@velin/ui/Button.tsx'
import { DisplayNameDialog } from '@velin/ui/DisplayNameDialog.tsx'
import { AccountOverview } from '@velin/ui/AccountOverview.tsx'
import { useState } from 'react'
import type { SettingsViewProps } from '../settings/types'
import {
  SettingsPanel,
  SettingsGroup,
  SettingsRow,
} from '../settings/SettingsPrimitives'
import { AvatarDialog } from '@velin/ui/AvatarDialog.tsx'
import { SessionsDialog } from './SessionsDialog'
import { UserAvatar } from './UserAvatar'

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

  if (!authUser) {
    return (
      <SettingsPanel title="账号">
        <SettingsGroup title="登录状态">
          <div className="panel-card">
            <SettingsRow
              title="登录以使用完整功能"
              description="同步会话，并在不同设备间继续使用。"
            >
              <Button variant="primary" type="button" onClick={onSignIn}>
                登录
              </Button>
            </SettingsRow>
          </div>
        </SettingsGroup>
      </SettingsPanel>
    )
  }

  const displayName = authUser.name.trim() || authUser.email

  return (
    <SettingsPanel title="账号">
      <AccountOverview
        name={displayName}
        email={authUser.email}
        avatar={<UserAvatar user={authUser} className="account-avatar-image" />}
        onEditAvatar={() => setAvatarDialogOpen(true)}
        onEditName={() => setNameDialogOpen(true)}
        security={{ onClick: onOpenSecuritySettings }}
        devices={{ onClick: () => setSessionsDialogOpen(true) }}
        onSignOut={onSignOut}
      />

      {nameDialogOpen ? (
        <DisplayNameDialog
          initialName={displayName}
          onClose={() => setNameDialogOpen(false)}
          onSave={onChangeDisplayName}
        />
      ) : null}
      {avatarDialogOpen ? (
        <AvatarDialog
          preview={<UserAvatar user={authUser} className="avatar-task-image" />}
          onUpload={onUploadAvatar}
          onClose={() => setAvatarDialogOpen(false)}
        />
      ) : null}
      {sessionsDialogOpen ? (
        <SessionsDialog onClose={() => setSessionsDialogOpen(false)} />
      ) : null}
    </SettingsPanel>
  )
}
