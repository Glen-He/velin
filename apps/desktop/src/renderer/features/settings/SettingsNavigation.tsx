import {
  ChevronLeft,
  Info,
  MessageCircle,
  Palette,
  Search,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import type { SettingsSection, SettingsViewProps } from './types'

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
              <ChevronLeft />
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
                              ? {
                                  transform: `translateY(${item.iconOffsetY}px)`,
                                }
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
