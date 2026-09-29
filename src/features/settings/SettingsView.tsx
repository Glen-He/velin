import {
  ArrowLeft,
  Camera,
  Info,
  MessageCircle,
  Palette,
  Pencil,
  Search,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthUser } from '../../shared/auth-protocol'
import { AvatarDialog } from '../account/AvatarDialog'
import { SessionsDialog } from '../account/SessionsDialog'
import { UserAvatar } from '../account/UserAvatar'
import { CardDialog } from './CardDialog'

export type SettingsSection = 'account' | 'general' | 'appearance' | 'chat' | 'about'
export type AppearanceMode = 'system' | 'light' | 'dark'
export type InterfaceFontScale = 'small' | 'default' | 'large'

type SettingsViewProps = {
  activeSection: SettingsSection
  authUser: AuthUser | null
  appearanceMode: AppearanceMode
  edgeRevealEnabled: boolean
  fontScale: InterfaceFontScale
  sendOnEnter: boolean
  onAppearanceModeChange: (mode: AppearanceMode) => void
  onUploadAvatar: (image: Uint8Array) => Promise<void>
  onChangeDisplayName: (name: string) => Promise<void>
  onOpenSecuritySettings: () => void
  onSignIn: () => void
  onBack: () => void
  onEdgeRevealEnabledChange: (enabled: boolean) => void
  onFontScaleChange: (scale: InterfaceFontScale) => void
  onSectionChange: (section: SettingsSection) => void
  onSendOnEnterChange: (enabled: boolean) => void
  onSignOut: () => void
}

type NavigationItem = {
  id: SettingsSection
  icon: LucideIcon
  label: string
  iconOffsetY?: number
}

const navigationGroups: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: '设置',
    items: [
      // UserRound 的墨迹分布让它看起来偏下，按规范做 1px 上移校正。
      { id: 'account', icon: UserRound, label: '账号', iconOffsetY: -1 },
      { id: 'general', icon: SlidersHorizontal, label: '通用' },
      { id: 'appearance', icon: Palette, label: '外观' },
      { id: 'chat', icon: MessageCircle, label: '对话' },
    ],
  },
  {
    label: 'Velin',
    items: [{ id: 'about', icon: Info, label: '关于' }],
  },
]

const searchableSettings: Array<{
  label: string
  section: SettingsSection
  terms: string
}> = [
  {
    label: '安全设置',
    section: 'account',
    terms: '账号 邮箱 通行密钥 passkey 双重认证 2fa 登录 退出 安全 设置',
  },
  {
    label: '边缘唤出侧边栏',
    section: 'general',
    terms: '通用 侧边栏 鼠标 指针 窗口边缘 显示 隐藏',
  },
  {
    label: '颜色模式',
    section: 'appearance',
    terms: '外观 主题 系统 自动 浅色 深色',
  },
  {
    label: '界面字号',
    section: 'appearance',
    terms: '外观 字体 文字 大小 小 标准 大',
  },
  {
    label: 'Enter 发送消息',
    section: 'chat',
    terms: '对话 输入 回车 换行 command',
  },
  {
    label: '版本信息',
    section: 'about',
    terms: '关于 Velin 版本',
  },
]

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      className="settings-switch"
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-switch-thumb" />
    </button>
  )
}

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Array<{ label: string; value: T }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="settings-segmented-control" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          className="settings-segmented-option"
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function AppearancePicker({
  onChange,
  value,
}: {
  onChange: (mode: AppearanceMode) => void
  value: AppearanceMode
}) {
  const options: Array<{ label: string; value: AppearanceMode }> = [
    { label: '系统', value: 'system' },
    { label: '浅色', value: 'light' },
    { label: '深色', value: 'dark' },
  ]

  return (
    <div className="settings-appearance-picker" role="group" aria-label="颜色模式">
      {options.map((option) => (
        <button
          key={option.value}
          className="settings-appearance-option"
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          <AppearancePreview mode={option.value} />
          <span className="settings-appearance-label">{option.label}</span>
        </button>
      ))}
    </div>
  )
}

function PreviewWindow({
  className,
  theme,
}: {
  className?: string
  theme: 'light' | 'dark'
}) {
  return (
    <span
      className={`settings-preview-window is-${theme}${
        className ? ` ${className}` : ''
      }`}
    >
      <span className="settings-preview-sidebar" />
      <span className="settings-preview-message" />
      <span className="settings-preview-composer" />
    </span>
  )
}

