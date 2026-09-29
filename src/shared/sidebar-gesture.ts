export type SidebarDragPhase = 'resizing' | 'collapsed' | 'restored'

export type SidebarDragPosition = {
  startX: number
  startedAtMinimum: boolean
  phase: SidebarDragPhase
}

export function getSidebarDragDecision(
  drag: SidebarDragPosition,
  pointerX: number,
  currentWidth: number,
  minimumWidth: number,
  collapseDistance: number,
): 'collapse' | 'restore' | null {
  if (!drag.startedAtMinimum) {
    return null
  }

  const pullDistance = drag.startX - pointerX

  if (drag.phase === 'collapsed') {
    return pullDistance <= collapseDistance / 2 ? 'restore' : null
  }

  if (
    pullDistance >= collapseDistance &&
    (drag.phase === 'restored' || currentWidth <= minimumWidth + 0.5)
  ) {
    return 'collapse'
  }

  return null
}
