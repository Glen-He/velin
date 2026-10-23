import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import {
  chatModelIds,
  defaultChatModel,
  defaultReasoningEffortForModel,
  findChatModel,
  normalizeReasoningEffort,
} from '@velin/contracts/chat'
import type { ChatModelId, ReasoningEffortId } from '@velin/contracts/chat'
import type { AppearanceMode, InterfaceFontScale } from './types'
import {
  preferenceStorageKeys,
  readStoredBoolean,
  readStoredChoice,
  readStoredChoiceValue,
  reasoningEffortStorageKey,
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
  const [chatModel, setChatModelState] = useState<ChatModelId>(() =>
    readStoredChoice(
      preferenceStorageKeys.chatModel,
      chatModelIds,
      defaultChatModel,
    ),
  )
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffortId>(
    () => {
      const model = findChatModel(chatModel)
      const stored = readStoredChoiceValue(
        reasoningEffortStorageKey(chatModel),
        model.supportedReasoningEfforts,
      )
      return normalizeReasoningEffort(
        model,
        stored ?? defaultReasoningEffortForModel(model),
      )
    },
  )
  const setChatModel = useCallback((modelId: ChatModelId) => {
    const model = findChatModel(modelId)
    const remembered = readStoredChoiceValue(
      reasoningEffortStorageKey(modelId),
      model.supportedReasoningEfforts,
    )
    setChatModelState(modelId)
    setReasoningEffort((current) =>
      normalizeReasoningEffort(model, remembered ?? current),
    )
  }, [])
  const effectiveReasoningEffort = normalizeReasoningEffort(
    findChatModel(chatModel),
    reasoningEffort,
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

  useEffect(() => {
    storePreference(preferenceStorageKeys.chatModel, chatModel)
  }, [chatModel])
  useEffect(() => {
    storePreference(
      reasoningEffortStorageKey(chatModel),
      effectiveReasoningEffort,
    )
  }, [chatModel, effectiveReasoningEffort])
  return {
    appearanceMode,
    setAppearanceMode,
    fontScale,
    setFontScale,
    sendOnEnter,
    setSendOnEnter,
    edgeRevealEnabled,
    setEdgeRevealEnabled,
    chatModel,
    setChatModel,
    reasoningEffort: effectiveReasoningEffort,
    setReasoningEffort,
  }
}