function AppearancePreview({ mode }: { mode: AppearanceMode }) {
  return (
    <span
      className={`settings-appearance-preview is-${mode}`}
      aria-hidden="true"
    >
      {mode === 'system' ? (
        <>
          <PreviewWindow className="is-system-light" theme="light" />
          <PreviewWindow className="is-system-dark" theme="dark" />
        </>
      ) : (
        <PreviewWindow className="is-single" theme={mode} />
      )}
    </span>
  )
}

function SettingsRow({
  children,
  description,
  title,
}: {
  children: ReactNode
  description?: string
  title: string
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
        {description ? (
          <div className="settings-row-description">{description}</div>
        ) : null}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

function GeneralSettings({
  edgeRevealEnabled,
  onEdgeRevealEnabledChange,
}: Pick<
  SettingsViewProps,
  'edgeRevealEnabled' | 'onEdgeRevealEnabledChange'
>) {
  return (
    <SettingsPanel title="通用">
      <SettingsGroup title="侧边栏">
        <div className="settings-card">
          <SettingsRow
            title="边缘唤出侧边栏"
            description="侧边栏隐藏时，将指针移到窗口最左侧临时显示。"
          >
            <Toggle
              checked={edgeRevealEnabled}
              label="边缘唤出侧边栏"
              onChange={onEdgeRevealEnabledChange}
            />
          </SettingsRow>
        </div>
      </SettingsGroup>
    </SettingsPanel>
  )
}

function AccountSettings({
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
        <SettingsGroup title="Velin 账号">
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
      <SettingsGroup title="Velin 账号">
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
            <div className="settings-row-control">
              <button
                className="settings-action-button is-secondary"
                type="button"
                onClick={onOpenSecuritySettings}
              >
                安全设置
              </button>
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
      <SettingsGroup title="会话">
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
          className="settings-action-button is-secondary"
          type="button"
          onClick={onClose}
        >
          取消
        </button>
        <button
          className="settings-action-button is-danger"
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
          className="settings-action-button is-secondary is-narrow"
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

function AppearanceSettings({
  appearanceMode,
  fontScale,
  onAppearanceModeChange,
  onFontScaleChange,
}: Pick<
  SettingsViewProps,
  | 'appearanceMode'
  | 'fontScale'
  | 'onAppearanceModeChange'
  | 'onFontScaleChange'
>) {
  return (
    <SettingsPanel title="外观">
      <SettingsGroup title="主题">
        <div className="settings-card">
          <SettingsRow title="颜色模式">
            <AppearancePicker
              value={appearanceMode}
              onChange={onAppearanceModeChange}
            />
          </SettingsRow>
        </div>
      </SettingsGroup>
      <SettingsGroup title="文字">
        <div className="settings-card">
          <SettingsRow
            title="界面字号"
            description="只调整排版大小，不改变侧边栏和按钮的固定几何。"
          >
            <SegmentedControl
              label="界面字号"
              value={fontScale}
              onChange={onFontScaleChange}
              options={[
                { label: '小', value: 'small' },
                { label: '标准', value: 'default' },
                { label: '大', value: 'large' },
              ]}
            />
          </SettingsRow>
        </div>
      </SettingsGroup>
    </SettingsPanel>
  )
}

function ChatSettings({
  onSendOnEnterChange,
  sendOnEnter,
}: Pick<SettingsViewProps, 'onSendOnEnterChange' | 'sendOnEnter'>) {
  return (
    <SettingsPanel title="对话">
      <SettingsGroup title="输入">
        <div className="settings-card">
          <SettingsRow
            title="Enter 发送消息"
            description={
            sendOnEnter
              ? 'Shift + Enter 换行。'
              : '使用 Command + Enter 发送。'
            }
          >
            <Toggle
              checked={sendOnEnter}
              label="Enter 发送消息"
              onChange={onSendOnEnterChange}
            />
          </SettingsRow>
        </div>
      </SettingsGroup>
    </SettingsPanel>
  )
}

function AboutSettings() {
  return (
    <SettingsPanel title="关于">
      <SettingsGroup title="版本信息">
        <div className="settings-about-card">
          <div>
            <div className="settings-app-name">Velin</div>
            <div className="settings-app-version">版本 0.1.0</div>
          </div>
        </div>
      </SettingsGroup>
    </SettingsPanel>
  )
}

function SettingsGroup({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <section className="settings-group">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function SettingsPanel({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <div className="settings-panel">
      <h1>{title}</h1>
      {children}
    </div>
  )
}

export function SettingsNavigation({
  activeSection,
  onBack,
  onSectionChange,
}: Pick<SettingsViewProps, 'activeSection' | 'onBack' | 'onSectionChange'>) {
  const [searchQuery, setSearchQuery] = useState('')
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase()
  const searchResults = normalizedSearchQuery
    ? searchableSettings.filter((setting) =>
        `${setting.label} ${setting.terms}`
          .toLocaleLowerCase()
          .includes(normalizedSearchQuery),
      )
    : []
  return (
    <aside className="settings-sidebar">
      <nav className="settings-navigation" aria-label="设置分类">
        <div className="settings-navigation-actions">
          <button
            className="settings-back-button no-drag"
            type="button"
            onClick={onBack}
          >
            <span className="settings-navigation-icon" aria-hidden="true">
              <ArrowLeft />
            </span>
            <span>返回</span>
          </button>
          <label className="settings-search-field no-drag">
            <span className="settings-navigation-icon" aria-hidden="true">
              <Search />
            </span>
            <input
              type="search"
              aria-label="搜索设置"
              placeholder="搜索设置"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>

        {normalizedSearchQuery ? (
          <section className="settings-navigation-group">
            <h2>搜索结果</h2>
            <div className="settings-navigation-items">
              {searchResults.map((setting) => (
                <button
                  key={`${setting.section}-${setting.label}`}
                  className="settings-navigation-item settings-search-result"
                  type="button"
                  onClick={() => {
                    onSectionChange(setting.section)
                    setSearchQuery('')
                  }}
                >
                  <span>{setting.label}</span>
                </button>
              ))}
              {searchResults.length === 0 ? (
                <p className="settings-search-empty">没有找到相关设置</p>
              ) : null}
            </div>
          </section>
        ) : (
          navigationGroups.map((group) => (
            <section className="settings-navigation-group" key={group.label}>
              <h2>{group.label}</h2>
              <div className="settings-navigation-items">
                {group.items.map((item) => {
                  const Icon = item.icon
                  const isActive = item.id === activeSection

                  return (
                    <button
                      key={item.id}
                      className="settings-navigation-item"
                      type="button"
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => onSectionChange(item.id)}
                    >
                      <span
                        className="settings-navigation-icon"
                        aria-hidden="true"
                      >
                        <Icon
                          style={
                            item.iconOffsetY
                              ? { transform: `translateY(${item.iconOffsetY}px)` }
                              : undefined
                          }
                        />
                      </span>
                      <span>{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))
        )}
      </nav>
    </aside>
  )
}

function SettingsView({
  activeSection,
  appearanceMode,
  authUser,
  edgeRevealEnabled,
  fontScale,
  sendOnEnter,
  onAppearanceModeChange,
  onUploadAvatar,
  onChangeDisplayName,
  onEdgeRevealEnabledChange,
  onFontScaleChange,
  onOpenSecuritySettings,
  onSignIn,
  onSendOnEnterChange,
  onSignOut,
}: Omit<SettingsViewProps, 'onBack' | 'onSectionChange'>) {
  let content: ReactNode

  if (activeSection === 'account') {
    content = (
      <AccountSettings
        authUser={authUser}
        onUploadAvatar={onUploadAvatar}
        onChangeDisplayName={onChangeDisplayName}
        onOpenSecuritySettings={onOpenSecuritySettings}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
      />
    )
  } else if (activeSection === 'appearance') {
    content = (
      <AppearanceSettings
        appearanceMode={appearanceMode}
        fontScale={fontScale}
        onAppearanceModeChange={onAppearanceModeChange}
        onFontScaleChange={onFontScaleChange}
      />
    )
  } else if (activeSection === 'chat') {
    content = (
      <ChatSettings
        sendOnEnter={sendOnEnter}
        onSendOnEnterChange={onSendOnEnterChange}
      />
    )
  } else if (activeSection === 'about') {
    content = <AboutSettings />
  } else {
    content = (
      <GeneralSettings
        edgeRevealEnabled={edgeRevealEnabled}
        onEdgeRevealEnabledChange={onEdgeRevealEnabledChange}
      />
    )
  }

  return (
    <main className="settings-page">
      <section className="settings-content">{content}</section>
    </main>
  )
}

export default SettingsView
