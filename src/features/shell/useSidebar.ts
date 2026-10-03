import { useEffect, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { getSidebarDragDecision } from '../../shared/sidebar-gesture'
import type { SidebarDragPhase } from '../../shared/sidebar-gesture'
import { preferenceStorageKeys, storePreference } from '../preferences/storage'

type SidebarMode = 'open' | 'peek' | 'closed'

// 侧边栏几何的唯一语义来源：渲染层把这个像素偏好写进 --sidebar-width，
// CSS Grid 负责按它分配空间，窗口尺寸变化不参与。
const defaultSidebarWidth = 260
const minimumSidebarWidth = defaultSidebarWidth
const maximumSidebarWidth = 420
const sidebarKeyboardStep = 10
const sidebarKeyboardCoarseStep = 40
const sidebarCollapsePullDistance = 72
const sidebarAnimationDuration = 145
type SidebarPointerDrag = {
  pointerId: number
  startX: number
  startWidth: number
  startedAtMinimum: boolean
  phase: SidebarDragPhase
}

function clampSidebarWidth(width: number) {
  return Math.round(
    Math.min(maximumSidebarWidth, Math.max(minimumSidebarWidth, width)),
  )
}

function readStoredSidebarWidth(key: string) {
  try {
    const storedValue = window.localStorage.getItem(key)

    if (storedValue !== null) {
      const storedWidth = Number(storedValue)

      if (Number.isFinite(storedWidth)) {
        return clampSidebarWidth(storedWidth)
      }
    }
  } catch {
    // Preferences remain usable for this session if storage is unavailable.
  }

  return defaultSidebarWidth
}

export function useSidebar() {
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('open')
  const [isSidebarResizing, setIsSidebarResizing] = useState(false)
  const [isSidebarAnimating, setIsSidebarAnimating] = useState(false)
  const [isEdgeRevealArmed, setIsEdgeRevealArmed] = useState(true)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [preferredSidebarWidth, setPreferredSidebarWidth] = useState(() =>
    readStoredSidebarWidth(preferenceStorageKeys.sidebarWidth),
  )
  const sidebarModeRef = useRef<SidebarMode>('open')
  const sidebarPointerDragRef = useRef<SidebarPointerDrag | null>(null)
  const sidebarAnimationTimerRef = useRef<number | null>(null)
  const isSidebarOpen = sidebarMode !== 'closed'

  useEffect(() => {
    if (isSidebarOpen || isEdgeRevealArmed) {
      return
    }

    const armEdgeRevealAfterPointerLeaves = (event: PointerEvent) => {
      if (event.clientX > 12) {
        setIsEdgeRevealArmed(true)
      }
    }

    window.addEventListener('pointermove', armEdgeRevealAfterPointerLeaves)

    return () => {
      window.removeEventListener('pointermove', armEdgeRevealAfterPointerLeaves)
    }
  }, [isEdgeRevealArmed, isSidebarOpen])

  useEffect(
    () => () => {
      if (sidebarAnimationTimerRef.current !== null) {
        window.clearTimeout(sidebarAnimationTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    let isSubscribed = true
    const windowApi = window.velin.window
    const unsubscribe = windowApi.subscribeFullScreenState(setIsFullScreen)

    void windowApi
      .getFullScreenState()
      .then((nextIsFullScreen) => {
        if (isSubscribed) {
          setIsFullScreen(nextIsFullScreen)
        }
      })
      .catch(() => {
        // Main/preload can briefly be unavailable while Electron restarts in development.
      })

    return () => {
      isSubscribed = false
      unsubscribe()
    }
  }, [])

  function startSidebarAnimation() {
    if (sidebarAnimationTimerRef.current !== null) {
      window.clearTimeout(sidebarAnimationTimerRef.current)
    }

    setIsSidebarAnimating(true)
    sidebarAnimationTimerRef.current = window.setTimeout(() => {
      sidebarAnimationTimerRef.current = null
      setIsSidebarAnimating(false)
    }, sidebarAnimationDuration)
  }

  // 可见性和宽度是两个独立状态：收起只切换网格轨道，不改写像素偏好。
  function showSidebar() {
    startSidebarAnimation()
    sidebarModeRef.current = 'open'
    setSidebarMode('open')
  }

  function peekSidebar() {
    if (sidebarModeRef.current !== 'closed') {
      return
    }

    startSidebarAnimation()
    sidebarModeRef.current = 'peek'
    setSidebarMode('peek')
  }

  function hideSidebar() {
    startSidebarAnimation()
    sidebarModeRef.current = 'closed'
    setIsEdgeRevealArmed(true)
    setIsSidebarResizing(false)
    setSidebarMode('closed')
  }

  function commitSidebarWidth(nextWidth: number) {
    setPreferredSidebarWidth(nextWidth)
    storePreference(preferenceStorageKeys.sidebarWidth, nextWidth)
  }

  function resetSidebarWidth() {
    if (sidebarModeRef.current === 'closed') {
      showSidebar()
    } else {
      startSidebarAnimation()
    }
    commitSidebarWidth(defaultSidebarWidth)
  }

  function handleSidebarPointerLeave() {
    if (sidebarModeRef.current === 'peek') {
      hideSidebar()
    }
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    sidebarPointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: preferredSidebarWidth,
      startedAtMinimum: preferredSidebarWidth <= minimumSidebarWidth + 0.5,
      phase: 'resizing',
    }
    setIsSidebarResizing(true)
  }

  function moveSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = sidebarPointerDragRef.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    const nextWidth = clampSidebarWidth(
      drag.startWidth + event.clientX - drag.startX,
    )
    const decision = getSidebarDragDecision(
      drag,
      event.clientX,
      nextWidth,
      minimumSidebarWidth,
      sidebarCollapsePullDistance,
    )

    if (decision === 'restore') {
      drag.phase = 'restored'
      showSidebar()
      return
    }

    if (decision === 'collapse') {
      drag.phase = 'collapsed'
      hideSidebar()
      return
    }

    // 这次手势已经触发隐藏：宽度保持用户偏好，直到松手后下一次拖动才再改。
    if (drag.phase === 'collapsed') {
      return
    }

    if (nextWidth !== preferredSidebarWidth) {
      setPreferredSidebarWidth(nextWidth)
    }
  }

  function endSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = sidebarPointerDragRef.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    sidebarPointerDragRef.current = null
    if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId)
    }
    setIsSidebarResizing(false)

    // 只有真正把面板拖宽的这次手势才落盘；二段收起的手势只是隐藏，不改偏好。
    const isWidthGesture =
      drag.phase === 'resizing' && preferredSidebarWidth !== drag.startWidth

    if (isWidthGesture) {
      storePreference(preferenceStorageKeys.sidebarWidth, preferredSidebarWidth)
    }
  }

  function handleSidebarResizeKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    const step = event.shiftKey
      ? sidebarKeyboardCoarseStep
      : sidebarKeyboardStep
    let nextWidth: number

    switch (event.key) {
      case 'ArrowLeft':
        nextWidth = preferredSidebarWidth - step
        break
      case 'ArrowRight':
        nextWidth = preferredSidebarWidth + step
        break
      case 'Home':
        nextWidth = minimumSidebarWidth
        break
      case 'End':
        nextWidth = maximumSidebarWidth
        break
      default:
        return
    }

    event.preventDefault()

    const clampedWidth = clampSidebarWidth(nextWidth)

    if (clampedWidth !== preferredSidebarWidth) {
      commitSidebarWidth(clampedWidth)
    }
  }

  return {
    isSidebarOpen,
    isSidebarResizing,
    isSidebarAnimating,
    isEdgeRevealArmed,
    isFullScreen,
    preferredSidebarWidth,
    showSidebar,
    hideSidebar,
    peekSidebar,
    resetSidebarWidth,
    handleSidebarPointerLeave,
    startSidebarResize,
    moveSidebarResize,
    endSidebarResize,
    handleSidebarResizeKeyDown,
    minimumSidebarWidth,
    maximumSidebarWidth,
  }
}
