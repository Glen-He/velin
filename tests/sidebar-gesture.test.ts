import assert from 'node:assert/strict'
import test from 'node:test'
import { getSidebarDragDecision } from '../src/shared/sidebar-gesture.ts'

const minimumWidth = 260
const collapseDistance = 72

test('a drag that starts wide only shrinks to the minimum', () => {
  assert.equal(
    getSidebarDragDecision(
      { startX: 340, startedAtMinimum: false, phase: 'resizing' },
      0,
      minimumWidth,
      minimumWidth,
      collapseDistance,
    ),
    null,
  )
})

test('a held drag can collapse, restore, and collapse again with hysteresis', () => {
  const drag = {
    startX: minimumWidth,
    startedAtMinimum: true,
    phase: 'resizing' as 'resizing' | 'collapsed' | 'restored',
  }

  assert.equal(
    getSidebarDragDecision(
      drag,
      200,
      minimumWidth,
      minimumWidth,
      collapseDistance,
    ),
    null,
  )
  assert.equal(
    getSidebarDragDecision(
      drag,
      188,
      minimumWidth,
      minimumWidth,
      collapseDistance,
    ),
    'collapse',
  )

  drag.phase = 'collapsed'
  assert.equal(
    getSidebarDragDecision(drag, 210, 0, minimumWidth, collapseDistance),
    null,
  )
  assert.equal(
    getSidebarDragDecision(drag, 224, 0, minimumWidth, collapseDistance),
    'restore',
  )

  drag.phase = 'restored'
  assert.equal(
    getSidebarDragDecision(
      drag,
      188,
      minimumWidth,
      minimumWidth,
      collapseDistance,
    ),
    'collapse',
  )
})
