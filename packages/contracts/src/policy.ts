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
export const passwordPolicy = { minimum: 8, maximum: 32 } as const
export const passwordPolicyHint = '8–32 位英文、数字或符号'
export const passwordPolicyMessage = `${passwordPolicyHint}，不含空格。`

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
    value.trim().length >= 1 &&
    [...value.trim()].length <= 32 &&
    !hasControlCharacters(value)
  )
}
