export const chatLimits = {
  messageCharacters: 8_000,
  promptCharacters: 32_000,
  messages: 32,
} as const
export const avatarLimits = {
  uploadBytes: 512 * 1024,
  sourceBytes: 8 * 1024 * 1024,
  outputSize: 256,
} as const
export const passwordPolicy = { minimum: 15, maximum: 128 } as const
export const passwordPolicyMessage =
  '密码需为 15–128 个字符，可使用空格和中文。'

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!
    return code < 32 || code === 127
  })
}

export function isValidNewPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    [...value].length >= passwordPolicy.minimum &&
    [...value].length <= passwordPolicy.maximum &&
    !hasControlCharacters(value)
  )
}

export function isValidDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= 1 &&
    [...value.trim()].length <= 32 &&
    !hasControlCharacters(value)
  )
}
