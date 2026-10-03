export const preferenceStorageKeys = {
  appearanceMode: 'velin:preference:appearance-mode',
  edgeRevealEnabled: 'velin:preference:edge-reveal-enabled',
  fontScale: 'velin:preference:font-scale',
  sendOnEnter: 'velin:preference:send-on-enter',
  sidebarWidth: 'velin:preference:sidebar-width',
} as const

export function readStoredChoice<T extends string>(
  key: string,
  allowedValues: readonly T[],
  fallback: T,
) {
  try {
    const storedValue = window.localStorage.getItem(key)

    if (storedValue && allowedValues.includes(storedValue as T)) {
      return storedValue as T
    }
  } catch {
    // Preferences remain usable for this session if storage is unavailable.
  }

  return fallback
}

export function readStoredBoolean(key: string, fallback: boolean) {
  try {
    const storedValue = window.localStorage.getItem(key)

    if (storedValue === 'true') {
      return true
    }

    if (storedValue === 'false') {
      return false
    }
  } catch {
    // Preferences remain usable for this session if storage is unavailable.
  }

  return fallback
}

export function storePreference(key: string, value: string | boolean | number) {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // The visible setting still applies even if persistence is unavailable.
  }
}
