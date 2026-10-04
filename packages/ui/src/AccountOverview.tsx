import { TruncatedText } from './TruncatedText'
import { Camera, Pencil } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, ButtonLink } from './Button'
import { PanelCard, PanelGroup, PanelRow } from './Panel'

type Navigation =
  | { href: string; onClick?: never }
  | { onClick: () => void; href?: never }
function NavigationButton({
  target,
  children,
}: {
  target: Navigation
  children: string
}) {
  return target.href ? (
    <ButtonLink href={target.href} variant="secondary">
      {children}
    </ButtonLink>
  ) : (
    <Button variant="secondary" onClick={target.onClick}>
      {children}
    </Button>
  )
}
// 两端共享账号分组、行结构与文案，载体只提供头像读取和导航边界。
export function AccountOverview({
  name,
  email,
  avatar,
  onEditAvatar,
  onEditName,
  security,
  devices,
  onSignOut,
}: {
  name: string
  email: string
  avatar: ReactNode
  onEditAvatar: () => void
  onEditName: () => void
  security: Navigation
  devices: Navigation
  onSignOut: () => void
}) {
  return (
    <>
      <PanelGroup title="个人信息">
        <PanelCard>
          <div className="panel-row account-identity-row">
            <button
              className="account-avatar-edit"
              aria-label="更换头像"
              title="更换头像"
              type="button"
              onClick={onEditAvatar}
            >
              {avatar}
              <span className="account-avatar-overlay" aria-hidden="true">
                <Camera />
              </span>
            </button>
            <div className="panel-row-copy">
              <TruncatedText className="panel-row-title">{name}</TruncatedText>
              <TruncatedText className="panel-row-description">
                {email}
              </TruncatedText>
            </div>
          </div>
          <PanelRow title="用户名" description={name}>
            <button
              className="panel-icon-action"
              aria-label="编辑用户名"
              title="编辑用户名"
              type="button"
              onClick={onEditName}
            >
              <Pencil aria-hidden="true" />
            </button>
          </PanelRow>
        </PanelCard>
      </PanelGroup>
      <PanelGroup title="安全">
        <PanelCard>
          <PanelRow
            title="登录与安全"
            description="管理密码、通行密钥和双重认证。"
          >
            <NavigationButton target={security}>安全设置</NavigationButton>
          </PanelRow>
        </PanelCard>
      </PanelGroup>
      <PanelGroup title="设备与登录">
        <PanelCard>
          <PanelRow
            title="登录设备"
            description="查看账号登录的设备，并可远程退出。"
          >
            <NavigationButton target={devices}>查看设备</NavigationButton>
          </PanelRow>
          <PanelRow
            title="退出当前账号"
            description="移除当前设备上的登录会话。"
          >
            <Button variant="danger" onClick={onSignOut}>
              退出登录
            </Button>
          </PanelRow>
        </PanelCard>
      </PanelGroup>
    </>
  )
}
