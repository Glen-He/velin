export const chatLimits = {
  messageCharacters: 8_000,
  responseCharacters: 256 * 1024,
  deltaCharacters: 8 * 1024,
  streamBufferCharacters: 128 * 1024,
} as const
export const avatarLimits = {
  uploadBytes: 512 * 1024,
  sourceBytes: 8 * 1024 * 1024,
  outputSize: 256,
} as const
export const conversationTitleLimit = 60
export const conversationTitleMessage = `标题需为 1–${conversationTitleLimit} 个字符，且不能包含控制字符。`
export const passwordPolicy = { minimum: 8, maximum: 32 } as const
export const passwordPolicyHint = '8–32 位英文、数字或符号'
export const passwordPolicyMessage = `${passwordPolicyHint}，不含空格。`

// PostgreSQL text 不接受 NUL 或未配对的代理项；u 模式不会误拒合法 emoji。
export function isValidStorageText(value: string) {
  return !value.includes('\u0000') && !/[\uD800-\uDFFF]/u.test(value)
}

export function truncateText(value: string, limit: number) {
  let end = Math.min(value.length, Math.max(0, limit))
  if (
    end > 0 &&
    end < value.length &&
    /[\uD800-\uDBFF]/.test(value[end - 1]) &&
    /[\uDC00-\uDFFF]/.test(value[end])
  )
    end--
  return value.slice(0, end)
}

export function* splitText(value: string, limit: number) {
  if (!Number.isInteger(limit) || limit < 2)
    throw new RangeError('Text chunk budget must be at least two code units.')
  for (let offset = 0; offset < value.length; ) {
    const part = truncateText(value.slice(offset), limit)
    yield part
    offset += part.length
  }
}

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!
    return code < 32 || code === 127
  })
}

export function isValidNewPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= passwordPolicy.minimum &&
    value.length <= passwordPolicy.maximum &&
    /^[\x21-\x7e]+$/.test(value)
  )
}

export function newPasswordError(value: string): string {
  return isValidNewPassword(value) ? '' : passwordPolicyMessage
}

export function isValidDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    isValidStorageText(value) &&
    value.trim().length >= 1 &&
    [...value.trim()].length <= 32 &&
    !hasControlCharacters(value)
  )
}

export function isValidConversationTitle(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const characters = [...value.trim()]
  return (
    characters.length >= 1 &&
    isValidStorageText(value) &&
    characters.length <= conversationTitleLimit &&
    !hasControlCharacters(value)
  )
}

export const chatTimeouts = {
  generationMs: 420_000,
  transportMs: 450_000,
} as const
