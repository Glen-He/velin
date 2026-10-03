import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { LogIn, LogOut, Plus, Settings, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, MouseEvent } from 'react'
import type { Conversation } from '@velin/contracts/chat'
import type { AuthUser } from '@velin/contracts/auth-protocol'
import { UserAvatar } from '../account/UserAvatar'

type ConversationSidebarProps = {
  conversations: Conversation[]
  activeConversationId: string | null
  authUser: AuthUser | null
  onNewConversation: () => void
  onDeleteConversation: (conversationId: string) => void
  onOpenSettings: () => void
  onSignIn: () => void
  onSignOut: () => void
  onReorderConversation: (
    sourceConversationId: string,
    targetConversationId: string,
  ) => void
  onSelectConversation: (conversationId: string) => void
  isActive: boolean
}

type ConversationContextMenu = {
  conversationId: string
  left: number
  top: number
}

type AccountMenuPosition = {
  left: number
  top: number
  width: number
}

type SortableConversationItemProps = {
  conversation: Conversation
  isActive: boolean
  onContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    conversationId: string,
  ) => void
  onSelect: (conversationId: string) => void
}

type MenuIconProps = {
  icon: LucideIcon
  size?: number
  offsetY?: number
}

const sectionLabels = ['今天', '昨天', '更早'] as const

function MenuIcon({ icon: Icon, size = 15, offsetY = 0 }: MenuIconProps) {
  return (
    <span className="context-menu-icon-slot" aria-hidden="true">
      <Icon
        className="context-menu-icon"
        size={size}
        style={
          offsetY === 0 ? undefined : { transform: `translateY(${offsetY}px)` }
        }
      />
    </span>
  )
}

function getSectionLabel(timestamp: number) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (timestamp >= today.getTime()) {
    return '今天'
  }

  if (timestamp >= yesterday.getTime()) {
    return '昨天'
  }

  return '更早'
}

function SortableConversationItem({
  conversation,
  isActive,
  onContextMenu,
  onSelect,
}: SortableConversationItemProps) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: conversation.id })
  const style: CSSProperties = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
  }

  return (
    <div
      className={`conversation-item-row no-drag${isActive ? ' is-active' : ''}${
        isDragging ? ' is-dragging' : ''
      }`}
      data-conversation-id={conversation.id}
      ref={setNodeRef}
      style={style}
    >
      <button
        {...attributes}
        {...listeners}
        className="conversation-item"
        type="button"
        onContextMenu={(event) => onContextMenu(event, conversation.id)}
        onClick={() => onSelect(conversation.id)}
      >
        <span className="conversation-title">{conversation.title}</span>
      </button>
    </div>
  )
}

