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
    // 存储不可用时，当前会话仍可使用偏好设置。
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
    // 存储不可用时，当前会话仍可使用偏好设置。
  }

  return fallback
}

export function storePreference(key: string, value: string | boolean | number) {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // 持久化不可用时，界面设置仍立即生效。
  }
}
