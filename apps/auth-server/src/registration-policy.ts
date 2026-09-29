export const NEW_PASSWORD_PATTERN = /^[\x21-\x7e]{8,32}$/

export function isValidNewPassword(value: unknown): value is string {
  return typeof value === 'string' && NEW_PASSWORD_PATTERN.test(value)
}

// 用户名允许重复，只约束可见性与长度；显示名由服务端在注册时默认填邮箱。
export function isValidDisplayName(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }

  const trimmed = value.trim()

  if (trimmed.length < 1 || trimmed.length > 32) {
    return false
  }

  for (const character of trimmed) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined) {
      return false
    }
    // 拒绝 C0 控制字符与 DEL，保证用户名在界面上始终按可见文本渲染。
    if (codePoint <= 0x001f || codePoint === 0x007f) {
      return false
    }
  }

  return true
}