function ConversationSidebar({
  conversations,
  activeConversationId,
  authUser,
  onNewConversation,
  onDeleteConversation,
  onOpenSettings,
  onSignIn,
  onSignOut,
  onReorderConversation,
  onSelectConversation,
  isActive,
}: ConversationSidebarProps) {
  const [contextMenu, setContextMenu] =
    useState<ConversationContextMenu | null>(null)
  const [accountMenu, setAccountMenu] = useState<AccountMenuPosition | null>(
    null,
  )
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const accountButtonRef = useRef<HTMLButtonElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  useEffect(() => {
    const closeMenus = () => {
      setContextMenu(null)
      setAccountMenu(null)
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenus()
      }
    }

    document.addEventListener('pointerdown', closeMenus)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', closeMenus)

    return () => {
      document.removeEventListener('pointerdown', closeMenus)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', closeMenus)
    }
  }, [])

  const activeDragConversation = conversations.find(
    (conversation) => conversation.id === activeDragId,
  )

  function handleContextMenu(
    event: MouseEvent<HTMLButtonElement>,
    conversationId: string,
  ) {
    event.preventDefault()
    event.stopPropagation()
    setAccountMenu(null)

    setContextMenu({
      conversationId,
      left: Math.min(event.clientX, window.innerWidth - 158),
      top: Math.min(event.clientY, window.innerHeight - 34),
    })
  }

  function handleDragStart(event: DragStartEvent) {
    setContextMenu(null)
    setAccountMenu(null)
    setActiveDragId(String(event.active.id))
  }

  function toggleAccountMenu() {
    if (accountMenu) {
      setAccountMenu(null)
      return
    }

    const accountButton = accountButtonRef.current

    if (!accountButton) {
      return
    }

    const bounds = accountButton.getBoundingClientRect()

    setContextMenu(null)
    setAccountMenu({
      left: bounds.left,
      top: bounds.top - 6,
      width: bounds.width,
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null)

    if (!event.over || event.active.id === event.over.id) {
      return
    }

    onReorderConversation(String(event.active.id), String(event.over.id))
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button
          className="new-conversation-button no-drag"
          type="button"
          onClick={onNewConversation}
        >
          <Plus className="new-conversation-icon" aria-hidden="true" />
          <span>新建对话</span>
        </button>
      </div>

      <DndContext
        collisionDetection={closestCenter}
        sensors={sensors}
        onDragCancel={() => setActiveDragId(null)}
        onDragEnd={handleDragEnd}
        onDragStart={handleDragStart}
      >
        <SortableContext
          items={conversations.map((conversation) => conversation.id)}
          strategy={verticalListSortingStrategy}
        >
          <nav className="conversation-list" aria-label="对话列表">
            {sectionLabels.map((sectionLabel) => {
              const sectionConversations = conversations.filter(
                (conversation) =>
                  getSectionLabel(conversation.updatedAt) === sectionLabel,
              )

              if (sectionConversations.length === 0) {
                return null
              }

              return (
                <section className="conversation-section" key={sectionLabel}>
                  <h2>{sectionLabel}</h2>
                  <div className="conversation-items">
                    {sectionConversations.map((conversation) => (
                      <SortableConversationItem
                        conversation={conversation}
                        isActive={conversation.id === activeConversationId}
                        key={conversation.id}
                        onContextMenu={handleContextMenu}
                        onSelect={onSelectConversation}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </nav>
        </SortableContext>

        <DragOverlay
          adjustScale={false}
          dropAnimation={{
            duration: 220,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {isActive && activeDragConversation ? (
            <div className="conversation-drag-preview" aria-hidden="true">
              <span className="conversation-title">
                {activeDragConversation.title}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className="sidebar-account">
        <button
          ref={accountButtonRef}
          className="account-button no-drag"
          type="button"
          title={authUser?.email ?? '登录'}
          aria-expanded={isActive && accountMenu !== null}
          aria-haspopup="menu"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={toggleAccountMenu}
        >
          <UserAvatar user={authUser} />
          <span className="account-name">
            {authUser ? authUser.name.trim() || authUser.email : '登录'}
          </span>
        </button>
      </div>

      {isActive && contextMenu
        ? createPortal(
            <div
              className="conversation-context-menu no-drag"
              role="menu"
              style={{ left: contextMenu.left, top: contextMenu.top }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                className="context-menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  onDeleteConversation(contextMenu.conversationId)
                  setContextMenu(null)
                }}
              >
                <MenuIcon icon={Trash2} />
                删除对话
              </button>
            </div>,
            document.body,
          )
        : null}

      {isActive && accountMenu
        ? createPortal(
            <div
              className="conversation-context-menu account-menu no-drag"
              role="menu"
              style={{
                left: accountMenu.left,
                top: accountMenu.top,
                width: accountMenu.width,
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                className="context-menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenu(null)
                  onOpenSettings()
                }}
              >
                <MenuIcon icon={Settings} size={14} />
                设置
              </button>
              {authUser ? (
                <button
                  className="context-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenu(null)
                    onSignOut()
                  }}
                >
                  <MenuIcon icon={LogOut} size={14.5} />
                  退出登录
                </button>
              ) : (
                <button
                  className="context-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenu(null)
                    onSignIn()
                  }}
                >
                  <MenuIcon icon={LogIn} size={14.5} />
                  登录
                </button>
              )}
            </div>,
            document.body,
          )
        : null}
    </aside>
  )
}

export default ConversationSidebar
