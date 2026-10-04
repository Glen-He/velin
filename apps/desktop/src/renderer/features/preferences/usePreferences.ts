import { useEffect, useLayoutEffect, useState } from 'react'
import type { AppearanceMode, InterfaceFontScale } from './types'
import {
  preferenceStorageKeys,
  readStoredBoolean,
  readStoredChoice,
  storePreference,
} from './storage'

export function usePreferences() {
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() =>
    readStoredChoice<AppearanceMode>(
      preferenceStorageKeys.appearanceMode,
      ['system', 'light', 'dark'],
      'system',
    ),
  )
  const [fontScale, setFontScale] = useState<InterfaceFontScale>(() =>
    readStoredChoice<InterfaceFontScale>(
      preferenceStorageKeys.fontScale,
      ['small', 'default', 'large'],
      'default',
    ),
  )
  const [sendOnEnter, setSendOnEnter] = useState(() =>
    readStoredBoolean(preferenceStorageKeys.sendOnEnter, true),
  )
  const [edgeRevealEnabled, setEdgeRevealEnabled] = useState(() =>
    readStoredBoolean(preferenceStorageKeys.edgeRevealEnabled, true),
  )
  useLayoutEffect(() => {
    const root = document.documentElement

    if (appearanceMode === 'system') {
      delete root.dataset.theme
    } else {
      root.dataset.theme = appearanceMode
    }
    storePreference(preferenceStorageKeys.appearanceMode, appearanceMode)

    return () => {
      delete root.dataset.theme
    }
  }, [appearanceMode])

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.fontScale = fontScale
    storePreference(preferenceStorageKeys.fontScale, fontScale)

    return () => {
      delete root.dataset.fontScale
    }
  }, [fontScale])

  useEffect(() => {
    storePreference(preferenceStorageKeys.sendOnEnter, sendOnEnter)
  }, [sendOnEnter])

  useEffect(() => {
    storePreference(preferenceStorageKeys.edgeRevealEnabled, edgeRevealEnabled)
  }, [edgeRevealEnabled])

  return {
    appearanceMode,
    setAppearanceMode,
    fontScale,
    setFontScale,
    sendOnEnter,
    setSendOnEnter,
    edgeRevealEnabled,
    setEdgeRevealEnabled,
  }
}
